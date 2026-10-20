"""Sonde synthétique : exécute en continu une vraie transaction fictive de bout en bout, via la passerelle.

C'est elle qui rend la reprise PROUVABLE (« nouvelle transaction réussie ») et qui fournit au dashboard l'état
du service avant / pendant / après l'incident (métriques canary_* dans Prometheus, historique via /internal/history).

Elle peut aussi alerter le moteur de remédiation (filet de sécurité déterministe). Le déclencheur principal
attendu pour la démo reste le détecteur ML (service « detector »).
"""

import asyncio
import logging
import time
import uuid
from collections import deque
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, FastAPI
from prometheus_client import Counter, Gauge

from resilience_common.app import create_app
from resilience_common.config import env
from resilience_common.logs import log_event
from resilience_common.security import require_roles, service_token

log = logging.getLogger("canary")

GATEWAY_URL = env("GATEWAY_URL", "http://gateway:8080")
ACCOUNTS_URL = env("ACCOUNTS_URL", "http://accounts:8000")
REMEDIATION_URL = env("REMEDIATION_URL", "http://remediation:8000")
INTERVAL = float(env("PROBE_INTERVAL_SECONDS", "5") or 5)
FAILURES_BEFORE_ALERT = int(env("PROBE_FAILURES_BEFORE_ALERT", "3") or 3)
ALERTS_ENABLED = (env("CANARY_ALERTS_ENABLED", "true") or "true").lower() == "true"
ALERT_COOLDOWN = 30.0
SERVICES = ["auth", "accounts", "payments", "notifications"]
CANARY_USER = env("CANARY_USERNAME", "canary-bot") or "canary-bot"
PHASE_TO_SERVICE = {"login": "auth", "accounts": "accounts", "payment": "payments"}

UP = Gauge("canary_up", "1 si la dernière transaction de sonde a réussi")
DURATION = Gauge("canary_probe_duration_seconds", "Durée de la dernière transaction de sonde")
LAST_OK = Gauge("canary_last_success_timestamp_seconds", "Horodatage de la dernière transaction réussie")
CONSISTENT = Gauge("canary_data_consistent", "1 si soldes et écritures du ledger sont cohérents")
SERVICE_READY = Gauge("canary_service_ready", "Disponibilité (/ready) de chaque service", ["service"])
PROBES = Counter("canary_probes_total", "Sondes exécutées", ["result"])


class ProbeError(Exception):
    def __init__(self, phase: str, message: str) -> None:
        super().__init__(message)
        self.phase = phase


class State:
    def __init__(self) -> None:
        self.token: str | None = None
        self.token_exp = 0.0
        self.accounts: list[str] = []
        self.flip = 0
        self.history: deque[dict] = deque(maxlen=120)
        self.consecutive_failures = 0
        self.last_alert: dict[str, float] = {}
        self.lock = asyncio.Lock()


async def _ensure_session(st: State, http: httpx.AsyncClient) -> None:
    if st.token and st.token_exp > time.time() + 30:
        return
    creds = {"username": CANARY_USER, "password": env("CANARY_PASSWORD", required=True)}
    resp = await http.post(f"{GATEWAY_URL}/api/auth/login", json=creds)
    if resp.status_code == 401:  # premier démarrage : le compte de sonde n'existe pas encore
        reg = await http.post(f"{GATEWAY_URL}/api/auth/register", json=creds)
        if reg.status_code not in (201, 409):
            raise ProbeError("login", f"register_http_{reg.status_code}")
        resp = await http.post(f"{GATEWAY_URL}/api/auth/login", json=creds)
    if resp.status_code != 200:
        raise ProbeError("login", f"login_http_{resp.status_code}")
    data = resp.json()
    st.token, st.token_exp = data["access_token"], time.time() + data["expires_in"]


async def _ensure_accounts(st: State, http: httpx.AsyncClient) -> None:
    if len(st.accounts) == 2:
        return
    headers = {"Authorization": f"Bearer {st.token}"}
    resp = await http.get(f"{GATEWAY_URL}/api/accounts/me", headers=headers)
    if resp.status_code != 200:
        raise ProbeError("accounts", f"list_http_{resp.status_code}")
    ids = [a["id"] for a in resp.json()]
    while len(ids) < 2:
        created = await http.post(f"{GATEWAY_URL}/api/accounts", json={"initial_balance": "1000.00"}, headers=headers)
        if created.status_code != 201:
            raise ProbeError("accounts", f"create_http_{created.status_code}")
        ids.append(created.json()["id"])
    st.accounts = ids[:2]


async def probe(app: FastAPI) -> dict:
    st: State = app.state.canary
    http: httpx.AsyncClient = app.state.http
    started = time.perf_counter()
    phase, error, payment_id, consistent = "ready", None, None, None

    # 1) état de chaque service : permet de désigner le service fautif dans l'alerte
    flags = await asyncio.gather(*(_ready(http, s) for s in SERVICES))
    ready = dict(zip(SERVICES, flags))
    for name, flag in ready.items():
        SERVICE_READY.labels(name).set(1 if flag else 0)

    # 2) transaction réelle de bout en bout, via la passerelle
    try:
        phase = "login"
        await _ensure_session(st, http)
        phase = "accounts"
        await _ensure_accounts(st, http)
        phase = "payment"
        src, dst = st.accounts[st.flip % 2], st.accounts[(st.flip + 1) % 2]
        resp = await http.post(
            f"{GATEWAY_URL}/api/payments",
            json={"from_account": src, "to_account": dst, "amount": "0.01"},
            headers={"Authorization": f"Bearer {st.token}", "Idempotency-Key": uuid.uuid4().hex, "User-Agent": "resilience-canary/1.0"},
        )
        if resp.status_code == 401:
            st.token = None
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code != 201 or body.get("status") != "completed":
            raise ProbeError("payment", f"payment_http_{resp.status_code}")
        payment_id = body["id"]
        st.flip += 1
        phase = "integrity"
        integ = await http.get(f"{ACCOUNTS_URL}/internal/integrity", headers={"Authorization": f"Bearer {service_token('canary')}"})
        consistent = integ.status_code == 200 and bool(integ.json().get("consistent"))
        ok = True
    except ProbeError as exc:
        ok, error, phase = False, str(exc), exc.phase
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        ok, error = False, type(exc).__name__

    duration = time.perf_counter() - started
    result = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "ok": ok,
        "duration_ms": round(duration * 1000),
        "ready": ready,
        "consistent": consistent,
        "failed_phase": None if ok else phase,
        "error": error,
        "payment_id": payment_id,
    }
    _record(app, result)
    return result


async def _ready(http: httpx.AsyncClient, service: str) -> bool:
    try:
        return (await http.get(f"http://{service}:8000/ready", timeout=2)).status_code == 200
    except httpx.HTTPError:
        return False


def _record(app: FastAPI, result: dict) -> None:
    st: State = app.state.canary
    st.history.append(result)
    UP.set(1 if result["ok"] else 0)
    DURATION.set(result["duration_ms"] / 1000)
    PROBES.labels("success" if result["ok"] else "failure").inc()
    if result["consistent"] is not None:
        CONSISTENT.set(1 if result["consistent"] else 0)
    if result["ok"]:
        LAST_OK.set(time.time())
        if st.consecutive_failures:
            log_event(log, "canary_recovered", after_failures=st.consecutive_failures)
        st.consecutive_failures = 0
    else:
        st.consecutive_failures += 1
        log_event(log, "canary_probe_failed", logging.WARNING, phase=result["failed_phase"], error=result["error"],
                  consecutive=st.consecutive_failures, down=[s for s, r in result["ready"].items() if not r])
        if ALERTS_ENABLED and st.consecutive_failures >= FAILURES_BEFORE_ALERT:
            asyncio.create_task(_alert(app, result))


async def _alert(app: FastAPI, result: dict) -> None:
    st: State = app.state.canary
    down = [s for s, r in result["ready"].items() if not r]
    targets = down or ([PHASE_TO_SERVICE[result["failed_phase"]]] if result["failed_phase"] in PHASE_TO_SERVICE else [])
    for service in targets:
        if time.monotonic() - st.last_alert.get(service, -ALERT_COOLDOWN) < ALERT_COOLDOWN:
            continue
        st.last_alert[service] = time.monotonic()
        payload = {
            "source": "canary",
            "service": service,
            "type": "service_down" if service in down else "availability_degraded",
            "severity": "high",
            "details": {"phase": result["failed_phase"], "error": result["error"]},
        }
        try:
            await app.state.http.post(
                f"{REMEDIATION_URL}/internal/alerts", json=payload, headers={"Authorization": f"Bearer {service_token('canary')}"}, timeout=3
            )
            log_event(log, "canary_alert_sent", service=service, type=payload["type"])
        except httpx.HTTPError as exc:
            log_event(log, "canary_alert_failed", logging.WARNING, service=service, error=type(exc).__name__)


async def probe_loop(app: FastAPI) -> None:
    while True:
        try:
            async with app.state.canary.lock:
                await probe(app)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log_event(log, "canary_loop_error", logging.ERROR, error=repr(exc))
        await asyncio.sleep(INTERVAL)


async def startup(app: FastAPI) -> None:
    app.state.canary = State()
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=2.0))
    app.state.loop_task = asyncio.create_task(probe_loop(app))


async def shutdown(app: FastAPI) -> None:
    app.state.loop_task.cancel()
    await app.state.http.aclose()


app = create_app("canary", startup=startup, shutdown=shutdown)
router = APIRouter(prefix="/internal", tags=["canary"])


@router.get("/probe")
async def run_now(_: dict = Depends(require_roles("admin", "service"))):
    """Exécute une transaction de contrôle immédiate (utilisé par le moteur de remédiation pour valider la reprise)."""
    async with app.state.canary.lock:
        return await probe(app)


@router.get("/status")
async def status(_: dict = Depends(require_roles("admin", "service"))):
    st: State = app.state.canary
    last = st.history[-1] if st.history else None
    return {"last": last, "consecutive_failures": st.consecutive_failures}


@router.get("/history")
async def history(_: dict = Depends(require_roles("admin", "service"))):
    return list(app.state.canary.history)


app.include_router(router)
