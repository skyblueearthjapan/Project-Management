from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class AxisCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    sort_order: int = 0
    third_party_required: bool = False


class AxisUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    sort_order: int | None = None
    third_party_required: bool | None = None


class VersionRead(ORMModel):
    id: int
    version_no: int
    label: str | None
    pdf_path: str
    pdf_size: int | None
    note: str | None
    released_at: datetime | None
    released_by: str | None
    created_at: datetime
    # Phase D: 直近の link_check_results.status が "missing" の場合 True
    is_link_broken: bool = False
    # Phase I: UI からアーカイブされた日時 (NULL = アクティブ)
    archived_at: datetime | None = None


class VersionCreate(BaseModel):
    pdf_path: str = Field(min_length=1, max_length=512)
    label: str | None = Field(default=None, max_length=64)
    note: str | None = None
    released_at: datetime | None = None
    released_by: str | None = None


class ProgressUpdate(BaseModel):
    state: str = Field(pattern="^(notstarted|inprogress|done)$")
    updated_by: str | None = None


class ProgressStepRead(ORMModel):
    id: int
    code: str
    name: str
    short_label: str
    sort_order: int
    is_active: bool
