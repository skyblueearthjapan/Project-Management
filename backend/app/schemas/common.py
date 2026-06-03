from __future__ import annotations

from datetime import date, datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)


class Health(BaseModel):
    # Phase A 刈り込み: meili フィールドは削除 (Meili サービス廃止)
    status: str = "ok"
    db: str
    timestamp: datetime


__all__ = ["ORMModel", "Page", "Health", "date", "datetime"]
