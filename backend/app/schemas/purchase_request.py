from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

# 工番フォーマット (Path Traversal 防止 / Job.id String(32) 整合)。
_JOB_ID_PATTERN = r"^[A-Za-z0-9._-]{1,32}$"

# ステータス。`ordered` を運用で使うかは未確定 (要件 T-04) だが、
# 使わない場合でも DB / スキーマの変更は不要 (値を使わないだけ)。
PurchaseStatus = Literal["requested", "ordered", "answered"]


class MailRecipientIn(BaseModel):
    """送信履歴 (mail_logs) 用の宛先。本文は保持しない (PII 回避)。"""

    name: str | None = Field(default=None, max_length=128)
    email: str = Field(min_length=1, max_length=256)


class PurchaseRequestCreate(BaseModel):
    """依頼登録のメタ情報。

    実ファイル (部品リスト Excel) は multipart の `file` で別途受け取る。
    ルーター側で Form フィールドから本モデルを組み立てて検証する。
    """

    client_request_id: str = Field(min_length=1, max_length=64)
    # 工番未定を許容するため job_id は任意。
    job_id: str | None = Field(default=None, pattern=_JOB_ID_PATTERN)
    job_no_input: str | None = Field(default=None, max_length=64)
    branch_no: str | None = Field(default=None, max_length=32)
    # Job 新規作成時のフォールバック (EXE が枝番照合で取得済みの値)。
    title: str | None = Field(default=None, max_length=256)
    customer: str | None = Field(default=None, max_length=256)
    delivery_date: date | None = None

    requester_account: str = Field(min_length=1, max_length=64)
    requester_name: str = Field(min_length=1, max_length=64)
    requester_email: str = Field(min_length=1, max_length=256)

    subject: str | None = Field(default=None, max_length=256)
    note: str | None = None
    requested_at: datetime | None = None

    mail_to: list[MailRecipientIn] = Field(default_factory=list)
    mail_cc: list[MailRecipientIn] = Field(default_factory=list)

    @field_validator("job_id", "job_no_input", "branch_no", "subject", mode="before")
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        """multipart の空文字を None に寄せる (Form は空欄でも "" が来るため)。"""
        if isinstance(v, str) and not v.strip():
            return None
        return v


class PurchaseRequestUpdate(BaseModel):
    """工番の後付け紐づけ / ステータス変更 / 論理アーカイブ。

    工番の紐づけは設計部員・購買担当の双方が実行できる (要件 D-06)。
    """

    job_id: str | None = Field(default=None, pattern=_JOB_ID_PATTERN)
    # Job 新規作成時のフォールバック。
    title: str | None = Field(default=None, max_length=256)
    customer: str | None = Field(default=None, max_length=256)
    branch_no: str | None = Field(default=None, max_length=32)
    status: PurchaseStatus | None = None
    note: str | None = None
    archived: bool | None = None


class PurchaseReplyCreate(BaseModel):
    """回答登録のメタ情報。スキャン PDF は multipart の `file` で受け取る。"""

    client_reply_id: str = Field(min_length=1, max_length=64)
    replied_by_account: str = Field(min_length=1, max_length=64)
    replied_by_name: str | None = Field(default=None, max_length=64)
    note: str | None = None
    replied_at: datetime | None = None
    # 既定は完了 (回答 PDF を返送した時点をもって完了とする)。
    set_status: PurchaseStatus = "answered"


# ---- Response ----------------------------------------------------------------
class PurchaseReplyRead(ORMModel):
    id: int
    request_id: int
    pdf_path: str
    original_name: str | None
    size: int | None
    replied_by_account: str
    replied_by_name: str | None
    replied_at: datetime
    note: str | None
    created_at: datetime


class PurchaseRequestRead(ORMModel):
    id: int
    job_id: str | None
    job_no_input: str | None
    branch_no: str | None
    requester_account: str
    requester_name: str
    requester_email: str
    requested_at: datetime
    request_file_path: str
    request_file_original_name: str
    request_file_size: int | None
    subject: str | None
    note: str | None
    status: str
    closed_at: datetime | None
    archived_at: datetime | None
    created_at: datetime
    replies: list[PurchaseReplyRead] = Field(default_factory=list)
    # Job から join して埋める表示用フィールド (工番未定なら None)。
    job_title: str | None = None
    customer: str | None = None


class PurchaseRequestRegisterOut(BaseModel):
    """EXE 向けの登録結果。`created=False` は冪等ヒット (再送) を意味する。"""

    id: int
    created: bool
    job_id: str | None
    job_created: bool
    job_unassigned: bool
    branch_no: str | None
    status: str
    request_file_path: str
    request_file_original_name: str
    mail_log_id: int | None = None
    warnings: list[str] = Field(default_factory=list)
