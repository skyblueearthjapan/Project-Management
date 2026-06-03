"""job_master_cache (日程表キャッシュ) + 動作確認用シード

Revision ID: 0002_job_master_cache
Revises: 0001_initial
Create Date: 2026-05-24
"""
from __future__ import annotations

from datetime import date

import sqlalchemy as sa
from alembic import op

revision = "0002_job_master_cache"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_master_cache",
        sa.Column("job_no", sa.String(32), primary_key=True),
        sa.Column("title", sa.String(256)),
        sa.Column("customer", sa.String(256)),
        sa.Column("delivery_date", sa.Date),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("owner", sa.String(64)),
        sa.Column("source", sa.String(64)),
        sa.Column("raw", sa.JSON),
        sa.Column("note", sa.Text),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_job_master_cache_title", "job_master_cache", ["title"])
    op.create_index("ix_job_master_cache_customer", "job_master_cache", ["customer"])
    op.create_index("ix_job_master_cache_active", "job_master_cache", ["is_active"])

    # 動作確認用の日程表サンプル (実 Excel が無い dev 環境のために投入)。
    op.bulk_insert(
        sa.table(
            "job_master_cache",
            sa.column("job_no", sa.String),
            sa.column("title", sa.String),
            sa.column("customer", sa.String),
            sa.column("delivery_date", sa.Date),
            sa.column("is_active", sa.Boolean),
            sa.column("owner", sa.String),
            sa.column("source", sa.String),
        ),
        [
            {"job_no": "25214", "title": "アライメント装置", "customer": "コマツ金沢",
             "delivery_date": date(2026, 6, 30), "is_active": True, "owner": "山田", "source": "shin_ichiran"},
            {"job_no": "25215", "title": "検査ライン", "customer": "XYZ製作所",
             "delivery_date": date(2026, 7, 15), "is_active": True, "owner": "佐藤", "source": "shin_ichiran"},
            {"job_no": "25216", "title": "搬送ユニット", "customer": "ABC工業",
             "delivery_date": date(2026, 8, 10), "is_active": True, "owner": "鈴木", "source": "shin_ichiran"},
            {"job_no": "25217", "title": "プレス機 改造", "customer": "三菱マテリアル",
             "delivery_date": date(2026, 9, 5), "is_active": True, "owner": "高橋", "source": "nittei_a"},
            {"job_no": "25218", "title": "自動梱包装置", "customer": "日立物流",
             "delivery_date": date(2026, 10, 20), "is_active": True, "owner": "渡辺", "source": "nittei_a"},
            {"job_no": "25219", "title": "溶接ロボット治具", "customer": "ファナック",
             "delivery_date": date(2026, 11, 30), "is_active": True, "owner": "山田", "source": "shin_ichiran"},
            {"job_no": "25220", "title": "ステージ昇降装置", "customer": "島津製作所",
             "delivery_date": date(2026, 12, 25), "is_active": True, "owner": "佐藤", "source": "shin_ichiran"},
            {"job_no": "25201", "title": "テストベンチ (旧)", "customer": "コマツ金沢",
             "delivery_date": date(2026, 1, 15), "is_active": False, "owner": "山田", "source": "shin_ichiran"},
        ],
    )


def downgrade() -> None:
    raise NotImplementedError("job_master_cache の downgrade はサポートしません")
