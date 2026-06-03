"""Phase O: pdf_rotations テーブル新規作成 (PDF ページ表示回転メタ)

Revision ID: 0008_pdf_rotations
Revises: 0007_phase_n2_axis_phase_stamps
Create Date: 2026-05-26

PDF の物理ファイルを書き換えずに「ページ毎の表示回転」だけを保持するための
新規テーブル。CLAUDE.md §2.1 整合のため downgrade では DROP しない (本番
ロールバック非対応方針)。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008_pdf_rotations"
down_revision = "0007_phase_n2_axis_phase_stamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pdf_rotations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "version_id",
            sa.Integer,
            sa.ForeignKey("versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("page_index", sa.Integer, nullable=False),
        sa.Column(
            "rotation",
            sa.Integer,
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "version_id", "page_index", name="uq_pdf_rotations_version_page"
        ),
    )
    op.create_index(
        "ix_pdf_rotations_version_id", "pdf_rotations", ["version_id"]
    )


def downgrade() -> None:
    raise NotImplementedError(
        "pdf_rotations は CLAUDE.md §2.1 によりロールバック不可"
    )
