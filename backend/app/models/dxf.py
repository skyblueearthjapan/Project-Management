from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DxfFile(Base):
    """軸に紐づく DXF ファイル参照 (V2 拡張: 製造現場 DX)。

    PDF (versions) と異なりバージョン履歴は持たず、登録されたファイルを「平置き」で
    一覧する。`file_path` は以下のいずれか:
      - パス参照: `設計/{job}/{axis}/...` (= /mnt/fileserver 配下)
      - アップロード: `dxf/{job}/{axis}/...` (= /mnt/uploads 配下)
    `is_link_broken` カラムは持たない (Phase D と同じく link_check_results JOIN で動的判定)。
    """

    __tablename__ = "dxf_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(ForeignKey("axes.id", ondelete="CASCADE"), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    label: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)
    size: Mapped[int | None] = mapped_column(BigInteger)
    sha256: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(64))
    # Phase I: UI からの論理アーカイブ。実ファイルは削除しない (CLAUDE.md §2.1)。
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


Index("ix_dxf_files_axis_id", DxfFile.axis_id)
Index("ix_dxf_files_archived_at", DxfFile.archived_at)
