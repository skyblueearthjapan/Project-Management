"""共通 Excel リーダー。read_only=True / data_only=True を強制する (書き込み厳禁)。"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Iterator

import openpyxl
from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet


def read_workbook(path: Path | str, *, keep_vba: bool = False) -> Workbook:
    """read_only=True / data_only=True で開く。書き戻しは不可。"""
    return openpyxl.load_workbook(
        str(path),
        read_only=True,
        data_only=True,
        keep_vba=keep_vba,
    )


def is_excel_locked(path: Path | str) -> bool:
    """Excel 編集中ロック (~$名前.xlsx) の存在を確認する。"""
    p = Path(path)
    lock = p.parent / f"~${p.name}"
    return lock.exists()


def iter_data_rows(ws: Worksheet, min_row: int = 1) -> Iterator[tuple]:
    return ws.iter_rows(min_row=min_row, values_only=True)


def cell_str(value: object) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def cell_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        try:
            from openpyxl.utils.datetime import from_excel

            return from_excel(value).date()
        except Exception:
            return None
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None
