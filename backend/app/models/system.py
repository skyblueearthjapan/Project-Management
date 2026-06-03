from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SystemSetting(Base):
    """システム全体の Key-Value 設定 (将来拡張用)。"""

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(Base):
    """ユーザー名簿 (認証なし。表示名 / メール / 部署のみ)。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)  # 社員番号
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str | None] = mapped_column(String(256), unique=True)
    department: Mapped[str | None] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class LinkCheckResult(Base):
    """リンク切れ検証結果 (ファイルサーバ上の PDF が消えていないか)。"""

    __tablename__ = "link_check_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)  # version / parts_list / related_doc
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # ok | missing | error
    error: Mapped[str | None] = mapped_column(Text)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Phase D Major-1: `latest_link_status` の検索を高速化する複合インデックス。
    # migration 0003_link_check_indexes と一致させる。
    __table_args__ = (
        Index(
            "ix_link_check_results_target_latest",
            "target_type",
            "target_id",
            "checked_at",
        ),
    )
