from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class RelatedDocRead(ORMModel):
    id: int
    axis_id: int
    file_path: str
    title: str | None
    size: int | None
    note: str | None
    created_at: datetime
    # Phase D: 直近の link_check_results.status が "missing" の場合 True
    is_link_broken: bool = False


class RelatedDocCreate(BaseModel):
    file_path: str = Field(min_length=1, max_length=512)
    title: str | None = None
    note: str | None = None


class PartsListVersionRead(ORMModel):
    id: int
    parts_list_id: int
    version_no: int
    file_path: str
    label: str | None
    note: str | None
    created_at: datetime
    created_by: str | None
    # Phase D: 直近の link_check_results.status が "missing" の場合 True
    is_link_broken: bool = False


class PartsListVersionCreate(BaseModel):
    file_path: str = Field(min_length=1, max_length=512)
    label: str | None = None
    note: str | None = None
    created_by: str | None = None


class PartsListRead(ORMModel):
    id: int
    axis_id: int
    note: str | None
    updated_at: datetime
    versions: list[PartsListVersionRead] = []


class PdfReplacementRead(ORMModel):
    id: int
    axis_id: int
    version_id: int
    replaced_pdf_path: str
    note: str | None
    created_at: datetime
    created_by: str | None
    # Phase D: 直近の link_check_results.status が "missing" の場合 True
    is_link_broken: bool = False


class PdfReplacementCreate(BaseModel):
    """LinkModal の A/P モード用: 既存ファイルへのパス参照のみで差替行を登録する。"""

    version_id: int = Field(gt=0)
    file_path: str = Field(min_length=1, max_length=512)
    note: str | None = None
    created_by: str | None = None
