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


class JobInstruction(Base):
    """工番別指示書 (Job単位)。

    既存の関連資料/部品リスト/差替は全て軸単位だが、工番別指示書は工番 (Job) 単位の
    新概念のため独立テーブルとして持つ (DESIGN §1.1)。`RelatedDoc` を雛形にしつつ
    `job_id` 直結。実ファイルは触らずパス参照のみ (CLAUDE.md §2.1 / §2.2)。

    「1件」は DB ユニーク制約で縛らず、複数行許容 + `deleted_at IS NULL` の
    最新1件をビューで採用する (差し替え運用 + ソフトデリート整合)。
    """

    __tablename__ = "job_instructions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    # fileserver 相対パス (posix, 先頭 `/` なし)。serve 時に resolve_under で配下強制。
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    original_name: Mapped[str | None] = mapped_column(String(256))
    size: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(64))
    # ソフトデリート用 (CLAUDE.md §2.1 厳守: ファイル実体は触らない)。
    # NULL = 表示、NOT NULL = 一覧から非表示 + 配信時 404。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


Index("ix_job_instructions_job_id", JobInstruction.job_id)
Index("ix_job_instructions_deleted_at", JobInstruction.deleted_at)
