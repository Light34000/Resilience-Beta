"""Émission d'événements vers audit et notifications.

Best effort et non bloquant : une panne d'audit ou de notifications ne doit jamais faire échouer un paiement.
Les échecs d'émission sont journalisés (event_delivery_failed) donc visibles dans Loki/SIEM.
"""

import asyncio
import json
import logging
from typing import Any

import httpx

from .config import env
from .logs import log_event
from .security import service_token

log = logging.getLogger("events")
_background: set[asyncio.Task] = set()


async def _post(service: str, url: str, payload: dict[str, Any]) -> None:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.post(
                url,
                content=json.dumps(payload, default=str),
                headers={
                    "Authorization": f"Bearer {service_token(service)}",
                    "Content-Type": "application/json",
                },
            )
            if resp.status_code >= 300:
                log_event(log, "event_delivery_failed", logging.WARNING, target=url, status=resp.status_code)
    except Exception as exc:  # noqa: BLE001 - best effort assumé
        log_event(log, "event_delivery_failed", logging.WARNING, target=url, error=type(exc).__name__)


def _fire(coro) -> None:
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


# Paramètres positionnels uniquement (/) : `service` peut aussi figurer dans les détails
# (ex. remédiation : audit("remediation", "incident_opened", service="payments")).
def audit(service: str, action: str, /, *, actor: str | None = None, outcome: str = "success", **details) -> None:
    base = env("AUDIT_URL")
    if base:
        _fire(
            _post(
                service,
                f"{base}/internal/events",
                {"action": action, "actor": actor, "outcome": outcome, "details": details},
            )
        )


def notify(service: str, user_id: str, kind: str, message: str, /, **data) -> None:
    base = env("NOTIFICATIONS_URL")
    if base:
        _fire(
            _post(
                service,
                f"{base}/internal/events",
                {"user_id": user_id, "kind": kind, "message": message, "data": data},
            )
        )
