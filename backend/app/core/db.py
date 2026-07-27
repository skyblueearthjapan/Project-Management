from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings


class Base(DeclarativeBase):
    """全 ORM モデルの基底クラス。"""


_settings = get_settings()

# SQLite (テストの in-memory DB) は StaticPool を使うため `pool_size` /
# `max_overflow` を受け付けず、渡すと import 時点で TypeError になる。
# これによりテストが 1 件も収集できない状態だったため、方言で出し分ける。
# 本番 (PostgreSQL) のプール設定は従来どおり。
_engine_kwargs: dict[str, object] = {"pool_pre_ping": True, "echo": False}
if not _settings.database_url.startswith("sqlite"):
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

engine = create_async_engine(_settings.database_url, **_engine_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI 依存性: 1リクエスト1セッション。例外時はロールバック。"""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()
