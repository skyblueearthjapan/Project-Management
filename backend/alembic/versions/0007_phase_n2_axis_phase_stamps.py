"""Phase N-2: axis_phase_stamps テーブルを新規作成 (軸単位の電子データネーム印)

Revision ID: 0007_phase_n2_axis_phase_stamps
Revises: 0006_phase_n_workers_and_stamps
Create Date: 2026-05-26

Phase N の job_phase_stamps (工番単位) はユーザ要件で軸単位に拡張する必要が出たため、
CLAUDE.md §2.1 の「DROP / 削除禁止」を守って **新規テーブル方式** で並存させる。
- 旧 job_phase_stamps はデータ保持のため残置 (UI からは参照しなくなる)
- 新 axis_phase_stamps は (axis_id, step_id) ユニークで 1 軸 × 1 工程 = 1 行

CLAUDE.md §2.1 整合:
  - 行の物理削除は API 層でも行わない (取消は worker_id / stamped_at を NULL に戻すのみ)
  - downgrade での DROP TABLE は実装しない (本番ロールバック非対応方針)
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0007_phase_n2_axis_phase_stamps"
down_revision = "0006_phase_n_workers_and_stamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "axis_phase_stamps",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "axis_id",
            sa.Integer,
            sa.ForeignKey("axes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "step_id",
            sa.Integer,
            sa.ForeignKey("progress_steps.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "worker_id",
            sa.Integer,
            sa.ForeignKey("workers.id", ondelete="RESTRICT"),
        ),
        sa.Column("stamped_at", sa.Date),
        sa.Column("due_date", sa.Date),
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
            "axis_id", "step_id", name="uq_axis_phase_stamps_axis_step"
        ),
    )
    op.create_index(
        "ix_axis_phase_stamps_axis_id", "axis_phase_stamps", ["axis_id"]
    )
    op.create_index(
        "ix_axis_phase_stamps_step_id", "axis_phase_stamps", ["step_id"]
    )


def downgrade() -> None:
    raise NotImplementedError(
        "axis_phase_stamps は CLAUDE.md §2.1 によりロールバック不可"
    )
