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
    from app.models.attachment import PartsList, PdfReplacement, RelatedDoc
    from app.models.axis_phase_stamp import AxisPhaseStamp
    from app.models.job import Job
    from app.models.progress import AxisProgress
    from app.models.version import Version


class Axis(Base):
    """軸 (Axis): 工番に紐づく機械の軸/ユニット。"""

    __tablename__ = "axes"
    __table_args__ = (
        UniqueConstraint("job_id", "name", name="uq_axes_job_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)  # 例: 昇降軸, 旋回軸
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    third_party_required: Mapped[bool] = mapped_column(
        # 第三者チェック要否
        nullable=False,
        server_default="false",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    job: Mapped[Job] = relationship(back_populates="axes")
    versions: Mapped[list[Version]] = relationship(
        back_populates="axis", cascade="save-update, merge", order_by="Version.created_at.desc()"
    )
    progress: Mapped[list[AxisProgress]] = relationship(
        back_populates="axis", cascade="save-update, merge"
    )
    related_docs: Mapped[list[RelatedDoc]] = relationship(
        back_populates="axis", cascade="save-update, merge"
    )
    parts_lists: Mapped[list[PartsList]] = relationship(
        back_populates="axis", cascade="save-update, merge"
    )
    pdf_replacements: Mapped[list[PdfReplacement]] = relationship(
        back_populates="axis", cascade="save-update, merge"
    )
    # Phase N-2: 軸 × 工程ごとの電子データネーム印
    phase_stamps: Mapped[list[AxisPhaseStamp]] = relationship(
        cascade="save-update, merge", viewonly=False
    )


Index("ix_axes_job_id", Axis.job_id)
