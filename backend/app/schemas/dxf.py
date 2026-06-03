from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class DxfFileRead(ORMModel):
    id: int
    axis_id: int
    file_path: str
    label: str | None
    note: str | None
    size: int | None
    sha256: str | None
    created_at: datetime
    created_by: str | None
    # Phase D 同様: 直近の link_check_results.status が "missing" の場合 True
    is_link_broken: bool = False
    # Phase I: UI からアーカイブされた日時 (NULL = アクティブ)
    archived_at: datetime | None = None


class DxfFileCreate(BaseModel):
    file_path: str = Field(min_length=1, max_length=512)
    label: str | None = Field(default=None, max_length=64)
    note: str | None = None
    created_by: str | None = Field(default=None, max_length=64)
