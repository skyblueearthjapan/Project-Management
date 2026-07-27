"""ログイン中の Windows アカウント取得。

認証基盤が無い環境のため、これが「誰が操作しているか」の唯一の手がかりになる。
**自己申告ベースであり厳密な本人証明ではない** 点は設計上の前提
(docs/REQUIREMENTS_購入部品追加依頼.md §5.1)。

ファイルの読み書きは一切行わない。
"""

from __future__ import annotations

import os

try:  # pragma: no cover - Windows 以外では import できない
    import win32api
except ImportError:  # pragma: no cover
    win32api = None  # type: ignore[assignment]


def get_windows_account() -> str:
    """ログイン中の Windows アカウント名を返す。

    `USERNAME` 環境変数を第一候補にする (最も確実で高速)。
    取得できない場合のみ `win32api.GetUserName()` にフォールバックする。
    """
    name = (os.environ.get("USERNAME") or "").strip()
    if name:
        return name
    if win32api is not None:
        try:
            return str(win32api.GetUserName()).strip()
        except Exception:  # noqa: BLE001 - 取得失敗は空文字扱いで呼出側が判断する
            return ""
    return ""
