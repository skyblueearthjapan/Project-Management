"""送付先一覧.xlsx 読込 + TO/CC 振り分け（参照EXE :65-103 流用）。

Excel は openpyxl で読むだけ（read_only / data_only）。書込・削除はしない。
"""

from __future__ import annotations

from typing import TypedDict

import openpyxl

# 役割定数
ROLE_SHIJI = "工番別指示書"
ROLE_LW = "LW工番"
ROLE_TS = "TS工番"


class Member(TypedDict):
    """送付先一覧の 1 行（ID / 名前 / メール / 役割フラグ）。"""

    id: object
    name: str
    email: str
    shiji: str
    lw: str
    ts: str


def load_members(xlsx_path: str) -> list[Member]:
    """送付先一覧.xlsx を読み込み、メンバーリストを返す。

    ヘッダ: ID, 名前, メールアドレス, 工番別指示書, LW工番, TS工番。
    """
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
                    name=(str(r[1]).strip() if len(r) > 1 and r[1] else ""),
                    email=(str(r[2]).strip() if len(r) > 2 and r[2] else ""),
                    shiji=(str(r[3]).strip() if len(r) > 3 and r[3] else "×"),
                    lw=(str(r[4]).strip() if len(r) > 4 and r[4] else "×"),
                    ts=(str(r[5]).strip() if len(r) > 5 and r[5] else "×"),
                )
            )
        return members
    finally:
        wb.close()


def get_recipients(members: list[Member], role: str) -> tuple[list[Member], list[Member]]:
    """役割に応じて (TO, CC) を振り分ける。

    フラグ ``○``/``〇``/``O`` → TO、``CC`` → CC、それ以外（``×`` 等）は対象外。
    """
    to_list: list[Member] = []
    cc_list: list[Member] = []
    for m in members:
        if role == ROLE_SHIJI:
            flag = m["shiji"]
        elif role == ROLE_LW:
            flag = m["lw"]
        else:
            flag = m["ts"]

        flag_upper = flag.upper().strip()
        if flag_upper in ("○", "〇", "O"):
            to_list.append(m)
        elif flag_upper == "CC":
            cc_list.append(m)
    return to_list, cc_list


def get_recipients_label(
    members: list[Member], role: str
) -> tuple[str, str, list[Member], list[Member]]:
    """宛先プレビュー用のラベル文字列（TO行 / CC行）と TO/CC リストを返す。"""
    to_list, cc_list = get_recipients(members, role)
    to_names = ", ".join(m["name"] for m in to_list) or "(なし)"
    cc_names = ", ".join(m["name"] for m in cc_list) or "(なし)"
    to_text = f"TO ({len(to_list)}名): {to_names}"
    cc_text = f"CC ({len(cc_list)}名): {cc_names}"
    return to_text, cc_text, to_list, cc_list
