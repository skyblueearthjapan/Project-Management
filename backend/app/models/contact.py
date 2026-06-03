from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Contact(Base):
    """連絡先 (社内/社外) マスタ。"""

    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    company: Mapped[str | None] = mapped_column(String(128))
    department: Mapped[str | None] = mapped_column(String(128))
    note: Mapped[str | None] = mapped_column(String(256))
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
