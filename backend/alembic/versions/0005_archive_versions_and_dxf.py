"""versions / dxf_files に archived_at を追加 (Phase I: UI からの取消対応)

Revision ID: 0005_archive_versions_and_dxf
Revises: 0004_dxf_files
Create Date: 2026-05-24

ユーザーがアプリ上から PDF / DXF を「取消」「過去版に戻す」「新版に入れ替える」を
直感的に行えるようにするため、論理アーカイブ列 `archived_at` を導入する。

CLAUDE.md §2.1 整合:
  - 実ファイルは削除しない。`archived_at = now()` を立てるだけ。
  - downgrade での DROP COLUMN は実装しない (履歴情報の損失を防ぐ)。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0005_archive_versions_and_dxf"
down_revision = "0004_dxf_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "versions",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "dxf_files",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_versions_archived_at", "versions", ["archived_at"])
    op.create_index("ix_dxf_files_archived_at", "dxf_files", ["archived_at"])


def downgrade() -> None:
    raise NotImplementedError(
        "archived_at カラムの DROP はサポートしない (CLAUDE.md §2.1 整合)"
    )
