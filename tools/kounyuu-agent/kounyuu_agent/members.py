"""送付先マスタ Excel の読込 + 役割判定。

マスタはファイルサーバ上に **1 つだけ**置き、全員がそれを読む
(EXE と一緒に配布しない = 各自の手元でバラバラにならないようにするため)。

openpyxl は `read_only` / `data_only` で **読むだけ**。書込・削除・改名は一切しない。

想定ヘッダ (1 行目):
    ID / 名前 / Windowsアカウント / メールアドレス / 役割 / 依頼CC / 回答CC
  - 役割:   `設計` = 設計部員モード、`購買` = 購買モード
  - 依頼CC: 設計 → 購買 の送信時に自動挿入 (`○`=TO / `CC` / `×`)
  - 回答CC: 購買 → 設計 の返信時に自動挿入 (同上)
"""

from __future__ import annotations

from typing import TypedDict

import openpyxl

ROLE_DESIGN = "設計"
ROLE_PURCHASE = "購買"


class Member(TypedDict):
    id: object
    name: str
    account: str
    email: str
    role: str
    request_cc: str
    reply_cc: str


def flag_kind(flag: str) -> str:
    """フラグ文字列を `"to"` / `"cc"` / `"none"` に正規化する。

    `○`/`〇`/`O` → TO、`CC` → CC、それ以外 (`×` / 空欄) → 対象外。
    出図EXE (`shutsuzu_agent.members.flag_kind`) と同じ規約に揃える。
    """
    f = (flag or "").upper().strip()
    if f in ("○", "〇", "O"):
        return "to"
    if f == "CC":
        return "cc"
    return "none"


def _cell(row: tuple, idx: int, default: str = "") -> str:
    if len(row) > idx and row[idx] is not None:
        return str(row[idx]).strip()
    return default


def load_members(xlsx_path: str) -> list[Member]:
    """送付先マスタを読み込む。"""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    try:
        ws = wb.active
        members: list[Member] = []
        for r in ws.iter_rows(min_row=2, values_only=True):
            if not r or not r[0]:
                continue
            members.append(
                Member(
                    id=r[0],
                    name=_cell(r, 1),
                    account=_cell(r, 2),
                    email=_cell(r, 3),
                    role=_cell(r, 4, ROLE_DESIGN),
                    request_cc=_cell(r, 5, "×"),
                    reply_cc=_cell(r, 6, "×"),
                )
            )
        return members
    finally:
        wb.close()


def find_by_account(members: list[Member], account: str) -> Member | None:
    """Windows アカウントで本人の行を探す (大文字小文字は無視)。"""
    key = (account or "").strip().lower()
    if not key:
        return None
    for m in members:
        if m["account"].strip().lower() == key:
            return m
    return None


def purchasers(members: list[Member]) -> list[Member]:
    """購買担当 (= 依頼の宛先)。増員・代理に備えて複数を許容する。"""
    return [m for m in members if m["role"] == ROLE_PURCHASE and m["email"]]


def split_by_flag(members: list[Member], column: str) -> tuple[list[Member], list[Member]]:
    """指定した CC 列の値で TO / CC に振り分ける。"""
    to_list: list[Member] = []
    cc_list: list[Member] = []
    for m in members:
        if not m["email"]:
            continue
        kind = flag_kind(m[column])  # type: ignore[literal-required]
        if kind == "to":
            to_list.append(m)
        elif kind == "cc":
            cc_list.append(m)
    return to_list, cc_list
