"""エントリポイント: 設定読込 → 送付先一覧読込 → GUI 起動。

config.toml は EXE と同じフォルダ。無ければ config.example.toml の既定値を使う。
"""

from __future__ import annotations

import os
import tkinter as tk
import tomllib
from tkinter import messagebox
from typing import Any

from .gui import App
from .mailer import resource_base_dir
from .members import load_members

APP_TITLE = "出図のお知らせ × DOVE連携 メール送信"

DEFAULT_CONFIG: dict[str, Any] = {
    "dove_base_url": "http://dove/api/v1",
    # TS工番のとき DOVE に加えて登録する TSC出張図面管理 (TTD) のAPIベースURL。
    "ttd_base_url": "http://ttd/api/v1",
    "fileserver_unc_root": "\\\\lineworks-sv\\Data",
    "member_xlsx": "送付先一覧.xlsx",
    "request_timeout_sec": 15,
    # 工番マスタ Excel（社内共有・ファイルサーバ固定パス。EXE フォルダには置かない）。
    # 日程表A を優先し、無い工番は新一覧で補完する（元アプリと同方式）。
    "master_nittei_path": "\\\\lineworks-sv\\Data\\総務部\\社内\\日程表\\日程表A.xlsx",
    "master_shin_ichiran_path": "\\\\lineworks-sv\\Data\\総務部\\社内\\日程表\\新一覧.xlsm",
}


def load_config(base_dir: str) -> dict[str, Any]:
    """config.toml を読み、欠落キーは既定値で補完する。"""
    cfg = dict(DEFAULT_CONFIG)
    path = os.path.join(base_dir, "config.toml")
    if os.path.isfile(path):
        with open(path, "rb") as f:
            loaded = tomllib.load(f)
        cfg.update({k: v for k, v in loaded.items() if v is not None})
    return cfg


def _error_box(message: str) -> None:
    root = tk.Tk()
    root.withdraw()
    messagebox.showerror(APP_TITLE, message)
    root.destroy()


def main() -> None:
    base = resource_base_dir()
    config = load_config(base)

    xlsx_name = str(config.get("member_xlsx") or "送付先一覧.xlsx")
    xlsx_path = os.path.join(base, xlsx_name)

    if not os.path.isfile(xlsx_path):
        _error_box(
            f"送付先一覧が見つかりません。\n\n"
            f"このEXEと同じフォルダに『{xlsx_name}』を置いてください。\n\n"
            f"検索場所:\n{base}"
        )
        return

    try:
        members = load_members(xlsx_path)
    except Exception as e:  # noqa: BLE001 - 起動失敗はダイアログで通知
        _error_box(f"Excel読み込みエラー:\n{e}")
        return

    if not members:
        _error_box("送付先一覧にデータがありません")
        return

    app = App(members, config)
    app.mainloop()


if __name__ == "__main__":
    main()
