from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

# 工番フォーマット (Path Traversal 防止 / Job.id String(32) 整合)。
_JOB_ID_PATTERN = r"^[A-Za-z0-9._-]{1,32}$"


def _normalize_rel(value: str) -> str:
    """fileserver 相対パスへ正規化する。

    - `\\` を `/` に
    - 先頭 `/` を除去 (絶対パス化を防ぐ)
    実体への書き込みは一切しない (CLAUDE.md §2.2)。Traversal の最終防御は
    配信時の resolve_under が担う (DESIGN §2.1)。
    """
    rel = value.strip().replace("\\", "/").lstrip("/")
    if not rel:
        raise ValueError("パスが空です")
    return rel


def _normalize_pdf_rel(value: str) -> str:
    rel = _normalize_rel(value)
    if not rel.lower().endswith(".pdf"):
        raise ValueError("パスは拡張子 .pdf を指定してください")
    return rel


# ---- Request -----------------------------------------------------------------
class MailRecipientIn(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    email: str = Field(min_length=1, max_length=256)


class ShutsuzuMailIn(BaseModel):
    subject: str = Field(min_length=1, max_length=256)
    sent_at: datetime | None = None
    # PII 回避のため既定は空。呼出側が本文を入れる場合のみ記録する。
    body: str = ""
    to: list[MailRecipientIn] = Field(default_factory=list)
    cc: list[MailRecipientIn] = Field(default_factory=list)


class ShutsuzuAxisIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    drawing_pdf_path: str = Field(min_length=1, max_length=512)
    drawing_label: str | None = Field(default=None, max_length=64)
    dxf_folder_path: str | None = Field(default=None, max_length=512)

    @field_validator("drawing_pdf_path")
    @classmethod
    def _v_drawing_pdf(cls, v: str) -> str:
        return _normalize_pdf_rel(v)

    @field_validator("dxf_folder_path")
    @classmethod
    def _v_dxf_folder(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        return _normalize_rel(v)


class ShutsuzuRegisterIn(BaseModel):
    job_id: str = Field(pattern=_JOB_ID_PATTERN)
    kubun: Literal["LW", "TS"]
    # master 欠落時の Job.title / customer フォールバック。既存 Job は上書きしない。
    title: str | None = Field(default=None, max_length=256)
    customer: str | None = Field(default=None, max_length=256)
    delivery_date: date | None = None
    released_by: str | None = Field(default=None, max_length=64)
    axes: list[ShutsuzuAxisIn] = Field(min_length=1)
    instruction_pdf_path: str | None = Field(default=None, max_length=512)
    instruction_original_name: str | None = Field(default=None, max_length=256)
    mail: ShutsuzuMailIn | None = None

    @field_validator("instruction_pdf_path")
    @classmethod
    def _v_instruction_pdf(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        return _normalize_pdf_rel(v)


# ---- Response ----------------------------------------------------------------
class ShutsuzuAxisResult(BaseModel):
    name: str
    axis_id: int
    axis_created: bool
    version_id: int
    version_created: bool
    dxf_registered: int = 0
    dxf_skipped: int = 0
    dxf_warning: str | None = None


class ShutsuzuRegisterOut(BaseModel):
    job_id: str
    job_created: bool
    axes: list[ShutsuzuAxisResult] = Field(default_factory=list)
    instruction_id: int | None = None
    instruction_created: bool = False
    mail_log_id: int | None = None
    warnings: list[str] = Field(default_factory=list)


# ---- 工番別指示書 CRUD --------------------------------------------------------
class JobInstructionRead(ORMModel):
    id: int
    job_id: str
    file_path: str
    original_name: str | None
    size: int | None
    note: str | None
    created_at: datetime
    created_by: str | None


class JobInstructionCreate(BaseModel):
    file_path: str = Field(min_length=1, max_length=512)
    original_name: str | None = Field(default=None, max_length=256)
    note: str | None = None

    @field_validator("file_path")
    @classmethod
    def _v_file_path(cls, v: str) -> str:
        return _normalize_pdf_rel(v)
