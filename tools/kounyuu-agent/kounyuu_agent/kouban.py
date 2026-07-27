"""工番文字列の正規化 (出図EXE `shutsuzu_agent.kouban` の考え方を踏襲)。

**ID 体系のズレ** への対応がこのモジュールの存在理由:
  - 日程表マスタ: `25146-1` … 枝番あり・LW 接頭辞なし
  - DOVE の工番 : `LW25146` … 親工番・LW 接頭辞あり
この 2 つは直接照合できないため、
  - DOVE へ送る `job_id` は **親工番** (`to_job_id`)
  - マスタ照合は **枝番付きキー** (`master_key`)
という二段構えにする。
"""

from __future__ import annotations

import re
import unicodedata


def normalize(text: str) -> str:
    """全角英数字・空白を半角へ寄せ、先頭の「工番」表記を落とす。"""
    base = unicodedata.normalize("NFKC", text or "").strip()
    return re.sub(r"^工番[\s　]*", "", base)


def master_key(job_no_input: str) -> str | None:
    """マスタ照合キー (**枝番付き**) を取り出す。

    例: `LW25146-1` -> `25146-1` / `TS26007` -> `TS26007` / `25150` -> `25150`
    """
    base = normalize(job_no_input)
    m = re.match(r"(TS|EM|NB|AL)\s*(\d+(?:-\d+)?)", base, re.IGNORECASE)
    if m:
        return f"{m.group(1).upper()}{m.group(2)}"
    m = re.match(r"(?:LW)?\s*(\d{5}(?:-\d+)?)", base, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def to_job_id(job_no_input: str) -> str | None:
    """DOVE の Job ID (**親工番**) を作る。

    例: `25146-1` -> `LW25146` / `LW25146` -> `LW25146` / `TS26007` -> `TS26007`
    """
    base = normalize(job_no_input)
    m = re.match(r"(TS|EM|NB|AL)\s*(\d+)", base, re.IGNORECASE)
    if m:
        return f"{m.group(1).upper()}{m.group(2)}"
    m = re.match(r"(?:LW)?\s*(\d{5})", base, re.IGNORECASE)
    if m:
        return f"LW{m.group(1)}"
    return None


def branch_no(job_no_input: str) -> str | None:
    """枝番付きの表記だった場合のみ、その原文を返す (無ければ None)。

    枝番は本来存在しないはずの例外なので、**構造化せず文字列のまま**扱う。
    """
    key = master_key(job_no_input)
    if key and "-" in key:
        return key
    return None
