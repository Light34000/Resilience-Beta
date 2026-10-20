import logging
from datetime import datetime
from decimal import Decimal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from resilience_common.app import create_app
from resilience_common.events import audit
from resilience_common.logs import log_event
from resilience_common.security import current_claims, require_roles, require_service

log = logging.getLogger("accounts")
app = create_app("accounts", db_schema="accounts")
router = APIRouter(tags=["accounts"])


class AccountCreate(BaseModel):
    currency: str = Field("EUR", pattern=r"^[A-Z]{3}$")
    # DÉMO UNIQUEMENT : alimentation fictive du compte à l'ouverture (écriture de crédit initiale au ledger).
    initial_balance: Decimal = Field(Decimal("1000.00"), ge=0, le=Decimal("100000"), max_digits=12, decimal_places=2)


class AccountOut(BaseModel):
    id: UUID
    owner_id: UUID
    currency: str
    balance: Decimal
    created_at: datetime


class TransferIn(BaseModel):
    tx_id: UUID  # = id du paiement : clé d'idempotence côté ledger
    initiator_id: UUID
    from_account: UUID
    to_account: UUID
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)


class TransferOut(BaseModel):
    tx_id: UUID
    status: str  # applied | already_applied


@router.post("/api/accounts", status_code=201, response_model=AccountOut)
async def open_account(body: AccountCreate, request: Request, claims: dict = Depends(require_roles("customer", "admin"))):
    owner = UUID(claims["sub"])
    async with request.app.state.pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "INSERT INTO accounts (owner_id, currency, balance) VALUES ($1, $2, $3) RETURNING *",
            owner,
            body.currency,
            body.initial_balance,
        )
        if body.initial_balance > 0:
            await conn.execute(
                "INSERT INTO ledger_entries (tx_id, account_id, direction, amount) VALUES (gen_random_uuid(), $1, 'credit', $2)",
                row["id"],
                body.initial_balance,
            )
    audit("accounts", "account_opened", actor=str(owner), account_id=str(row["id"]))
    return dict(row)


@router.get("/api/accounts/me", response_model=list[AccountOut])
async def my_accounts(request: Request, claims: dict = Depends(current_claims)):
    rows = await request.app.state.pool.fetch(
        "SELECT * FROM accounts WHERE owner_id = $1 ORDER BY created_at", UUID(claims["sub"])
    )
    return [dict(r) for r in rows]


@router.get("/api/accounts/{account_id}", response_model=AccountOut)
async def get_account(account_id: UUID, request: Request, claims: dict = Depends(current_claims)):
    row = await request.app.state.pool.fetchrow("SELECT * FROM accounts WHERE id = $1", account_id)
    if not row or (str(row["owner_id"]) != claims["sub"] and claims["role"] != "admin"):
        raise HTTPException(404, "Compte introuvable")  # 404 aussi pour « pas à vous » : pas d'énumération
    return dict(row)


@router.post("/internal/transfer", response_model=TransferOut)
async def transfer(body: TransferIn, request: Request, _: dict = Depends(require_service("payments"))):
    """Débit + crédit atomiques, idempotents par tx_id. Appelable uniquement par le service payments."""
    if body.from_account == body.to_account:
        raise HTTPException(422, "same_account")

    async with request.app.state.pool.acquire() as conn:
        try:
            async with conn.transaction():
                # Verrou des deux comptes dans un ordre fixe (par id) : pas d'interblocage entre transferts croisés.
                rows = await conn.fetch(
                    "SELECT id, owner_id, currency, balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
                    [body.from_account, body.to_account],
                )
                accounts = {r["id"]: r for r in rows}
                if len(accounts) != 2:
                    raise HTTPException(404, "account_not_found")
                src, dst = accounts[body.from_account], accounts[body.to_account]

                if src["owner_id"] != body.initiator_id:
                    raise HTTPException(403, "not_account_owner")
                if await conn.fetchval("SELECT 1 FROM ledger_entries WHERE tx_id = $1 LIMIT 1", body.tx_id):
                    return TransferOut(tx_id=body.tx_id, status="already_applied")
                if src["currency"] != dst["currency"]:
                    raise HTTPException(422, "currency_mismatch")
                if src["balance"] < body.amount:
                    raise HTTPException(422, "insufficient_funds")

                await conn.execute("UPDATE accounts SET balance = balance - $2 WHERE id = $1", src["id"], body.amount)
                await conn.execute("UPDATE accounts SET balance = balance + $2 WHERE id = $1", dst["id"], body.amount)
                await conn.execute(
                    "INSERT INTO ledger_entries (tx_id, account_id, direction, amount) VALUES ($1, $2, 'debit', $3), ($1, $4, 'credit', $3)",
                    body.tx_id,
                    src["id"],
                    body.amount,
                    dst["id"],
                )
        except asyncpg.UniqueViolationError:
            return TransferOut(tx_id=body.tx_id, status="already_applied")

    log_event(log, "transfer_applied", tx_id=str(body.tx_id), amount=str(body.amount))
    return TransferOut(tx_id=body.tx_id, status="applied")


@router.get("/internal/integrity")
async def integrity(request: Request, _: dict = Depends(require_roles("admin", "service"))):
    """Cohérence des données : le solde de chaque compte doit être égal à la somme de ses écritures.
    Utilisé par le canary et par le moteur de remédiation pour prouver que la reprise n'a pas corrompu les données."""
    rows = await request.app.state.pool.fetch(
        """
        SELECT a.id, a.balance,
               COALESCE(SUM(CASE l.direction WHEN 'credit' THEN l.amount ELSE -l.amount END), 0) AS ledger_balance
        FROM accounts a LEFT JOIN ledger_entries l ON l.account_id = a.id
        GROUP BY a.id, a.balance
        HAVING a.balance <> COALESCE(SUM(CASE l.direction WHEN 'credit' THEN l.amount ELSE -l.amount END), 0)
        LIMIT 50
        """
    )
    mismatches = [
        {"account_id": str(r["id"]), "balance": str(r["balance"]), "ledger_balance": str(r["ledger_balance"])}
        for r in rows
    ]
    if mismatches:
        log_event(log, "integrity_violation", logging.ERROR, mismatches=len(mismatches))
    return {"consistent": not mismatches, "mismatches": mismatches}


app.include_router(router)
