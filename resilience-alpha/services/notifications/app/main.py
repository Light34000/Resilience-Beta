import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from prometheus_client import Counter
from pydantic import BaseModel, Field

from resilience_common.app import create_app
from resilience_common.logs import log_event
from resilience_common.security import current_claims, require_service

log = logging.getLogger("notifications")
app = create_app("notifications", db_schema="notifications")
router = APIRouter(tags=["notifications"])

SENT = Counter("notifications_sent_total", "Notifications envoyées (simulées)", ["kind"])


class EventIn(BaseModel):
    user_id: UUID
    kind: str = Field(max_length=64)
    message: str = Field(max_length=500)
    data: dict[str, Any] = {}


class NotificationOut(BaseModel):
    id: UUID
    kind: str
    message: str
    data: dict[str, Any]
    status: str
    created_at: datetime


@router.post("/internal/events", status_code=202)
async def ingest(body: EventIn, request: Request, _: dict = Depends(require_service("payments", "auth", "remediation"))):
    """Reçoit un événement métier et « envoie » la notification. L'envoi est simulé : on journalise le canal."""
    row = await request.app.state.pool.fetchrow(
        "INSERT INTO notifications (user_id, kind, message, data, status) VALUES ($1, $2, $3, $4::jsonb, 'sent') RETURNING id",
        body.user_id,
        body.kind,
        body.message,
        json.dumps(body.data, default=str),
    )
    SENT.labels(body.kind).inc()
    log_event(log, "notification_sent", channel="email_simulated", user_id=str(body.user_id), kind=body.kind, notification_id=str(row["id"]))
    return {"id": str(row["id"])}


@router.get("/api/notifications/me", response_model=list[NotificationOut])
async def my_notifications(request: Request, limit: int = 50, claims: dict = Depends(current_claims)):
    rows = await request.app.state.pool.fetch(
        "SELECT id, kind, message, data, status, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        UUID(claims["sub"]),
        min(max(limit, 1), 200),
    )
    return [{**dict(r), "data": json.loads(r["data"])} for r in rows]


app.include_router(router)
