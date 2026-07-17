from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.action import ActionLog
    from app.models.axis import Axis
    from app.models.job_phase_stamp import JobPhaseStamp
    from app.models.mail import MailLog


class Job(Base):
    """工番 (Project)。"""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # 工番文字列
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    customer: Mapped[str | None] = mapped_column(String(256))
    delivery_date: Mapped[date | None] = mapped_column(Date)
    delivery_date_internal: Mapped[date | None] = mapped_column(Date)  # 社内納期
    note: Mapped[str | None] = mapped_column(Text)
    starred: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="open"
    )  # open / closed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    # 論理アーカイブ (削除ボタン)。実ファイル・DB 行は消さない (CLAUDE.md §2.1)。
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    axes: Mapped[list[Axis]] = relationship(
        back_populates="job", cascade="save-update, merge", order_by="Axis.sort_order"
    )
    mail_logs: Mapped[list[MailLog]] = relationship(back_populates="job", viewonly=True)
    action_logs: Mapped[list[ActionLog]] = relationship(back_populates="job", viewonly=True)
    phase_stamps: Mapped[list[JobPhaseStamp]] = relationship(
        cascade="save-update, merge", viewonly=False
    )


Index("ix_jobs_delivery_date", Job.delivery_date)
Index("ix_jobs_starred_status", Job.starred, Job.status)
Index("ix_jobs_archived_at", Job.archived_at)
