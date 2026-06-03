from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.axis import Axis
    from app.models.progress import ProgressStep
    from app.models.worker import Worker


class AxisPhaseStamp(Base):
    """軸 × 工程ごとの「電子データネーム印」レコード (Phase N-2)。

    Phase N の JobPhaseStamp は工番単位だったが、ユーザ要件で軸単位に拡張。
    job_phase_stamps とは別テーブル (CLAUDE.md §2.1 新規テーブル方式) として共存させ、
    UI は本テーブルだけを参照する。旧 job_phase_stamps はデータ保持のためそのまま残す。

    - 1 (axis, step) = 1 行 (UniqueConstraint で保証)
    - 期日のみ登録 / 押印のみ登録 / 両方 のいずれも許容するため worker_id / stamped_at は nullable
    - 「取消」は worker_id / stamped_at を NULL に戻すだけで、行自体は削除しない
      (CLAUDE.md §2.1 の削除関数禁止と整合)
    """

    __tablename__ = "axis_phase_stamps"
    __table_args__ = (
        UniqueConstraint(
            "axis_id", "step_id", name="uq_axis_phase_stamps_axis_step"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("axes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("progress_steps.id", ondelete="RESTRICT"), nullable=False
    )
    worker_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("workers.id", ondelete="RESTRICT")
    )
    stamped_at: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    axis: Mapped[Axis] = relationship(viewonly=True)
    step: Mapped[ProgressStep] = relationship(viewonly=True)
    worker: Mapped[Worker | None] = relationship(viewonly=True)
