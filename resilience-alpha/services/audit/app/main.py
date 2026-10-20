"""Piste d'audit métier et sécurité : append-only, chaînée par hash (détection d'altération).

Complète les logs techniques (stdout -> Promtail -> Loki) : ici, uniquement des événements qui comptent
(connexions, paiements, actions de remédiation) et qu'on doit pouvoir prouver.
Le rôle Postgres svc_audit n'a ni UPDATE ni DELETE.
"""

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from resilience_common.app import create_app
from resilience_common.logs import log_event
from resilience_common.security import require_roles

log = logging.getLogger("audit")
app = create_app("audit", db_schema="audit")
router = APIRouter(tags=["audit"])

GENESIS = "0" * 64
LOCK_ID = 7001


class AuditIn(BaseModel):
    action: str = Field(max_length=64)
    actor: str | None = Field(None, max_length=64)
    outcome: str = Field("success", max_length=16)
    details: dict[str, Any] = {}


def _canonical(details: Any) -> str:
    return json.dumps(details, sort_keys=True, separators=(",", ":"), default=str)


def _hash(prev: str, ts: datetime, service: str, action: str, actor: str | None, outcome: str, details_json: str) -> str:
    ts_iso = ts.astimezone(timezone.utc).isoformat()
    raw = "|".join([prev, ts_iso, service, action, actor or "", outcome, details_json])
    return hashlib.sha256(raw.encode()).hexdigest()


@router.post("/internal/events", status_code=201)
async def ingest(body: AuditIn, request: Request, claims: dict = Depends(require_roles("service"))):
    service = claims["sub"]  # imposé par le jeton : un service ne peut pas écrire sous le nom d'un autre
    ts = datetime.now(timezone.utc)
    details_json = _canonical(body.details)
    async with request.app.state.pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", LOCK_ID)  # sérialise l'écriture de la chaîne
        prev = await conn.fetchval("SELECT hash FROM events ORDER BY id DESC LIMIT 1") or GENESIS
        digest = _hash(prev, ts, service, body.action, body.actor, body.outcome, details_json)
        event_id = await conn.fetchval(
            """
            INSERT INTO events (ts, service, action, actor, outcome, details, prev_hash, hash)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id
            """,
            ts, service, body.action, body.actor, body.outcome, details_json, prev, digest,
        )
    log_event(log, "audit_recorded", audit_id=event_id, source=service, action=body.action, outcome=body.outcome)
    return {"id": event_id}


@router.get("/api/audit/events")
async def list_events(
    request: Request,
    service: str | None = None,
    action: str | None = None,
    limit: int = 100,
    _: dict = Depends(require_roles("admin")),
):
    rows = await request.app.state.pool.fetch(
        """
        SELECT id, ts, service, action, actor, outcome, details, hash
        FROM events
        WHERE ($1::text IS NULL OR service = $1) AND ($2::text IS NULL OR action = $2)
        ORDER BY id DESC LIMIT $3
        """,
        service, action, min(max(limit, 1), 500),
    )
    return [{**dict(r), "details": json.loads(r["details"])} for r in rows]


@router.get("/api/audit/verify")
async def verify_chain(request: Request, _: dict = Depends(require_roles("admin"))):
    """Recalcule toute la chaîne. Prototype : plafonné à 100 000 événements."""
    rows = await request.app.state.pool.fetch(
        "SELECT id, ts, service, action, actor, outcome, details, prev_hash, hash FROM events ORDER BY id LIMIT 100000"
    )
    prev = GENESIS
    for r in rows:
        expected = _hash(prev, r["ts"], r["service"], r["action"], r["actor"], r["outcome"], _canonical(json.loads(r["details"])))
        if r["prev_hash"] != prev or r["hash"] != expected:
            log_event(log, "audit_chain_broken", logging.ERROR, first_invalid_id=r["id"])
            return {"valid": False, "checked": len(rows), "first_invalid_id": r["id"]}
        prev = r["hash"]
    return {"valid": True, "checked": len(rows), "first_invalid_id": None}


app.include_router(router)
