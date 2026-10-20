"""Variables calculées par client et par fenêtre de temps, à partir du journal d'accès de la passerelle.

Un « client » est la clé `remote_addr|user_agent`. Sous Docker Desktop (Windows/macOS), tous les clients
extérieurs arrivent avec la même adresse (passerelle du réseau Docker) : l'agent utilisateur est alors ce qui
les distingue. Sur un hôte Linux, ou derrière un proxy qui transmet l'IP réelle, l'adresse suffit.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict

import numpy as np
import pandas as pd

WINDOW_S = 30

# Ordre figé : le modèle entraîné en dépend (il est enregistré avec lui).
FEATURES = [
    "log_requests",  # volume
    "distinct_routes",  # diversité des routes (gabarits)
    "frac_4xx",
    "frac_5xx",
    "frac_401",
    "frac_404",
    "frac_429",
    "log_logins",  # POST /api/auth/login
    "frac_post",
    "frac_outside_api",  # chemins hors /api/ : balayage (/internal, /admin, /.env…)
    "mean_request_time",
    "max_request_time",
    "log_mean_bytes",
    "log_payment_posts",
]

_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_NUM = re.compile(r"/\d+(?=/|$)")


def route_of(uri: str) -> str:
    """Gabarit de route : sans paramètres, identifiants remplacés (/api/accounts/{id})."""
    path = uri.split("?", 1)[0]
    return _NUM.sub("/{n}", _UUID.sub("{id}", path))


def client_key(rec: dict) -> str:
    return f"{rec.get('remote_addr', '?')}|{rec.get('user_agent', '-')}"


def window_features(records: list[dict]) -> dict[str, float]:
    """Vecteur de variables pour les requêtes d'un client sur une fenêtre."""
    n = len(records)
    statuses = [int(r.get("status", 0)) for r in records]
    routes = [route_of(str(r.get("uri", ""))) for r in records]
    methods = [str(r.get("method", "")) for r in records]
    times = [float(r.get("request_time", 0.0) or 0.0) for r in records]
    sizes = [float(r.get("bytes_sent", 0) or 0) for r in records]

    def frac(pred) -> float:
        return sum(1 for s in statuses if pred(s)) / n

    logins = sum(1 for m, rt in zip(methods, routes) if m == "POST" and rt == "/api/auth/login")
    payments = sum(1 for m, rt in zip(methods, routes) if m == "POST" and rt == "/api/payments")
    return {
        "log_requests": math.log1p(n),
        "distinct_routes": float(len(set(routes))),
        "frac_4xx": frac(lambda s: 400 <= s < 500),
        "frac_5xx": frac(lambda s: s >= 500),
        "frac_401": frac(lambda s: s == 401),
        "frac_404": frac(lambda s: s == 404),
        "frac_429": frac(lambda s: s == 429),
        "log_logins": math.log1p(logins),
        "frac_post": sum(1 for m in methods if m == "POST") / n,
        "frac_outside_api": sum(1 for rt in routes if not rt.startswith("/api/")) / n,
        "mean_request_time": float(np.mean(times)),
        "max_request_time": float(np.max(times)),
        "log_mean_bytes": math.log1p(float(np.mean(sizes))),
        "log_payment_posts": math.log1p(payments),
    }


def build_windows(records: list[dict], window_s: int = WINDOW_S) -> pd.DataFrame:
    """Une ligne par (fenêtre, client). Colonnes : window, key, user_agent, n, + FEATURES."""
    groups: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for r in records:
        groups[(int(r["_ts"] // window_s) * window_s, client_key(r))].append(r)
    rows = []
    for (w, key), recs in groups.items():
        rows.append({"window": w, "key": key, "user_agent": recs[0].get("user_agent", "-"), "n": len(recs), **window_features(recs)})
    df = pd.DataFrame(rows, columns=["window", "key", "user_agent", "n", *FEATURES])
    return df.sort_values(["window", "key"]).reset_index(drop=True)


MIN_REQUESTS = 3  # comme le détecteur : les clients plus discrets ne sont pas notés


def sliding_windows(records: list[dict], window: int = WINDOW_S, stride: int = 10) -> pd.DataFrame:
    """Fenêtres glissantes (30 s, pas de 10 s) par client, d'au moins MIN_REQUESTS requêtes :
    c'est ce que voit le détecteur en temps réel (les 30 dernières secondes, toutes les 5 s)."""
    cols = ["start", "key", "user_agent", "n", *FEATURES]
    by_key: dict[str, list[dict]] = defaultdict(list)
    for r in sorted(records, key=lambda r: r["_ts"]):
        by_key[client_key(r)].append(r)
    rows = []
    for key, recs in by_key.items():
        ts = np.array([r["_ts"] for r in recs])
        start = math.floor(ts[0] / stride) * stride - window + stride
        while start <= ts[-1]:
            lo, hi = int(np.searchsorted(ts, start)), int(np.searchsorted(ts, start + window))
            if hi - lo >= MIN_REQUESTS:
                chunk = recs[lo:hi]
                rows.append({"start": start, "key": key, "user_agent": chunk[0].get("user_agent", "-"), "n": hi - lo,
                             **window_features(chunk)})
            start += stride
    return pd.DataFrame(rows, columns=cols)


# Garde-fous de bornes : complément de l'Isolation Forest. Un arbre ne peut pas couper sur une variable qui ne
# varie jamais dans le trafic normal (ex. part de 404 toujours nulle) : une fenêtre qui sort nettement de la plage
# observée à l'entraînement est donc signalée directement. Marge = max(50 % de l'étendue, plancher absolu).
_FLOORS = {"log_requests": 0.7, "distinct_routes": 3.0, "mean_request_time": 1.0, "max_request_time": 2.0, "log_mean_bytes": 1.5}
_FRACTION_FLOOR = 0.3  # variables frac_* : +30 points au-delà du maximum normal


def compute_bounds(df: pd.DataFrame) -> dict[str, float]:
    """Limite haute par variable, à partir des fenêtres normales d'entraînement."""
    limits = {}
    for f in FEATURES:
        lo, hi = float(df[f].min()), float(df[f].max())
        floor = _FRACTION_FLOOR if f.startswith("frac_") else _FLOORS.get(f, 0.7)
        limits[f] = hi + max(0.5 * (hi - lo), floor)
    return limits


def exceeded(row: dict[str, float], limits: dict[str, float]) -> list[str]:
    """Variables qui dépassent leur limite haute (vide = dans la plage normale)."""
    return [f for f, lim in limits.items() if row[f] > lim]


def label_of(user_agent: str) -> str:
    """Étiquette d'évaluation : le générateur de trafic signe ses requêtes (« rsl-attack-<type> »)."""
    if user_agent.startswith("rsl-attack-"):
        return user_agent.removeprefix("rsl-attack-").split("/")[0]
    return "normal"
