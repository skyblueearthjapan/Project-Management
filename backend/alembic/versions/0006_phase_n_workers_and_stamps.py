"""Phase N: workers / job_phase_stamps テーブルを新規作成

Revision ID: 0006_phase_n_workers_and_stamps
Revises: 0005_archive_versions_and_dxf
Create Date: 2026-05-26

工程ごとの電子データネーム印 (期日 + 押印) を保存するテーブル群。

CLAUDE.md §2.1 整合:
  - 行の物理削除は API 層でも行わない (workers は active=false で soft delete)
  - downgrade での DROP TABLE は実装しない (本番ロールバック非対応方針)
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0006_phase_n_workers_and_stamps"
down_revision = "0005_archive_versions_and_dxf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workers",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(32), nullable=False),
        sa.Column("department", sa.String(32)),
        sa.Column(
            "stamp_color", sa.String(7), nullable=False, server_default="#c0392b"
        ),
        sa.Column(
            "active", sa.Boolean, nullable=False, server_default=sa.text("true")
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
    )
    op.create_index("ix_workers_active", "workers", ["active"])

    op.create_table(
        "job_phase_stamps",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "job_id",
            sa.String(32),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
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
            "job_id", "step_id", name="uq_job_phase_stamps_job_step"
        ),
    )
    op.create_index("ix_job_phase_stamps_job_id", "job_phase_stamps", ["job_id"])
    op.create_index(
        "ix_job_phase_stamps_step_id", "job_phase_stamps", ["step_id"]
    )


def downgrade() -> None:
    raise NotImplementedError(
        "Phase N: workers / job_phase_stamps の DROP は CLAUDE.md §2.1 によりサポートしない"
    )
