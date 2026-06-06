"""job_instructions テーブル追加 (出図のお知らせ × DOVE連携 / 工番別指示書 Job単位)

Revision ID: 0010_job_instructions
Revises: 0009_attachment_soft_delete
Create Date: 2026-06-06

既存の関連資料/部品リスト/差替は全て軸単位だが、工番別指示書は工番 (Job) 単位の
新概念のため独立テーブルとして新設する (DESIGN §1.1)。実ファイルは触らずパス参照のみ。

CLAUDE.md §2.1 整合: downgrade での DROP TABLE はサポートしない (no-op)。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010_job_instructions"
down_revision = "0009_attachment_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_instructions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "job_id",
            sa.String(32),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # fileserver 相対パス (posix, 先頭 `/` なし)。配信時に resolve_under で配下強制。
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("original_name", sa.String(256)),
        sa.Column("size", sa.BigInteger),
        sa.Column("note", sa.Text),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("created_by", sa.String(64)),
        # ソフトデリート用 (CLAUDE.md §2.1: ファイル実体は触らない)。
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_job_instructions_job_id", "job_instructions", ["job_id"])
    op.create_index("ix_job_instructions_deleted_at", "job_instructions", ["deleted_at"])


def downgrade() -> None:
    # CLAUDE.md §2.1: テーブル削除は本番ロールバック非対応。
    # DROP すると履歴データを失うため何もしない (idempotent な no-op)。
    pass
