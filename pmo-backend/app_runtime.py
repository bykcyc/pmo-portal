"""Application startup/shutdown orchestration without import-time I/O."""

import logging
from collections.abc import Callable, Mapping
from contextlib import asynccontextmanager
from typing import Any


def seed_users() -> dict[str, dict[str, Any]]:
    """Return the legacy development users required by offline unit tests."""
    return {
        "owner@company.com": {
            "id": "eccb57bc-e135-481f-8d6c-90f5ab946596",
            "password": "admin123",
            "full_name": "Portfolio Owner",
            "role": "owner",
            "bitrix24_user_id": None,
            "is_active": True,
        },
        "pm1@company.com": {
            "id": "8ab473a0-285c-448f-9349-6a9373cee14e",
            "password": "pm123",
            "full_name": "Project Manager 1",
            "role": "pm",
            "bitrix24_user_id": None,
            "is_active": True,
        },
    }


@asynccontextmanager
async def lifespan(
    *,
    db_module: Any,
    environment: Mapping[str, str],
    logger: logging.Logger,
    apply_loaded_state: Callable[[dict, dict], None],
    apply_smtp: Callable[[], None],
    enforce_prod_secrets: Callable[[], None],
    take_portfolio_snapshot: Callable[..., Any],
    run_digests: Callable[..., Any],
    run_leadership_digest: Callable[..., Any],
    apply_revoked: Callable[[dict], None] | None = None,
    sync_bitrix_people: Callable[..., Any] | None = None,
    fireflies_sync: Callable[..., Any] | None = None,
):
    """Run the existing PMO lifespan while keeping all dependencies explicit."""
    await db_module.init_pool()
    await db_module.apply_schema()

    loaded_users = await db_module.load_users()
    settings = await db_module.load_settings()
    apply_loaded_state(loaded_users, settings)
    if apply_revoked is not None:
        # Прогрев отозванных токенов из Postgres — logout переживает рестарт сервера.
        try:
            await db_module.prune_revoked_tokens()  # выкинуть истёкшие (иначе таблица растёт)
            apply_revoked(await db_module.load_revoked_tokens())
        except Exception as exc:  # noqa: BLE001 - warm-load is best-effort
            logger.warning("Не удалось прогреть revoked_tokens: %s", exc)
    apply_smtp()
    enforce_prod_secrets()

    scheduler = None
    if environment.get("SCHEDULER_DISABLED") == "1":
        logger.info("Планировщик отключён (SCHEDULER_DISABLED=1)")
    else:
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler

            scheduler = AsyncIOScheduler(timezone="UTC")
            scheduler.add_job(
                take_portfolio_snapshot,
                "cron",
                hour=23,
                minute=0,
                id="daily_portfolio_snapshot",
                replace_existing=True,
            )
            scheduler.add_job(
                run_digests,
                "cron",
                day_of_week="mon",
                hour=8,
                minute=0,
                id="weekly_digest",
                replace_existing=True,
            )
            scheduler.add_job(
                run_leadership_digest,
                "cron",
                day_of_week="mon",
                hour=8,
                minute=30,
                id="weekly_leadership_digest",
                replace_existing=True,
            )
            if sync_bitrix_people is not None:
                # Ночной синк людей из Bitrix. НЕ дёргаем его на старте (в отличие от снимка
                # портфеля): джоба умеет деактивировать людей, и делать это на каждом
                # рестарте контейнера незачем.
                scheduler.add_job(
                    sync_bitrix_people,
                    "cron",
                    hour=4,
                    minute=0,
                    id="daily_bitrix_people_sync",
                    replace_existing=True,
                )
            if fireflies_sync is not None:
                # Очередь связки Fireflies: раз в минуту, без наложения прогонов (одна встреча —
                # одна запись в PMO и один комментарий в Битриксе). Передаётся только при
                # FIREFLIES_ENABLED — выключенная связка не держит даже джобу.
                scheduler.add_job(
                    fireflies_sync,
                    "interval",
                    minutes=1,
                    id="fireflies_sync",
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                )
            scheduler.start()
            logger.info(
                "Планировщик запущен (snapshot 23:00, дайджесты пн 08:00/08:30, "
                "синк людей Bitrix 04:00 UTC%s)",
                ", очередь Fireflies раз в минуту" if fireflies_sync is not None else "",
            )
            await take_portfolio_snapshot()
        except Exception as exc:  # noqa: BLE001 - scheduler is optional
            logger.warning("Планировщик не запущен: %s", exc)

    yield

    try:
        if scheduler:
            scheduler.shutdown(wait=False)
    except Exception:  # noqa: BLE001 - shutdown must not block DB cleanup
        pass
    await db_module.close_pool()
