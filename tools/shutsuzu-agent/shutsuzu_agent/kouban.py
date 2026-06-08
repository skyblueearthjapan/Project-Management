"""ファイル名 → 親工番抽出 / LW・TS 判定（参照EXE :159-178 流用）。

軸名は自動抽出せず、GUI でユーザーが入力する（要件 T6）。
"""

from __future__ import annotations

import os
import re

from .members import ROLE_TS


def extract_kouban_from_filename(filename: str) -> tuple[str | None, str | None]:
    """ファイル名から (prefix, kouban_key) を抽出する。

    例:
        "LW25150.pdf"        -> ("LW", "25150")
        "TS26007 図面集.pdf"  -> ("TS", "TS26007")
        "LW25146-1 昇降軸.pdf" -> ("LW", "25146")
    読み取れなければ (None, None)。
    """
    base = os.path.splitext(filename)[0].strip()
    # 先頭の「工番」表記（例: "工番LW25146-2 …"）を取り除いてから照合する。
    base = re.sub(r"^工番[\s　]*", "", base)

    # TS/EM/NB/AL 等のプレフィックス付き
    m = re.match(r"(TS|EM|NB|AL)\s*(\d+)", base, re.IGNORECASE)
    if m:
        prefix = m.group(1).upper()
        number = m.group(2)
        return prefix, f"{prefix}{number}"

    # LW 工番（LW 付き or 5桁数字のみ）
    m = re.match(r"(?:LW)?\s*(\d{5})", base, re.IGNORECASE)
    if m:
        return "LW", m.group(1)

    return None, None


def extract_master_key_from_filename(filename: str) -> str | None:
    """工番マスタ照合キー（**枝番付き**）をファイル名から抽出する。

    マスタ（新一覧 / 日程表A）は工番を枝番付き（例 ``25146-1`` / ``TS26007``）で
    保持しているため、納品先・製品名の照会にはこのキーを使う（親工番 ``25146`` では
    引けない）。

    例:
        "LW25146-1 駆動側ポジショナー.pdf" -> "25146-1"
        "TS26007 図面集.pdf"               -> "TS26007"
        "LW25150.pdf"                      -> "25150"
    """
    base = os.path.splitext(filename)[0].strip()
    # 先頭の「工番」表記（例: "工番LW25146-2 …"）を取り除いてから照合する。
    base = re.sub(r"^工番[\s　]*", "", base)
    m = re.match(r"(TS|EM|NB|AL)\s*(\d+(?:-\d+)?)", base, re.IGNORECASE)
    if m:
        return f"{m.group(1).upper()}{m.group(2)}"
    m = re.match(r"(?:LW)?\s*(\d{5}(?:-\d+)?)", base, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def to_job_id(prefix: str, kouban_key: str) -> str:
    """親工番キーを DOVE Job ID（表示形）に整える。

    LW は番号のみで抽出されるため ``LW`` を前置する。TS 等は既に prefix 込み。
    """
    if prefix == "LW" and not kouban_key.upper().startswith("LW"):
        return f"LW{kouban_key}"
    return kouban_key


def kubun_for_role(role: str) -> str:
    """GUI の役割（LW工番 / TS工番）から DOVE kubun（"LW" | "TS"）を決める。"""
    if role == ROLE_TS:
        return "TS"
    return "LW"
