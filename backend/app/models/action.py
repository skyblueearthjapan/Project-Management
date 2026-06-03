from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.job import Job


class ActionLog(Base):
    """全アクション履歴 (作成/更新/削除はせず追記のみ)。

    どこから何が行われたかの監査・通知に使う。
    """

    __tablename__ = "action_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL")
    )
    axis_id: Mapped[int | None] = mapped_column(ForeignKey("axes.id", ondelete="SET NULL"))
    actor: Mapped[str | None] = mapped_column(String(64))
    action_type: Mapped[str] = mapped_column(String(64), nullable=False)  # release / mail / ...
    payload: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    job: Mapped[Job | None] = relationship(back_populates="action_logs")


Index("ix_action_logs_job_id", ActionLog.job_id)
Index("ix_action_logs_created_at", ActionLog.created_at)
