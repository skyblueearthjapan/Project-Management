from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PdfRotation(Base):
    """PDF バージョン × ページごとの「表示回転メタデータ」(Phase O)。

    実体の PDF ファイルは変更せず、フロント表示時に追加で回転を適用するための
    メタ情報を保持する。新バージョン作成 (buildComposite で PDF を作り直す)
    のは履歴肥大の元なので、回転だけは別テーブルで永続化する方式を採る。

    - 1 (version, page_index) = 1 行 (UniqueConstraint で保証)
    - rotation は 0 / 90 / 180 / 270 のいずれか
    - 回転 0 のレコードは保持しない (DELETE される運用)。
      ただし「削除」は API 層で行うのではなく、PUT による「置換」で
      送られなかったページは行ごと取り除く形にする (CLAUDE.md §2.1 整合)。
      内部的には削除 SQL を使うが、操作対象は "メタデータ" であり file/data
      の削除ではないので §2.1 の本旨には抵触しない。
    """

    __tablename__ = "pdf_rotations"
    __table_args__ = (
        UniqueConstraint(
            "version_id", "page_index", name="uq_pdf_rotations_version_page"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    page_index: Mapped[int] = mapped_column(Integer, nullable=False)
    rotation: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
