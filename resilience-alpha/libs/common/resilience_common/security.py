"""JWT, hachage de mots de passe et contrôle d'accès (rôles utilisateur + identité de service).

Limite connue du prototype : HS256 avec un secret partagé. N'importe quel service qui connaît JWT_SECRET
peut fabriquer un jeton de service. Industrialisation : clés asymétriques par service (RS256/EdDSA) via Vault.
"""

import time
import uuid

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import env

ALGORITHM = "HS256"
ISSUER = "resilience-alpha"
_bearer = HTTPBearer(auto_error=False)


def _secret() -> str:
    return env("JWT_SECRET", required=True)  # type: ignore[return-value]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


def create_token(sub: str, role: str, ttl_seconds: int, **extra) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "sub": sub,
        "role": role,
        "iat": now,
        "exp": now + ttl_seconds,
        "jti": uuid.uuid4().hex,
        **extra,
    }
    return jwt.encode(claims, _secret(), algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(
        token,
        _secret(),
        algorithms=[ALGORITHM],
        issuer=ISSUER,
        options={"require": ["exp", "sub", "iss"]},
    )


def service_token(service: str) -> str:
    """Jeton court (60 s) qui identifie un service dans les appels internes (sub = nom du service)."""
    return create_token(service, "service", 60)


async def current_claims(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if creds is None:
        raise HTTPException(401, "Jeton manquant", headers={"WWW-Authenticate": "Bearer"})
    try:
        return decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(401, "Jeton invalide ou expiré", headers={"WWW-Authenticate": "Bearer"})


def require_roles(*roles: str):
    async def dependency(claims: dict = Depends(current_claims)) -> dict:
        if claims.get("role") not in roles:
            raise HTTPException(403, "Droits insuffisants")
        return claims

    return dependency


def require_service(*allowed: str):
    """Endpoint interne : réservé à une liste précise de services appelants (moindre privilège applicatif)."""

    async def dependency(claims: dict = Depends(require_roles("service"))) -> dict:
        if claims["sub"] not in allowed:
            raise HTTPException(403, "Service appelant non autorisé")
        return claims

    return dependency
