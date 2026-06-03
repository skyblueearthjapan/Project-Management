"""関連資料/部品リスト/差替の soft-delete 用 deleted_at カラム追加

Revision ID: 0009_attachment_soft_delete
Revises: 0008_pdf_rotations
Create Date: 2026-05-27

related_docs / parts_list_versions / pdf_replacements の 3 テーブルに
ソフトデリート用の `deleted_at TIMESTAMPTZ NULL` を追加する。

CLAUDE.md §2.1 整合のため downgrade では DROP しない (本番ロールバック非対応方針)。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0009_attachment_soft_delete"
down_revision = "0008_pdf_rotations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # related_docs
    op.add_column(
        "related_docs",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_related_docs_deleted_at", "related_docs", ["deleted_at"]
    )

    # parts_list_versions
    op.add_column(
        "parts_list_versions",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_parts_list_versions_deleted_at",
        "parts_list_versions",
        ["deleted_at"],
    )

    # pdf_replacements
    op.add_column(
        "pdf_replacements",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_pdf_replacements_deleted_at",
        "pdf_replacements",
        ["deleted_at"],
    )


def downgrade() -> None:
    # CLAUDE.md §2.1: 列削除/テーブル削除は本番ロールバック非対応。
    # ここで DROP すると履歴データを失うため、何もしない (idempotent な no-op)。
    pass
