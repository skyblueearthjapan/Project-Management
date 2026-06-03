from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.axis import Axis


class Version(Base):
    """軸の出図 (PDF) バージョン履歴。"""

    __tablename__ = "versions"
    __table_args__ = (
        UniqueConstraint("axis_id", "version_no", name="uq_versions_axis_versionno"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(
        ForeignKey("axes.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)  # 1,2,3,...
    label: Mapped[str | None] = mapped_column(String(64))  # 例: 初版, 再出図 1
    pdf_path: Mapped[str] = mapped_column(String(512), nullable=False)  # /mnt/fileserver 配下
    pdf_size: Mapped[int | None] = mapped_column(BigInteger)
    pdf_sha256: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    released_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Phase I: アプリ UI からの「アーカイブ」操作で立てる論理削除フラグ。
    # 実 PDF ファイルは削除しない (CLAUDE.md §2.1) ため、表示一覧と
    # current_version_id 計算からこの列が NULL でない行を除外することで実現する。
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    axis: Mapped[Axis] = relationship(back_populates="versions")


Index("ix_versions_axis_id", Version.axis_id)
Index("ix_versions_archived_at", Version.archived_at)
