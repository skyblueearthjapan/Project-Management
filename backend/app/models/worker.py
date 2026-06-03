from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.job_phase_stamp import JobPhaseStamp


class Worker(Base):
    """電子データネーム印に表示する作業者マスタ。

    認証なし環境のため User とは別管理 (User は社員名簿、Worker は印影表示用)。
    DELETE は CLAUDE.md §2.1 で禁止のため active=false で soft delete する。
    """

    __tablename__ = "workers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(32), nullable=False)  # 印面表示名 (姓のみ等)
    department: Mapped[str | None] = mapped_column(String(32))  # 下アーク (省略可)
    stamp_color: Mapped[str] = mapped_column(
        String(7), nullable=False, server_default="#c0392b"
    )  # 朱色既定
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    stamps: Mapped[list[JobPhaseStamp]] = relationship(
        back_populates="worker", viewonly=True
    )
