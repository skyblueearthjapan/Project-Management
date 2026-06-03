from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.axis import Axis


class ProgressStep(Base):
    """進捗工程マスタ。固定 10 工程 (v1.0.4)。"""

    __tablename__ = "progress_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    short_label: Mapped[str] = mapped_column(String(8), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")


class AxisProgress(Base):
    """軸ごとの工程進捗状態 (3-state: notstarted / inprogress / done)。"""

    __tablename__ = "axis_progress"
    __table_args__ = (
        UniqueConstraint("axis_id", "step_id", name="uq_axis_progress_axis_step"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(
        ForeignKey("axes.id", ondelete="CASCADE"), nullable=False
    )
    step_id: Mapped[int] = mapped_column(
        ForeignKey("progress_steps.id", ondelete="RESTRICT"), nullable=False
    )
    state: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="notstarted"
    )  # notstarted | inprogress | done
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    updated_by: Mapped[str | None] = mapped_column(String(64))

    axis: Mapped[Axis] = relationship(back_populates="progress")


Index("ix_axis_progress_axis_id", AxisProgress.axis_id)
