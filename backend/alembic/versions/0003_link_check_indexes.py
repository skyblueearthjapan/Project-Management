"""link_check_results に複合インデックス追加 (Phase D Major-1)

Revision ID: 0003_link_check_indexes
Revises: 0002_job_master_cache
Create Date: 2026-05-24

Phase D レビュー Major-1: `latest_link_status` の検索高速化のため、
(target_type, target_id, checked_at) の複合インデックスを追加する。

CLAUDE.md §2.1 整合: downgrade での DROP INDEX はサポートしない。
"""
from __future__ import annotations

from alembic import op

revision = "0003_link_check_indexes"
down_revision = "0002_job_master_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_link_check_results_target_latest",
        "link_check_results",
        ["target_type", "target_id", "checked_at"],
    )


def downgrade() -> None:
    raise NotImplementedError("インデックス削除はサポートしない (CLAUDE.md §2.1 整合)")
