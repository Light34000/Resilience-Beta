"""Service « detector » : détection d'anomalies en temps réel sur le trafic de la passerelle (Isolation Forest).

Boucle (toutes les EVAL_INTERVAL_SECONDS) :
  1. lit dans Loki les WINDOW_S dernières secondes du journal d'accès de la passerelle ;
  2. calcule les variables par client (features.py) et applique le modèle hybride entraîné (train.py) :
     Isolation Forest + garde-fous de bornes + classifieur supervisé (s'il a été entraîné) ;
  3. un client anormal PERSIST fois de suite est bloqué BLOCK_TTL_SECONDS ; le moteur de remédiation reçoit une
     alerte « anomaly » (escalade humaine, aucun redémarrage si le service est sain) et l'audit trace le blocage.

La passerelle (variante ml/nginx.detector.conf) interroge GET /internal/check avant chaque requête :
403 si le client est bloqué, 204 sinon. Si le détecteur ne répond pas, la passerelle laisse passer (ouverture
par défaut) : une panne du détecteur ne coupe jamais la plateforme.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import socket
import time
from collections import Counter, defaultdict
from pathlib import Path

import httpx
import joblib
import numpy as np
from fastapi import APIRouter, Depends, FastAPI, Header, Response
from prometheus_client import Counter as PCounter
from prometheus_client import Gauge
from pydantic import BaseModel

import loki
from features import client_key, exceeded, route_of, window_features
from resilience_common.app import create_app
from resilience_common.config import env
from resilience_common.events import audit
from resilience_common.logs import log_event
from resilience_common.security import require_roles, service_token

log = logging.getLogger("detector")

MODEL_PATH = Path(env("MODEL_PATH", "/app/model/model.joblib") or "/app/model/model.joblib")
REMEDIATION_URL = env("REMEDIATION_URL", "http://remediation:8000")
EVAL_INTERVAL = float(env("EVAL_INTERVAL_SECONDS", "5") or 5)
LOKI_DELAY = float(env("LOKI_DELAY_SECONDS", "3") or 3)
PERSIST = int(env("PERSIST", "2") or 2)
BLOCK_TTL = float(env("BLOCK_TTL_SECONDS", "600") or 600)
ALERT_COOLDOWN = float(env("ALERT_COOLDOWN_SECONDS", "600") or 600)
MIN_REQUESTS = int(env("MIN_REQUESTS", "3") or 3)
# Jamais bloqués : le serveur du front (tous les utilisateurs de l'interface partagent cette identité) et la sonde.
ALLOW_UA = re.compile(env("ALLOW_UA_REGEX", r"^(node|resilience-canary/.*)$") or "^$")
ALLOW_HOSTS = [h for h in (env("ALLOW_HOSTS", "canary") or "").split(",") if h]
SERVICES = ("auth", "accounts", "payments", "notifications")

EVALS = PCounter("detector_evaluations_total", "Fenêtres client notées")
ANOMALIES = PCounter("detector_anomalies_total", "Fenêtres client jugées anormales")
BLOCKS = PCounter("detector_blocks_total", "Clients bloqués")
CHECKS = PCounter("detector_checks_total", "Contrôles de la passerelle", ["result"])
BLOCKED = Gauge("detector_blocked_clients", "Clients actuellement bloqués")
MIN_SCORE = Gauge("detector_min_score", "Score le plus bas de la dernière évaluation (plus bas = plus anormal)")
MODEL_LOADED = Gauge("detector_model_loaded", "1 si un modèle est chargé")


class State:
    def __init__(self) -> None:
        self.bundle: dict | None = None
        self.blocked: dict[str, dict] = {}  # clé -> {until, score, service, since}
        self.streak: dict[str, int] = defaultdict(int)
        self.last_alert: dict[str, float] = {}
        self.allow_ips: set[str] = set()


def load_model(st: State) -> None:
    try:
        st.bundle = joblib.load(MODEL_PATH)
        MODEL_LOADED.set(1)
        log_event(log, "detector_model_loaded", path=str(MODEL_PATH), threshold=st.bundle["threshold"], trained_at=st.bundle["trained_at"])
    except FileNotFoundError:
        st.bundle = None
        MODEL_LOADED.set(0)
        log_event(log, "detector_model_missing", logging.WARNING, path=str(MODEL_PATH))


def refresh_allowlist(st: State) -> None:
    ips = set()
    for host in ALLOW_HOSTS:
        try:
            ips.add(socket.gethostbyname(host))
        except OSError:
            pass
    st.allow_ips = ips


def allowed(st: State, key: str) -> bool:
    ip, _, ua = key.partition("|")
    return ip in st.allow_ips or bool(ALLOW_UA.match(ua))


def target_service(records: list[dict]) -> str:
    """Service le plus visé par le client (pour l'alerte) ; auth par défaut (balayage hors /api)."""
    hits = Counter(r.split("/")[2] for r in (route_of(str(x.get("uri", ""))) for x in records) if r.startswith("/api/") and r.count("/") >= 2)
    for svc, _ in hits.most_common():
        if svc in SERVICES:
            return svc
    return "auth"


async def alert(app: FastAPI, key: str, service: str, score: float, feats: dict) -> None:
    st: State = app.state.det
    if time.monotonic() - st.last_alert.get(service, -ALERT_COOLDOWN) < ALERT_COOLDOWN:
        return  # limite l'usage du disjoncteur de la remédiation (voir docs/02, section 3.6)
    st.last_alert[service] = time.monotonic()
    payload = {
        "source": "detector",
        "service": service,
        "type": "anomaly",
        "severity": "critical" if score < st.bundle["threshold"] - 0.1 else "high",
        "score": round(score, 4),
        "details": {"client": key, "features": {k: round(v, 3) for k, v in feats.items()}},
    }
    try:
        await app.state.http.post(f"{REMEDIATION_URL}/internal/alerts", json=payload,
                                  headers={"Authorization": f"Bearer {service_token('detector')}"}, timeout=3)
    except httpx.HTTPError as exc:
        log_event(log, "detector_alert_failed", logging.WARNING, error=type(exc).__name__)


async def evaluate(app: FastAPI) -> None:
    st: State = app.state.det
    now = time.time()
    for key in [k for k, b in st.blocked.items() if b["until"] <= now]:
        st.blocked.pop(key)
        log_event(log, "detector_unblocked", client=key, reason="expired")
    BLOCKED.set(len(st.blocked))
    if st.bundle is None:
        return

    window = st.bundle["window_s"]
    records = await asyncio.to_thread(loki.fetch_recent, window, LOKI_DELAY, app.state.loki)
    by_key: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_key[client_key(r)].append(r)

    keys, rows, feats_by_key = [], [], {}
    for key, recs in by_key.items():
        if len(recs) < MIN_REQUESTS or allowed(st, key):
            continue
        feats = window_features(recs)
        keys.append(key)
        rows.append([feats[f] for f in st.bundle["features"]])
        feats_by_key[key] = feats
    seen = set(keys)
    for key in list(st.streak):
        if key not in seen:
            st.streak.pop(key)
    if not rows:
        MIN_SCORE.set(0)
        return

    X = np.asarray(rows, dtype=float)
    scores = st.bundle["model"].score_samples(X)
    clf = st.bundle.get("classifier")
    probas = clf.predict_proba(X)[:, 1] if clf is not None else np.zeros(len(rows))
    EVALS.inc(len(rows))
    MIN_SCORE.set(float(scores.min()))
    for key, score, proba in zip(keys, scores, probas):
        # Trois règles (modèle hybride) : forêt sous le seuil, variable hors plage normale, classifieur supervisé.
        out = exceeded(feats_by_key[key], st.bundle.get("limits", {}))
        supervised = bool(proba > st.bundle.get("classifier_threshold", 0.5))
        reasons = (["forest"] if score < st.bundle["threshold"] else []) + (["bounds"] if out else []) + (["supervised"] if supervised else [])
        if not reasons:
            st.streak[key] = 0
            continue
        ANOMALIES.inc()
        st.streak[key] += 1
        log_event(log, "detector_anomaly", logging.WARNING, client=key, score=round(float(score), 4), streak=st.streak[key],
                  requests=len(by_key[key]), reasons=reasons, exceeded=out, attack_probability=round(float(proba), 3),
                  **{k: round(v, 3) for k, v in feats_by_key[key].items()})
        if st.streak[key] >= PERSIST and key not in st.blocked:
            service = target_service(by_key[key])
            st.blocked[key] = {"until": now + BLOCK_TTL, "score": float(score), "service": service, "since": now}
            BLOCKS.inc()
            BLOCKED.set(len(st.blocked))
            log_event(log, "detector_blocked", logging.WARNING, client=key, score=round(float(score), 4), service=service,
                      ttl=BLOCK_TTL, reasons=reasons, exceeded=out, attack_probability=round(float(proba), 3))
            audit("detector", "traffic_blocked", actor=key[:64], outcome="denied", score=round(float(score), 4),
                  service=service, ttl_seconds=BLOCK_TTL, requests=len(by_key[key]), reasons=reasons, exceeded=out,
                  attack_probability=round(float(proba), 3))
            await alert(app, key, service, float(score), feats_by_key[key])


async def loop(app: FastAPI) -> None:
    tick = 0
    while True:
        try:
            if tick % 12 == 0:
                refresh_allowlist(app.state.det)
            await evaluate(app)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - la boucle ne doit jamais mourir
            log_event(log, "detector_loop_error", logging.ERROR, error=repr(exc)[:200])
        tick += 1
        await asyncio.sleep(EVAL_INTERVAL)


async def startup(app: FastAPI) -> None:
    app.state.det = State()
    load_model(app.state.det)
    refresh_allowlist(app.state.det)
    app.state.http = httpx.AsyncClient()
    app.state.loki = loki._client()
    app.state.task = asyncio.create_task(loop(app))


async def shutdown(app: FastAPI) -> None:
    app.state.task.cancel()
    await app.state.http.aclose()
    app.state.loki.close()


app = create_app("detector", startup=startup, shutdown=shutdown)
router = APIRouter(prefix="/internal", tags=["detector"])


@router.get("/check", status_code=204, include_in_schema=True)
async def check(response: Response, x_client_key: str = Header(default="")):
    """Appelé par la passerelle (auth_request) avant chaque requête : 403 si le client est bloqué."""
    blocked = app.state.det.blocked.get(x_client_key)
    if blocked and blocked["until"] > time.time():
        CHECKS.labels("blocked").inc()
        response.status_code = 403
        return None
    CHECKS.labels("allowed").inc()
    return None


@router.get("/blocked")
async def list_blocked(_: dict = Depends(require_roles("admin", "service"))):
    now = time.time()
    return [{"client": k, "remaining_seconds": round(b["until"] - now), "score": b["score"], "service": b["service"]}
            for k, b in app.state.det.blocked.items()]


class UnblockIn(BaseModel):
    client: str


@router.post("/unblock")
async def unblock(body: UnblockIn, claims: dict = Depends(require_roles("admin", "service"))):
    removed = app.state.det.blocked.pop(body.client, None) is not None
    if removed:
        BLOCKED.set(len(app.state.det.blocked))
        log_event(log, "detector_unblocked", client=body.client, reason="manual", by=claims.get("sub"))
    return {"unblocked": removed}


@router.post("/reload")
async def reload_model(_: dict = Depends(require_roles("admin", "service"))):
    load_model(app.state.det)
    return {"loaded": app.state.det.bundle is not None}


app.include_router(router)
