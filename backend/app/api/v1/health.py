from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.schemas.common import Health

router = APIRouter()


# Phase A 刈り込み: Meili チェックは削除 (Meili サービス自体を廃止したため)
@router.get("/health", response_model=Health)
async def health(db: AsyncSession = Depends(get_db)) -> Health:
    db_status = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - 接続不能時の動作確認用
        db_status = f"error: {type(exc).__name__}"

    return Health(status="ok", db=db_status, timestamp=datetime.now())
