"""購入部品追加依頼 (purchase_requests / purchase_request_replies) + jobs.origin

Revision ID: 0012_purchase_requests
Revises: 0011_job_axis_archive
Create Date: 2026-07-27

設計部員 → 資材購買 → 設計部員 の往復とステータス管理をデジタル化する
(docs/REQUIREMENTS_購入部品追加依頼.md / docs/DESIGN_購入部品追加依頼.md)。

CLAUDE.md §2.1 整合:
  - 依頼・回答ともに削除しない。非表示は archived_at の論理アーカイブのみ。
  - downgrade での DROP TABLE / DROP COLUMN は実装しない。

jobs.origin について:
  - 既存行は server_default="shutsuzu" で backfill される (現行 22 件はすべて出図由来)。
  - 購入依頼だけで発生した工番は "purchase" となり、工番一覧・件数・検索から除外する。
    記録は残しつつ UI には出さない、という方針を 1 列で表現する。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012_purchase_requests"
down_revision = "0011_job_axis_archive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column(
            "origin",
            sa.String(length=16),
            nullable=False,
            server_default="shutsuzu",
        ),
    )
    op.create_index("ix_jobs_origin", "jobs", ["origin"])

    op.create_table(
        "purchase_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # 工番未定を許容するため nullable。Job が消えても依頼は残す。
        sa.Column("job_id", sa.String(length=32), nullable=True),
        sa.Column("job_no_input", sa.String(length=64), nullable=True),
        sa.Column("branch_no", sa.String(length=32), nullable=True),
        sa.Column("requester_account", sa.String(length=64), nullable=False),
        sa.Column("requester_name", sa.String(length=64), nullable=False),
        sa.Column("requester_email", sa.String(length=256), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_file_path", sa.String(length=512), nullable=False),
        sa.Column("request_file_original_name", sa.String(length=256), nullable=False),
        sa.Column("request_file_size", sa.BigInteger(), nullable=True),
        sa.Column("subject", sa.String(length=256), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="requested"),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("client_request_id", sa.String(length=64), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("client_request_id", name="uq_purchase_requests_client_request_id"),
    )
    op.create_index("ix_purchase_requests_job_id", "purchase_requests", ["job_id"])
    op.create_index("ix_purchase_requests_status", "purchase_requests", ["status"])
    op.create_index("ix_purchase_requests_requester", "purchase_requests", ["requester_account"])
    op.create_index("ix_purchase_requests_archived_at", "purchase_requests", ["archived_at"])

    op.create_table(
        "purchase_request_replies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("pdf_path", sa.String(length=512), nullable=False),
        sa.Column("original_name", sa.String(length=256), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("replied_by_account", sa.String(length=64), nullable=False),
        sa.Column("replied_by_name", sa.String(length=64), nullable=True),
        sa.Column("replied_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("client_reply_id", sa.String(length=64), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["request_id"], ["purchase_requests.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("client_reply_id", name="uq_purchase_request_replies_client_reply_id"),
    )
    op.create_index(
        "ix_purchase_request_replies_request_id",
        "purchase_request_replies",
        ["request_id"],
    )


def downgrade() -> None:
    raise NotImplementedError(
        "purchase_requests / jobs.origin の DROP はサポートしない (CLAUDE.md §2.1 整合)"
    )
