from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.job import Job


class MailTemplate(Base):
    """メールテンプレート。"""

    __tablename__ = "mail_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    subject: Mapped[str] = mapped_column(String(256), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class MailLog(Base):
    """メール送信履歴。"""

    __tablename__ = "mail_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[str | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL")
    )
    axis_id: Mapped[int | None] = mapped_column(ForeignKey("axes.id", ondelete="SET NULL"))
    version_id: Mapped[int | None] = mapped_column(ForeignKey("versions.id", ondelete="SET NULL"))
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("mail_templates.id", ondelete="SET NULL")
    )
    subject: Mapped[str] = mapped_column(String(256), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False)  # eml | agent
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="queued"
    )  # queued | sent | failed
    error: Mapped[str | None] = mapped_column(Text)
    eml_path: Mapped[str | None] = mapped_column(String(512))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    job: Mapped[Job | None] = relationship(back_populates="mail_logs")
    recipients: Mapped[list[MailLogRecipient]] = relationship(
        back_populates="mail_log", cascade="save-update, merge"
    )


class MailLogRecipient(Base):
    """メール送信先 (To/Cc/Bcc)。"""

    __tablename__ = "mail_log_recipients"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mail_log_id: Mapped[int] = mapped_column(
        ForeignKey("mail_logs.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(4), nullable=False)  # to | cc | bcc
    name: Mapped[str | None] = mapped_column(String(128))
    email: Mapped[str] = mapped_column(String(256), nullable=False)

    mail_log: Mapped[MailLog] = relationship(back_populates="recipients")


Index("ix_mail_logs_job_id", MailLog.job_id)
Index("ix_mail_logs_created_at", MailLog.created_at)
Index("ix_mail_log_recipients_mail_log_id", MailLogRecipient.mail_log_id)
