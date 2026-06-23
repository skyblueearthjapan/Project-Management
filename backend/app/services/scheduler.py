from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.logging import get_logger
from app.services.importers.excel import sync_master_excel
from app.services.link_check import run_link_check

# Phase A 刈り込み: Meilisearch 同期ジョブ (`_meili_sync_job`) は削除 (Round 3 合意)。
# meili_sync.reindex_jobs は CLAUDE.md §2.1 のため module は残るが、ここからは呼ばない。

logger = get_logger(__name__)


async def _excel_sync_job() -> None:
    async with SessionLocal() as db:
        try:
            await sync_master_excel(db)
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("excel_sync_failed")


async def _link_check_job() -> None:
    async with SessionLocal() as db:
        try:
            await run_link_check(db)
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("link_check_failed")


def build_scheduler() -> AsyncIOScheduler:
    settings = get_settings()
    sch = AsyncIOScheduler(timezone="Asia/Tokyo")
    sch.add_job(
        _excel_sync_job,
        "interval",
        seconds=settings.master_sync_interval_sec,
        id="excel-sync",
        max_instances=1,
        coalesce=True,
    )
    sch.add_job(
        _link_check_job,
        "interval",
        seconds=settings.link_check_interval_sec,
        id="link-check",
        max_instances=1,
        coalesce=True,
    )
    return sch
