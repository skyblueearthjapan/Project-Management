from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.schemas.common import ORMModel


class PhaseStampRead(ORMModel):
    """工番一覧 / 詳細に埋め込む、工程ごとの押印状態スナップショット。"""

    step_id: int
    worker_id: int | None = None
    worker_name: str | None = None
    worker_department: str | None = None
    stamp_color: str | None = None
    stamped_at: date | None = None
    due_date: date | None = None


class StampApply(BaseModel):
    """押印リクエスト body。"""

    step_id: int
    worker_id: int


class StampDueDateUpdate(BaseModel):
    """期日のみ更新する body。null で期日クリア。"""

    due_date: date | None = None
