"""Lecture du journal d'accès de la passerelle dans Loki.

Deux façons d'atteindre Loki (non publié sur l'hôte) :
  - depuis un conteneur du réseau backend : LOKI_URL=http://loki:3100
  - depuis le PC Hôte, via le proxy de Grafana :
      LOKI_URL=http://localhost:3000/api/datasources/proxy/uid/loki  GRAFANA_USER=admin  GRAFANA_PASSWORD=...
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Iterator

import httpx

QUERY = '{service="gateway"}'
PAGE = 5000  # limite par requête côté Loki


def _client() -> httpx.Client:
    user, pwd = os.environ.get("GRAFANA_USER"), os.environ.get("GRAFANA_PASSWORD")
    auth = (user, pwd) if user and pwd else None
    return httpx.Client(base_url=os.environ.get("LOKI_URL", "http://loki:3100").rstrip("/"), auth=auth, timeout=30)


def parse_line(line: str) -> dict | None:
    """Garde uniquement les lignes du journal d'accès JSON (les erreurs Nginx sur stderr sont ignorées)."""
    try:
        rec = json.loads(line)
    except ValueError:
        return None
    if not isinstance(rec, dict) or rec.get("source") != "gateway":
        return None
    return rec


def fetch(start_s: float, end_s: float, client: httpx.Client | None = None) -> Iterator[dict]:
    """Toutes les lignes d'accès entre start et end (secondes epoch), dans l'ordre chronologique, paginées."""
    own = client is None
    c = client or _client()
    try:
        cursor = int(start_s * 1e9)
        end = int(end_s * 1e9)
        while cursor < end:
            r = c.get(
                "/loki/api/v1/query_range",
                params={"query": QUERY, "start": cursor, "end": end, "limit": PAGE, "direction": "forward"},
            )
            r.raise_for_status()
            values = [v for stream in r.json()["data"]["result"] for v in stream["values"]]
            values.sort(key=lambda v: int(v[0]))
            for ts_ns, line in values:
                rec = parse_line(line)
                if rec is not None:
                    rec["_ts"] = int(ts_ns) / 1e9
                    yield rec
            if len(values) < PAGE:
                break
            cursor = int(values[-1][0]) + 1
    finally:
        if own:
            c.close()


def fetch_recent(seconds: float, delay: float = 3.0, client: httpx.Client | None = None) -> list[dict]:
    """Fenêtre glissante [now - delay - seconds, now - delay] : le délai laisse Promtail livrer les lignes."""
    now = time.time() - delay
    return list(fetch(now - seconds, now, client))
