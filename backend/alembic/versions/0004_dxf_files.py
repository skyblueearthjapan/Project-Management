"""dxf_files テーブル追加 (V2 製造現場 DX)

Revision ID: 0004_dxf_files
Revises: 0003_link_check_indexes
Create Date: 2026-05-24

DXF を PDF (versions) と同格に扱うための新規テーブル。
バージョン履歴は持たず、軸ごとに登録されたファイルを「平置き」で並べる。

CLAUDE.md §2.1 整合: downgrade での DROP TABLE はサポートしない。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004_dxf_files"
down_revision = "0003_link_check_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dxf_files",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "axis_id",
            sa.Integer,
            sa.ForeignKey("axes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # file_path:
        #   - パス参照: 設計/{job}/{axis}/... (= /mnt/fileserver 配下)
        #   - アップロード: dxf/{job}/{axis}/... (= /mnt/uploads 配下)
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("label", sa.String(64)),
        sa.Column("note", sa.Text),
        sa.Column("size", sa.BigInteger),
        sa.Column("sha256", sa.String(64)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("created_by", sa.String(64)),
    )
    op.create_index("ix_dxf_files_axis_id", "dxf_files", ["axis_id"])


def downgrade() -> None:
    raise NotImplementedError("テーブル削除はサポートしない (CLAUDE.md §2.1 整合)")
