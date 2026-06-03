from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.logging import get_logger, setup_logging
from app.services.scheduler import build_scheduler

setup_logging(get_settings().log_level)
logger = get_logger("app")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    logger.info(
        "app_starting",
        dev_mode=settings.dev_mode,
        cors=settings.cors_origin_list,
    )
    scheduler = None
    if settings.enable_scheduler:
        scheduler = build_scheduler()
        scheduler.start()
        logger.info("scheduler_started", jobs=[j.id for j in scheduler.get_jobs()])
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)
        logger.info("app_stopping")


app = FastAPI(
    title="DOVE 出図管理 API",
    version="0.1.0",
    description="DOVE 出図管理 - 軸別進捗管理 + メール送信ハブ",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=False,  # 認証なしのため Cookie 不要
    allow_methods=["GET", "POST", "PATCH", "PUT", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def root_health() -> dict[str, str]:
    """軽量ヘルスチェック (Docker healthcheck から呼び出す)。"""
    return {"status": "ok"}
