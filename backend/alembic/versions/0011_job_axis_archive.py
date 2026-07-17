"""jobs / axes に archived_at を追加 (工番・軸の削除ボタン = 論理アーカイブ)

Revision ID: 0011_job_axis_archive
Revises: 0010_job_instructions
Create Date: 2026-07-17

一度登録した工番・軸を一覧/詳細から取り除く手段が無かったため、
versions / dxf_files (0005) と同じ論理アーカイブ方式を工番・軸に拡張する。

CLAUDE.md §2.1 整合:
  - 実ファイル・DB 行は削除しない。`archived_at = now()` を立てるだけ。
  - 再登録 (手動 / 出図エージェント) 時は archived_at = NULL に戻して自動復活。
  - downgrade での DROP COLUMN は実装しない (履歴情報の損失を防ぐ)。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011_job_axis_archive"
down_revision = "0010_job_instructions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "axes",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_jobs_archived_at", "jobs", ["archived_at"])
    op.create_index("ix_axes_archived_at", "axes", ["archived_at"])


def downgrade() -> None:
    raise NotImplementedError(
        "archived_at カラムの DROP はサポートしない (CLAUDE.md §2.1 整合)"
    )
