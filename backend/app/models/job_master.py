from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class JobMasterCache(Base):
    """日程表 (新一覧.xlsm / 日程表A.xlsx) のキャッシュ。

    Excel から定期的に同期される読み取り専用ビュー。
    ユーザーが「+ 新規工番」モーダルでここから工番を選ぶと、
    `jobs` テーブルに本管理用レコードが新規作成される (= マスタはここに残す)。
    """

    __tablename__ = "job_master_cache"

    job_no: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str | None] = mapped_column(String(256))
    customer: Mapped[str | None] = mapped_column(String(256))
    delivery_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    owner: Mapped[str | None] = mapped_column(String(64))
    source: Mapped[str | None] = mapped_column(String(64))  # 例: shin_ichiran, nittei_a, manual
    raw: Mapped[dict | None] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


Index("ix_job_master_cache_title", JobMasterCache.title)
Index("ix_job_master_cache_customer", JobMasterCache.customer)
Index("ix_job_master_cache_active", JobMasterCache.is_active)
