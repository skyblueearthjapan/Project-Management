from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
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


class PurchaseRequest(Base):
    """購入部品追加依頼 (設計部員 → 資材購買)。

    設計方針 (DESIGN_購入部品追加依頼.md §1.1):
      - `job_id` は **nullable**。工番が決まる前の先行手配依頼を受け付けるため。
        後から `PATCH` で紐づけ直せる (設計部員・購買担当の双方が実行可)。
      - `branch_no` (枝番 例 `25146-1`) は **付帯情報として文字列で持つだけ**。
        本来存在しないはずの例外であり、階層/親子として構造化すると運用が
        正常化したときに不要な複雑さだけが残るため。
      - 部品リスト Excel は各自の PC 上にあるため **アップロードして保管**する
        (パス参照では他者が解決できない)。実体は `/mnt/uploads/purchase/{id}/`。
      - 削除はしない。非表示は `archived_at` の論理アーカイブのみ (CLAUDE.md §2.1)。
    """

    __tablename__ = "purchase_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 工番未定を許容するため nullable。Job が消えても依頼は残す (SET NULL)。
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    # ユーザーが選択/入力した工番文字列の原文 (枝番込み)。job_id が NULL でも残す。
    job_no_input: Mapped[str | None] = mapped_column(String(64))
    # 枝番 (例 25146-1)。構造化しない付帯情報。
    branch_no: Mapped[str | None] = mapped_column(String(32))

    requester_account: Mapped[str] = mapped_column(String(64), nullable=False)
    requester_name: Mapped[str] = mapped_column(String(64), nullable=False)
    requester_email: Mapped[str] = mapped_column(String(256), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # `/mnt/uploads` からの相対パス (posix)。配信時に resolve_under で配下強制。
    request_file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    # 依頼者 PC 上の元ファイル名。`部品リスト.xlsx` 等の汎用名が多数来る前提の表示用。
    request_file_original_name: Mapped[str] = mapped_column(String(256), nullable=False)
    request_file_size: Mapped[int | None] = mapped_column(BigInteger)

    subject: Mapped[str | None] = mapped_column(String(256))
    note: Mapped[str | None] = mapped_column(Text)

    # requested / ordered / answered (= 完了)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="requested")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # 冪等キー: EXE が送信前に 1 回だけ生成する UUID。
    # メール送信成功 → 登録失敗 → 再試行 でも重複を作らないための要。
    client_request_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)

    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    job: Mapped[Job | None] = relationship()
    replies: Mapped[list[PurchaseRequestReply]] = relationship(
        back_populates="request",
        cascade="save-update, merge",
        order_by="PurchaseRequestReply.replied_at",
    )


class PurchaseRequestReply(Base):
    """手配結果の回答 (資材購買 → 設計部員)。

    紙で手渡ししていた手配状況資料のスキャン PDF を保持する。
    分納・追加回答があり得るため **1 依頼に 0〜n 件**を許容する。
    """

    __tablename__ = "purchase_request_replies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_requests.id", ondelete="CASCADE"), nullable=False
    )
    pdf_path: Mapped[str] = mapped_column(String(512), nullable=False)
    original_name: Mapped[str | None] = mapped_column(String(256))
    size: Mapped[int | None] = mapped_column(BigInteger)

    replied_by_account: Mapped[str] = mapped_column(String(64), nullable=False)
    replied_by_name: Mapped[str | None] = mapped_column(String(64))
    replied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    client_reply_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)

    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    request: Mapped[PurchaseRequest] = relationship(back_populates="replies")


Index("ix_purchase_requests_job_id", PurchaseRequest.job_id)
Index("ix_purchase_requests_status", PurchaseRequest.status)
Index("ix_purchase_requests_requester", PurchaseRequest.requester_account)
Index("ix_purchase_requests_archived_at", PurchaseRequest.archived_at)
Index("ix_purchase_request_replies_request_id", PurchaseRequestReply.request_id)
