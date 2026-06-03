from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.axis_phase_stamp import AxisPhaseStampRead
from app.schemas.common import ORMModel
from app.schemas.job_phase_stamp import PhaseStampRead


class AxisProgressRead(ORMModel):
    step_id: int
    code: str | None = None
    short_label: str | None = None
    state: str
    sort_order: int | None = None


class AxisRead(ORMModel):
    id: int
    name: str
    sort_order: int
    third_party_required: bool
    progress: list[AxisProgressRead] = []
    current_version_id: int | None = None
    current_version_no: int | None = None
    latest_release_at: datetime | None = None
    # Phase D: 最新バージョン PDF のリンク切れ判定 (link_check_results 最新行 == "missing")
    current_version_link_broken: bool = False
    # Phase N-2: 軸ごとの電子データネーム印
    phase_stamps: list[AxisPhaseStampRead] = []


class JobBase(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    customer: str | None = None
    delivery_date: date | None = None
    delivery_date_internal: date | None = None
    note: str | None = None
    starred: bool = False
    status: str = Field(default="open", pattern="^(open|closed)$")


class JobCreate(JobBase):
    id: str = Field(min_length=1, max_length=32, description="工番文字列 (例: NK24-051)")


class JobUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    customer: str | None = None
    delivery_date: date | None = None
    delivery_date_internal: date | None = None
    note: str | None = None
    # Phase A で UI 側 ★ ボタンを削除済。Phase C で本フィールドおよび
    # jobs.starred カラムも完全削除予定。現状は後方互換のため受付のみ残す
    # (DB カラムが残るうちは値を更新できる)。
    starred: bool | None = None
    status: str | None = Field(default=None, pattern="^(open|closed)$")


class JobRead(ORMModel):
    id: str
    title: str
    customer: str | None
    delivery_date: date | None
    delivery_date_internal: date | None
    note: str | None
    starred: bool
    status: str
    created_at: datetime
    updated_at: datetime
    axes: list[AxisRead] = []
    # Phase N: 工程ごとの電子データネーム印 (期日 / 押印情報)
    phase_stamps: list[PhaseStampRead] = []
