from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _validate_hex_color(v: str) -> str:
    if not _HEX_COLOR_RE.match(v):
        raise ValueError("印影色は #RRGGBB 形式で指定してください")
    return v.lower()


class WorkerRead(ORMModel):
    id: int
    name: str
    department: str | None
    stamp_color: str
    active: bool
    created_at: datetime
    updated_at: datetime


class WorkerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    department: str | None = Field(default=None, max_length=32)
    stamp_color: str = Field(default="#c0392b", max_length=7)
    active: bool = True

    @field_validator("stamp_color")
    @classmethod
    def _color(cls, v: str) -> str:
        return _validate_hex_color(v)


class WorkerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=32)
    department: str | None = Field(default=None, max_length=32)
    stamp_color: str | None = Field(default=None, max_length=7)
    active: bool | None = None

    @field_validator("stamp_color")
    @classmethod
    def _color(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _validate_hex_color(v)
