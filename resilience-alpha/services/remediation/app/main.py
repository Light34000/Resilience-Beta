"""Moteur de remédiation : reçoit une alerte, exécute une action de LISTE BLANCHE, puis PROUVE la reprise.

Principes de sécurité (axe 2 du barème : « accès du moteur de remédiation maîtrisés ») :
  - il ne parle jamais au socket Docker : il passe par un proxy qui n'autorise que stop/restart/kill de conteneurs ;
  - il ne peut agir que sur 4 conteneurs applicatifs nommés (jamais Postgres, jamais lui-même, jamais le proxy) ;
  - seuls les services « detector » et « canary » peuvent lui envoyer une alerte (jeton de service) ;
  - disjoncteur : au plus N remédiations par service et par fenêtre, sinon escalade vers un humain ;
  - il n'est PAS exposé par la passerelle.

Distinction disponibilité / compromission : seul un service réellement indisponible déclenche un redémarrage.
Une anomalie sans perte de service est escaladée (suspicion de compromission : redémarrer effacerait les preuves
et ne corrigerait rien).
"""

import asyncio
import logging
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from prometheus_client import Counter, Gauge, Histogram
from pydantic import BaseModel, Field

from resilience_common.app import create_app
from resilience_common.config import env
from resilience_common.events import audit
from resilience_common.logs import log_event
from resilience_common.security import require_roles, require_service, service_token

log = logging.getLogger("remediation")

DOCKER_API_URL = env("DOCKER_API_URL", "http://docker-proxy-remediation:2375")
CANARY_URL = env("CANARY_URL", "http://canary:8000")
ACCOUNTS_URL = env("ACCOUNTS_URL", "http://accounts:8000")
RECOVERY_TIMEOUT = float(env("RECOVERY_TIMEOUT_SECONDS", "90") or 90)
MAX_PER_WINDOW = int(env("REMEDIATION_MAX_PER_WINDOW", "3") or 3)
WINDOW_SECONDS = int(env("REMEDIATION_WINDOW_SECONDS", "600") or 600)

# Liste blanche : service logique -> conteneur. C'est la seule surface d'action du moteur.
TARGETS: dict[str, str] = {
    "auth": "rsl-auth",
    "accounts": "rsl-accounts",
    "payments": "rsl-payments",
    "notifications": "rsl-notifications",
}

INCIDENTS = Counter("remediation_incidents_total", "Incidents traités", ["service", "status"])
ACTIVE = Gauge("remediation_active_incidents", "Incidents en cours de traitement")
RECOVERY = Histogram(
    "remediation_recovery_seconds", "Durée détection -> service prouvé rétabli", buckets=(5, 10, 20, 30, 60, 120, 300)
)

_incidents: dict[str, dict[str, Any]] = {}  # en mémoire (prototype) : l'historique durable est dans audit + Loki
_order: deque[str] = deque(maxlen=200)
_active: dict[str, str] = {}  # service -> incident en cours (déduplication)
_attempts: dict[str, deque[float]] = defaultdict(deque)  # service -> horodatages des remédiations (disjoncteur)


class AlertIn(BaseModel):
    source: str = Field(max_length=32)
    service: Literal["auth", "accounts", "payments", "notifications"]
    type: Literal["service_down", "availability_degraded", "anomaly"]
    severity: Literal["low", "medium", "high", "critical"] = "high"
    score: float | None = None
    details: dict[str, Any] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _step(inc: dict, state: str, message: str, **extra) -> None:
    inc["status"] = state
    inc["updated_at"] = _now()
    inc["timeline"].append({"ts": _now(), "state": state, "message": message, **extra})
    log_event(log, "remediation_step", incident_id=inc["id"], service=inc["service"], state=state, message=message)


async def docker_restart(http: httpx.AsyncClient, container: str) -> None:
    if container not in TARGETS.values():
        raise PermissionError(f"Conteneur hors liste blanche : {container}")
    resp = await http.post(f"{DOCKER_API_URL}/containers/{container}/restart", params={"t": 5}, timeout=40)
    if resp.status_code != 204:
        raise RuntimeError(f"Docker a répondu {resp.status_code} au redémarrage de {container}")


async def is_ready(http: httpx.AsyncClient, service: str) -> bool:
    try:
        return (await http.get(f"http://{service}:8000/ready", timeout=2)).status_code == 200
    except httpx.HTTPError:
        return False


async def wait_ready(http: httpx.AsyncClient, service: str) -> bool:
    deadline = time.monotonic() + RECOVERY_TIMEOUT
    while time.monotonic() < deadline:
        if await is_ready(http, service):
            return True
        await asyncio.sleep(2)
    return False


async def run_probe(http: httpx.AsyncClient) -> dict:
    """Demande à la sonde synthétique d'exécuter une VRAIE transaction de bout en bout (via la passerelle)."""
    try:
        resp = await http.get(
            f"{CANARY_URL}/internal/probe", headers={"Authorization": f"Bearer {service_token('remediation')}"}, timeout=20
        )
        return resp.json() if resp.status_code == 200 else {"ok": False, "error": f"http_{resp.status_code}"}
    except (httpx.HTTPError, ValueError) as exc:
        return {"ok": False, "error": type(exc).__name__}


async def check_integrity(http: httpx.AsyncClient) -> bool:
    try:
        resp = await http.get(
            f"{ACCOUNTS_URL}/internal/integrity", headers={"Authorization": f"Bearer {service_token('remediation')}"}, timeout=5
        )
        return resp.status_code == 200 and bool(resp.json().get("consistent"))
    except (httpx.HTTPError, ValueError):
        return False


def _finish(inc: dict, state: str, message: str) -> None:
    _step(inc, state, message)
    started = datetime.fromisoformat(inc["created_at"])
    inc["duration_seconds"] = round((datetime.now(timezone.utc) - started).total_seconds(), 1)
    if _active.get(inc["service"]) == inc["id"]:
        del _active[inc["service"]]
    ACTIVE.dec()
    INCIDENTS.labels(inc["service"], state).inc()
    if state == "resolved":
        RECOVERY.observe(inc["duration_seconds"])
    audit(
        "remediation",
        f"incident_{state}",
        outcome="success" if state == "resolved" else "failure",
        incident_id=inc["id"],
        service=inc["service"],
        duration_seconds=inc["duration_seconds"],
    )


async def run_incident(app: FastAPI, inc: dict) -> None:
    http: httpx.AsyncClient = app.state.http
    service, container = inc["service"], TARGETS[inc["service"]]
    try:
        _step(inc, "detected", f"Alerte {inc['type']} reçue de {inc['source']} (score={inc['score']})")

        if inc["type"] == "anomaly":
            # Anomalie sans preuve d'indisponibilité : on vérifie avant d'agir.
            healthy = await is_ready(http, service) and bool((await run_probe(http)).get("ok"))
            if healthy:
                _finish(inc, "escalated", "Service sain malgré l'anomalie : aucune action destructive, escalade opérateur "
                                          "(suspicion de compromission : conserver les preuves, investiguer via SIEM)")
                return

        _step(inc, "remediating", f"Redémarrage du conteneur {container}")
        await docker_restart(http, container)

        _step(inc, "verifying", "Attente de la disponibilité du service")
        if not await wait_ready(http, service):
            _finish(inc, "failed", f"{service} toujours indisponible après {RECOVERY_TIMEOUT:.0f}s : escalade opérateur")
            return

        # Un conteneur qui redémarre ne prouve rien : on exige une nouvelle transaction réussie ET des données cohérentes.
        probe: dict = {}
        for _ in range(5):
            probe = await run_probe(http)
            if probe.get("ok"):
                break
            await asyncio.sleep(2)
        if not probe.get("ok"):
            _finish(inc, "failed", f"Transaction de contrôle en échec après reprise ({probe.get('error') or probe.get('failed_phase')})")
            return
        _step(inc, "verifying", "Nouvelle transaction de contrôle réussie", probe_ms=probe.get("duration_ms"))

        if not await check_integrity(http):
            _finish(inc, "failed", "Incohérence détectée entre soldes et écritures : restauration des données requise (PRA)")
            return
        _finish(inc, "resolved", "Service rétabli : transaction réussie et données cohérentes")
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        log_event(log, "remediation_error", logging.ERROR, incident_id=inc["id"], error=repr(exc))
        _finish(inc, "failed", f"Erreur interne du moteur : {type(exc).__name__}")


async def startup(app: FastAPI) -> None:
    app.state.http = httpx.AsyncClient()
    app.state.tasks = set()


async def shutdown(app: FastAPI) -> None:
    for task in list(app.state.tasks):
        task.cancel()
    await app.state.http.aclose()


app = create_app("remediation", startup=startup, shutdown=shutdown)
router = APIRouter(prefix="/internal", tags=["remediation"])


@router.post("/alerts", status_code=202)
async def receive_alert(alert: AlertIn, request: Request, claims: dict = Depends(require_service("detector", "canary"))):
    service = alert.service

    if service in _active:
        return {"incident_id": _active[service], "deduplicated": True}

    # Disjoncteur : évite les boucles de redémarrage et limite l'impact d'une fausse alerte forgée.
    attempts = _attempts[service]
    now = time.monotonic()
    while attempts and now - attempts[0] > WINDOW_SECONDS:
        attempts.popleft()

    inc = {
        "id": uuid.uuid4().hex[:12],
        "service": service,
        "type": alert.type,
        "severity": alert.severity,
        "source": alert.source,
        "score": alert.score,
        "details": alert.details,
        "status": "detected",
        "created_at": _now(),
        "updated_at": _now(),
        "duration_seconds": None,
        "timeline": [],
    }
    _incidents[inc["id"]] = inc
    _order.append(inc["id"])
    if len(_incidents) > _order.maxlen:  # type: ignore[operator]
        for stale in set(_incidents) - set(_order):
            _incidents.pop(stale, None)

    if len(attempts) >= MAX_PER_WINDOW:
        _step(inc, "suppressed", f"Disjoncteur : {MAX_PER_WINDOW} remédiations en {WINDOW_SECONDS}s sur {service}, escalade opérateur")
        INCIDENTS.labels(service, "suppressed").inc()
        audit("remediation", "incident_suppressed", outcome="denied", incident_id=inc["id"], service=service)
        return {"incident_id": inc["id"], "suppressed": True}

    attempts.append(now)
    _active[service] = inc["id"]
    ACTIVE.inc()
    audit("remediation", "incident_opened", incident_id=inc["id"], service=service, type=alert.type, source=claims["sub"], score=alert.score)
    task = asyncio.create_task(run_incident(request.app, inc))
    request.app.state.tasks.add(task)
    task.add_done_callback(request.app.state.tasks.discard)
    return {"incident_id": inc["id"], "deduplicated": False}


@router.get("/incidents")
async def list_incidents(_: dict = Depends(require_roles("admin", "service"))):
    return [_incidents[i] for i in reversed(_order) if i in _incidents]


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str, _: dict = Depends(require_roles("admin", "service"))):
    if incident_id not in _incidents:
        raise HTTPException(404, "Incident introuvable")
    return _incidents[incident_id]


app.include_router(router)
