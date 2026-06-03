"""initial schema (v1.0.4)

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-22

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("customer", sa.String(256)),
        sa.Column("delivery_date", sa.Date),
        sa.Column("delivery_date_internal", sa.Date),
        sa.Column("note", sa.Text),
        sa.Column("starred", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_jobs_delivery_date", "jobs", ["delivery_date"])
    op.create_index("ix_jobs_starred_status", "jobs", ["starred", "status"])

    op.create_table(
        "axes",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(32), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("third_party_required", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("job_id", "name", name="uq_axes_job_name"),
    )
    op.create_index("ix_axes_job_id", "axes", ["job_id"])

    op.create_table(
        "versions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_no", sa.Integer, nullable=False),
        sa.Column("label", sa.String(64)),
        sa.Column("pdf_path", sa.String(512), nullable=False),
        sa.Column("pdf_size", sa.BigInteger),
        sa.Column("pdf_sha256", sa.String(64)),
        sa.Column("note", sa.Text),
        sa.Column("released_at", sa.DateTime(timezone=True)),
        sa.Column("released_by", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("axis_id", "version_no", name="uq_versions_axis_versionno"),
    )
    op.create_index("ix_versions_axis_id", "versions", ["axis_id"])

    op.create_table(
        "progress_steps",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("short_label", sa.String(8), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
    )

    op.create_table(
        "axis_progress",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.Integer, sa.ForeignKey("progress_steps.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="notstarted"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("done_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(64)),
        sa.UniqueConstraint("axis_id", "step_id", name="uq_axis_progress_axis_step"),
    )
    op.create_index("ix_axis_progress_axis_id", "axis_progress", ["axis_id"])

    op.create_table(
        "contacts",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("email", sa.String(256), nullable=False, unique=True),
        sa.Column("company", sa.String(128)),
        sa.Column("department", sa.String(128)),
        sa.Column("note", sa.String(256)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "mail_templates",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("subject", sa.String(256), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "mail_logs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(32), sa.ForeignKey("jobs.id", ondelete="SET NULL")),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="SET NULL")),
        sa.Column("version_id", sa.Integer, sa.ForeignKey("versions.id", ondelete="SET NULL")),
        sa.Column("template_id", sa.Integer, sa.ForeignKey("mail_templates.id", ondelete="SET NULL")),
        sa.Column("subject", sa.String(256), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("error", sa.Text),
        sa.Column("eml_path", sa.String(512)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("sent_by", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mail_logs_job_id", "mail_logs", ["job_id"])
    op.create_index("ix_mail_logs_created_at", "mail_logs", ["created_at"])

    op.create_table(
        "mail_log_recipients",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("mail_log_id", sa.Integer, sa.ForeignKey("mail_logs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(4), nullable=False),
        sa.Column("name", sa.String(128)),
        sa.Column("email", sa.String(256), nullable=False),
    )
    op.create_index("ix_mail_log_recipients_mail_log_id", "mail_log_recipients", ["mail_log_id"])

    op.create_table(
        "related_docs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("title", sa.String(256)),
        sa.Column("size", sa.BigInteger),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_related_docs_axis_id", "related_docs", ["axis_id"])

    op.create_table(
        "parts_lists",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("note", sa.Text),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "parts_list_versions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("parts_list_id", sa.Integer, sa.ForeignKey("parts_lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_no", sa.Integer, nullable=False),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("label", sa.String(64)),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.String(64)),
        sa.UniqueConstraint("parts_list_id", "version_no", name="uq_parts_list_versions_pl_versionno"),
    )
    op.create_index("ix_parts_list_versions_pl", "parts_list_versions", ["parts_list_id"])

    op.create_table(
        "pdf_replacements",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_id", sa.Integer, sa.ForeignKey("versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("replaced_pdf_path", sa.String(512), nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.String(64)),
    )
    op.create_index("ix_pdf_replacements_axis_id", "pdf_replacements", ["axis_id"])

    op.create_table(
        "inventory_attachments",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_path", sa.String(512)),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_attachments_axis_id", "inventory_attachments", ["axis_id"])

    op.create_table(
        "checklist_attachments",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_code", sa.String(32), nullable=False),
        sa.Column("file_path", sa.String(512)),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_checklist_attachments_axis_step", "checklist_attachments", ["axis_id", "step_code"])

    op.create_table(
        "action_logs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(32), sa.ForeignKey("jobs.id", ondelete="SET NULL")),
        sa.Column("axis_id", sa.Integer, sa.ForeignKey("axes.id", ondelete="SET NULL")),
        sa.Column("actor", sa.String(64)),
        sa.Column("action_type", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_action_logs_job_id", "action_logs", ["job_id"])
    op.create_index("ix_action_logs_created_at", "action_logs", ["created_at"])

    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.JSON),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("email", sa.String(256), unique=True),
        sa.Column("department", sa.String(128)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "link_check_results",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.Integer, nullable=False),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error", sa.Text),
        sa.Column("checked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # 進捗工程の初期データ投入 (v1.0.4 固定 10 工程)
    op.bulk_insert(
        sa.table(
            "progress_steps",
            sa.column("code", sa.String),
            sa.column("name", sa.String),
            sa.column("short_label", sa.String),
            sa.column("sort_order", sa.Integer),
            sa.column("is_active", sa.Boolean),
        ),
        [
            {"code": "preinspection", "name": "前検査", "short_label": "前検", "sort_order": 10, "is_active": True},
            {"code": "design", "name": "設計", "short_label": "設計", "sort_order": 20, "is_active": True},
            {"code": "inventory", "name": "在庫", "short_label": "在庫", "sort_order": 30, "is_active": True},
            {"code": "purchase", "name": "購入", "short_label": "購入", "sort_order": 40, "is_active": True},
            {"code": "material", "name": "材料", "short_label": "材料", "sort_order": 50, "is_active": True},
            {"code": "mid_inspection", "name": "中間検査", "short_label": "M検", "sort_order": 60, "is_active": True},
            {"code": "factory", "name": "工場", "short_label": "工場", "sort_order": 70, "is_active": True},
            {"code": "water_test", "name": "水すまし", "short_label": "水す", "sort_order": 80, "is_active": True},
            {"code": "bolt", "name": "ボルト締結", "short_label": "ボル", "sort_order": 90, "is_active": True},
            {"code": "assembly", "name": "組立", "short_label": "組立", "sort_order": 100, "is_active": True},
        ],
    )


def downgrade() -> None:
    # downgrade は意図的に未実装 (運用上、初期版は維持し続ける方針)。
    raise NotImplementedError("initial migration の downgrade はサポートしません")
