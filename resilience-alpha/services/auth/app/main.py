import asyncio
import logging
import time
from collections import defaultdict, deque

import asyncpg
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from resilience_common.app import client_ip, create_app
from resilience_common.config import env
from resilience_common.events import audit
from resilience_common.logs import log_event
from resilience_common.security import create_token, current_claims, hash_password, verify_password

log = logging.getLogger("auth")

ACCESS_TTL = int(env("ACCESS_TTL_SECONDS", "900") or 900)
MAX_FAILURES = int(env("LOGIN_MAX_FAILURES", "5") or 5)
WINDOW = int(env("LOGIN_WINDOW_SECONDS", "60") or 60)

# Compteur d'échecs en mémoire (par IP et par compte). Suffisant pour un prototype mono-instance ;
# avec plusieurs réplicas il faudrait Redis.
_failures: dict[str, deque[float]] = defaultdict(deque)
_DUMMY_HASH = hash_password("mot-de-passe-factice-pour-egaliser-le-temps")


def _failure_count(key: str) -> int:
    q = _failures.get(key)
    if not q:
        return 0
    now = time.monotonic()
    while q and now - q[0] > WINDOW:
        q.popleft()
    if not q:
        del _failures[key]
        return 0
    return len(q)


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class UserOut(BaseModel):
    id: str
    username: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


async def seed_admin(app: FastAPI) -> None:
    """Crée le compte admin de démonstration si ADMIN_PASSWORD est fourni (via .env / Vault, jamais en dur)."""
    password = env("ADMIN_PASSWORD")
    if not password:
        return
    username = (env("ADMIN_USERNAME", "admin") or "admin").lower()
    hashed = await asyncio.to_thread(hash_password, password)
    await app.state.pool.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') ON CONFLICT (username) DO NOTHING",
        username,
        hashed,
    )


app = create_app("auth", db_schema="auth", startup=seed_admin)
router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", status_code=201, response_model=UserOut)
async def register(body: RegisterIn, request: Request):
    hashed = await asyncio.to_thread(hash_password, body.password)  # bcrypt est CPU-bound : hors boucle d'événements
    username = body.username.lower()
    try:
        row = await request.app.state.pool.fetchrow(
            "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'customer') RETURNING id, username, role",
            username,
            hashed,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "Nom d'utilisateur déjà pris")
    audit("auth", "user_registered", actor=username, user_id=str(row["id"]))
    return UserOut(id=str(row["id"]), username=row["username"], role=row["role"])


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request):
    ip = client_ip(request)
    username = body.username.lower()

    if _failure_count(f"ip:{ip}") >= MAX_FAILURES or _failure_count(f"user:{username}") >= MAX_FAILURES:
        log_event(log, "login_blocked", logging.WARNING, username=username, client_ip=ip)
        audit("auth", "login_blocked", actor=username, outcome="denied", client_ip=ip)
        raise HTTPException(429, "Trop de tentatives, réessayez plus tard", headers={"Retry-After": str(WINDOW)})

    row = await request.app.state.pool.fetchrow(
        "SELECT id, password_hash, role FROM users WHERE username = $1", username
    )
    # On vérifie toujours un hash (factice si le compte n'existe pas) : pas de fuite par le temps de réponse.
    valid = await asyncio.to_thread(verify_password, body.password, row["password_hash"] if row else _DUMMY_HASH)

    if not row or not valid:
        now = time.monotonic()
        _failures[f"ip:{ip}"].append(now)
        _failures[f"user:{username}"].append(now)
        log_event(log, "login_failed", logging.WARNING, username=username, client_ip=ip)
        audit("auth", "login_failed", actor=username, outcome="failure", client_ip=ip)
        raise HTTPException(401, "Identifiants invalides")

    token = create_token(str(row["id"]), row["role"], ACCESS_TTL, username=username)
    log_event(log, "login_success", username=username, client_ip=ip)
    audit("auth", "login_success", actor=username, client_ip=ip)
    return TokenOut(access_token=token, expires_in=ACCESS_TTL)


@router.get("/me")
async def me(claims: dict = Depends(current_claims)):
    return {"id": claims["sub"], "username": claims.get("username"), "role": claims["role"]}


app.include_router(router)
