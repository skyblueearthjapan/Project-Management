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
engine = create_async_engine(
    _settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    echo=False,
)
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
