import asyncio
import logging

import asyncpg

from .logs import log_event

log = logging.getLogger("db")


async def create_pool(dsn: str, schema: str, *, attempts: int = 30, delay: float = 1.0) -> asyncpg.Pool:
    """Pool asyncpg restreint au schéma du service (search_path). Réessaie au démarrage : Postgres peut être en retard."""
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await asyncpg.create_pool(
                dsn,
                min_size=1,
                max_size=5,
                command_timeout=10,
                server_settings={"search_path": schema},
            )
        except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError) as exc:
            last = exc
            log_event(log, "db_connect_retry", logging.WARNING, attempt=attempt, error=type(exc).__name__)
            await asyncio.sleep(delay)
    raise RuntimeError("Base de données injoignable au démarrage") from last
