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


class RelatedDoc(Base):
    """関連資料 (バージョン管理なし)。"""

    __tablename__ = "related_docs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(
        ForeignKey("axes.id", ondelete="CASCADE"), nullable=False
    )
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    title: Mapped[str | None] = mapped_column(String(256))
    size: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # ソフトデリート用 (CLAUDE.md §2.1 厳守: ファイル実体は触らない)。
    # NULL = 表示、NOT NULL = 一覧から非表示
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    axis: Mapped[Axis] = relationship(back_populates="related_docs")


class PartsList(Base):
    """部品リスト本体 (current_version_id は循環FKを避けるため運用上はマテリアライズ参照のみ)。"""

    __tablename__ = "parts_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(
        ForeignKey("axes.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    note: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    axis: Mapped[Axis] = relationship(back_populates="parts_lists")
    versions: Mapped[list[PartsListVersion]] = relationship(
        back_populates="parts_list",
        cascade="save-update, merge",
        order_by="PartsListVersion.version_no.desc()",
    )


class PartsListVersion(Base):
    """部品リストのバージョン履歴。"""

    __tablename__ = "parts_list_versions"
    __table_args__ = (
        UniqueConstraint(
            "parts_list_id", "version_no", name="uq_parts_list_versions_pl_versionno"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parts_list_id: Mapped[int] = mapped_column(
        ForeignKey("parts_lists.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    label: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(64))
    # ソフトデリート用 (CLAUDE.md §2.1 厳守: ファイル実体は触らない)。
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    parts_list: Mapped[PartsList] = relationship(back_populates="versions")


class PdfReplacement(Base):
    """PDF差し替え履歴 (Marin-PDF 形式の追記レイヤー)。"""

    __tablename__ = "pdf_replacements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(
        ForeignKey("axes.id", ondelete="CASCADE"), nullable=False
    )
    version_id: Mapped[int] = mapped_column(
        ForeignKey("versions.id", ondelete="CASCADE"), nullable=False
    )
    replaced_pdf_path: Mapped[str] = mapped_column(String(512), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(64))
    # ソフトデリート用 (CLAUDE.md §2.1 厳守: ファイル実体は触らない)。
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    axis: Mapped[Axis] = relationship(back_populates="pdf_replacements")


class InventoryAttachment(Base):
    """工程ボタン「在庫」起動時の添付ファイル / メモ (v1.0.4 phase split で v2 拡張用に予約)。"""

    __tablename__ = "inventory_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(
        ForeignKey("axes.id", ondelete="CASCADE"), nullable=False
    )
    file_path: Mapped[str | None] = mapped_column(String(512))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ChecklistAttachment(Base):
    """工程ボタン「中間検査/水す/ボルト締結」起動時の添付 (v2 拡張用に予約)。"""

    __tablename__ = "checklist_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    axis_id: Mapped[int] = mapped_column(
        ForeignKey("axes.id", ondelete="CASCADE"), nullable=False
    )
    step_code: Mapped[str] = mapped_column(String(32), nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(512))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


Index("ix_related_docs_axis_id", RelatedDoc.axis_id)
Index("ix_parts_list_versions_pl", PartsListVersion.parts_list_id)
Index("ix_pdf_replacements_axis_id", PdfReplacement.axis_id)
Index("ix_inventory_attachments_axis_id", InventoryAttachment.axis_id)
Index("ix_checklist_attachments_axis_step", ChecklistAttachment.axis_id, ChecklistAttachment.step_code)
# ソフトデリート用インデックス (一覧クエリで `deleted_at IS NULL` の絞り込みに使う)
Index("ix_related_docs_deleted_at", RelatedDoc.deleted_at)
Index("ix_parts_list_versions_deleted_at", PartsListVersion.deleted_at)
Index("ix_pdf_replacements_deleted_at", PdfReplacement.deleted_at)
