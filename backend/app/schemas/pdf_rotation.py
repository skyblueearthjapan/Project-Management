from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class PdfRotationRead(ORMModel):
    """1 ページ分の回転メタ。"""

    page_index: int
    rotation: int


class PdfRotationItem(BaseModel):
    """PUT のリクエスト 1 要素。"""

    page_index: int = Field(ge=0)
    rotation: int = Field(ge=0, le=270)


class PdfRotationsReplaceRequest(BaseModel):
    """指定バージョンの回転リストを全置換するリクエスト。

    送られなかった page_index は (回転 0 とみなして) サーバ側で削除する。
    """

    rotations: list[PdfRotationItem] = []
