"""Fabrique d'application FastAPI : logs JSON, métriques Prometheus, /health, /ready, /metrics, pool Postgres."""

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from .config import env
from .db import create_pool
from .logs import log_event, request_id_var, setup_logging
from .metrics import HTTP_LATENCY, HTTP_REQUESTS, render

Hook = Callable[[FastAPI], Awaitable[None]]
QUIET_PATHS = {"/health", "/ready", "/metrics"}


def client_ip(request: Request) -> str:
    """Les services ne sont joignables que via la passerelle (réseau interne) : X-Real-IP est fiable ici."""
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def create_app(
    service: str,
    *,
    db_schema: str | None = None,
    startup: Hook | None = None,
    shutdown: Hook | None = None,
) -> FastAPI:
    setup_logging(service, env("LOG_LEVEL", "INFO") or "INFO")
    log = logging.getLogger(service)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.pool = None
        if db_schema:
            app.state.pool = await create_pool(env("DATABASE_URL", required=True), db_schema)  # type: ignore[arg-type]
        if startup:
            await startup(app)
        log_event(log, "service_started", db_schema=db_schema)
        try:
            yield
        finally:
            if shutdown:
                await shutdown(app)
            if app.state.pool:
                await app.state.pool.close()
            log_event(log, "service_stopped")

    app = FastAPI(title=f"RESILIENCE-ALPHA · {service}", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def observability(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id_var.set(rid)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["x-request-id"] = rid
            return response
        finally:
            elapsed = time.perf_counter() - started
            route = request.scope.get("route")
            path_label = route.path if route else "unmatched"  # gabarit de route : pas d'explosion de cardinalité
            HTTP_REQUESTS.labels(service, request.method, path_label, str(status)).inc()
            HTTP_LATENCY.labels(service, request.method, path_label).observe(elapsed)
            if request.url.path not in QUIET_PATHS:
                level = logging.WARNING if status >= 400 else logging.INFO
                log_event(
                    log,
                    "http_request",
                    level,
                    method=request.method,
                    path=request.url.path,
                    status=status,
                    duration_ms=round(elapsed * 1000, 1),
                    client_ip=client_ip(request),
                    user_agent=request.headers.get("user-agent", "-")[:120],
                )
            request_id_var.reset(token)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.error(
            "unhandled_exception",
            exc_info=exc,
            extra={"fields": {"event": "unhandled_exception", "path": request.url.path}},
        )
        return JSONResponse({"detail": "Erreur interne"}, status_code=500)

    @app.get("/health", include_in_schema=False)
    async def health():
        """Liveness : le processus répond."""
        return {"status": "ok", "service": service}

    @app.get("/ready", include_in_schema=False)
    async def ready():
        """Readiness : le service peut réellement servir (base de données joignable)."""
        try:
            pool = getattr(app.state, "pool", None)
            if pool is not None:
                await asyncio.wait_for(pool.fetchval("SELECT 1"), timeout=2)
        except Exception as exc:  # noqa: BLE001
            log_event(log, "not_ready", logging.WARNING, error=type(exc).__name__)
            return JSONResponse({"status": "unready", "service": service}, status_code=503)
        return {"status": "ready", "service": service}

    @app.get("/metrics", include_in_schema=False)
    async def metrics():
        body, content_type = render()
        return Response(body, media_type=content_type)

    return app
