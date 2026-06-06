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
    base = os.path.splitext(filename)[0]

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
