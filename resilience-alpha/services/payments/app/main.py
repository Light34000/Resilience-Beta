import asyncio
import logging
from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

import asyncpg
import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, Response
from prometheus_client import Counter
from pydantic import BaseModel, Field

from resilience_common.app import create_app
from resilience_common.config import env
from resilience_common.events import audit, notify
from resilience_common.logs import log_event
from resilience_common.security import current_claims, require_roles, service_token

log = logging.getLogger("payments")

ACCOUNTS_URL = env("ACCOUNTS_URL", "http://accounts:8000")
MAX_AMOUNT = Decimal(env("PAYMENT_MAX_AMOUNT", "5000") or "5000")
RECONCILE_INTERVAL = float(env("RECONCILE_INTERVAL_SECONDS", "15") or 15)

PAYMENTS = Counter("payments_total", "Paiements arrivés à un statut final", ["status"])


class PaymentIn(BaseModel):
    from_account: UUID
    to_account: UUID
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    currency: str = Field("EUR", pattern=r"^[A-Z]{3}$")


class PaymentOut(BaseModel):
    id: UUID
    from_account: UUID
    to_account: UUID
    amount: Decimal
    currency: str
    status: str
    failure_reason: str | None
    created_at: datetime
    updated_at: datetime


def _reason(resp: httpx.Response) -> str:
    try:
        detail = resp.json().get("detail")
    except Exception:  # noqa: BLE001
        detail = None
    return str(detail)[:200] if detail else f"http_{resp.status_code}"


async def settle(app: FastAPI, payment: asyncpg.Record) -> asyncpg.Record:
    """Demande le transfert au ledger (idempotent : tx_id = id du paiement) puis met à jour le statut.
    Si le ledger est injoignable, le paiement reste « pending » : le réconciliateur le rejouera sans doublon."""
    try:
        resp = await app.state.http.post(
            f"{ACCOUNTS_URL}/internal/transfer",
            json={
                "tx_id": str(payment["id"]),
                "initiator_id": str(payment["created_by"]),
                "from_account": str(payment["from_account"]),
                "to_account": str(payment["to_account"]),
                "amount": str(payment["amount"]),
            },
            headers={"Authorization": f"Bearer {service_token('payments')}"},
        )
    except httpx.HTTPError as exc:
        log_event(log, "ledger_unreachable", logging.WARNING, payment_id=str(payment["id"]), error=type(exc).__name__)
        return payment

    if resp.status_code == 200:
        status, reason = "completed", None
    elif resp.status_code in (401, 408, 429) or resp.status_code >= 500:
        log_event(log, "ledger_error", logging.WARNING, payment_id=str(payment["id"]), status=resp.status_code)
        return payment  # erreur transitoire : on ne conclut pas
    else:
        status, reason = "failed", _reason(resp)

    row = await app.state.pool.fetchrow(
        "UPDATE payments SET status = $2, failure_reason = $3, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *",
        payment["id"],
        status,
        reason,
    )
    if row is None:  # réglé entre-temps par une autre requête ou par le réconciliateur
        return await app.state.pool.fetchrow("SELECT * FROM payments WHERE id = $1", payment["id"])

    PAYMENTS.labels(status).inc()
    user = str(row["created_by"])
    audit("payments", f"payment_{status}", actor=user, payment_id=str(row["id"]), amount=str(row["amount"]), reason=reason)
    notify(
        "payments",
        user,
        f"payment_{status}",
        f"Paiement de {row['amount']} {row['currency']} : {'effectué' if status == 'completed' else 'refusé'}",
        payment_id=str(row["id"]),
    )
    log_event(log, f"payment_{status}", payment_id=str(row["id"]), amount=str(row["amount"]), reason=reason)
    return row


async def reconcile_loop(app: FastAPI) -> None:
    """Autoguérison côté données : les paiements restés « pending » (ledger indisponible pendant un incident)
    sont rejoués. Idempotence garantie par tx_id : aucun double débit possible."""
    while True:
        await asyncio.sleep(RECONCILE_INTERVAL)
        try:
            rows = await app.state.pool.fetch(
                "SELECT * FROM payments WHERE status = 'pending' AND created_at < now() - interval '10 seconds' ORDER BY created_at LIMIT 20"
            )
            for row in rows:
                done = await settle(app, row)
                if done["status"] != "pending":
                    log_event(log, "payment_reconciled", payment_id=str(row["id"]), status=done["status"])
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log_event(log, "reconcile_error", logging.WARNING, error=type(exc).__name__)


async def startup(app: FastAPI) -> None:
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0))
    app.state.reconciler = asyncio.create_task(reconcile_loop(app))


async def shutdown(app: FastAPI) -> None:
    app.state.reconciler.cancel()
    await app.state.http.aclose()


app = create_app("payments", db_schema="payments", startup=startup, shutdown=shutdown)
router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("", response_model=PaymentOut, status_code=201)
async def create_payment(
    body: PaymentIn,
    request: Request,
    response: Response,
    idempotency_key: Annotated[str, Header(min_length=8, max_length=64)],
    claims: dict = Depends(require_roles("customer", "admin")),
):
    user = UUID(claims["sub"])
    if body.from_account == body.to_account:
        raise HTTPException(422, "Comptes identiques")
    if body.amount > MAX_AMOUNT:
        audit("payments", "payment_rejected", actor=str(user), outcome="denied", reason="amount_limit", amount=str(body.amount))
        log_event(log, "payment_rejected", logging.WARNING, reason="amount_limit", amount=str(body.amount), user_id=str(user))
        raise HTTPException(422, f"Montant supérieur au plafond autorisé ({MAX_AMOUNT})")

    pool = request.app.state.pool
    row = await pool.fetchrow(
        """
        INSERT INTO payments (idempotency_key, created_by, from_account, to_account, amount, currency, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        ON CONFLICT (created_by, idempotency_key) DO NOTHING
        RETURNING *
        """,
        idempotency_key,
        user,
        body.from_account,
        body.to_account,
        body.amount,
        body.currency,
    )
    replay = row is None
    if replay:
        row = await pool.fetchrow(
            "SELECT * FROM payments WHERE created_by = $1 AND idempotency_key = $2", user, idempotency_key
        )
        if (row["from_account"], row["to_account"], row["amount"]) != (body.from_account, body.to_account, body.amount):
            raise HTTPException(409, "Idempotency-Key déjà utilisée avec une requête différente")

    if row["status"] == "pending":
        row = await settle(request.app, row)
    if row["status"] == "pending":
        raise HTTPException(
            503,
            {"error": "ledger_unavailable", "payment_id": str(row["id"]), "status": "pending"},
            headers={"Retry-After": "5"},
        )

    response.status_code = 200 if replay else 201
    return dict(row)


@router.get("", response_model=list[PaymentOut])
async def list_payments(request: Request, limit: int = 50, claims: dict = Depends(current_claims)):
    rows = await request.app.state.pool.fetch(
        "SELECT * FROM payments WHERE created_by = $1 ORDER BY created_at DESC LIMIT $2",
        UUID(claims["sub"]),
        min(max(limit, 1), 200),
    )
    return [dict(r) for r in rows]


@router.get("/{payment_id}", response_model=PaymentOut)
async def get_payment(payment_id: UUID, request: Request, claims: dict = Depends(current_claims)):
    row = await request.app.state.pool.fetchrow("SELECT * FROM payments WHERE id = $1", payment_id)
    if not row or (str(row["created_by"]) != claims["sub"] and claims["role"] != "admin"):
        raise HTTPException(404, "Paiement introuvable")
    return dict(row)


app.include_router(router)
