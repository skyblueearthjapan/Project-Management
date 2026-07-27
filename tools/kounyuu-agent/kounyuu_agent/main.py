"""エントリポイント: 設定読込 → Windows アカウント判定 → 役割に応じた画面を起動。

配布形態は **EXE 1 本**。設計部員用・購買用に分けず、Windows アカウントを
送付先マスタと突き合わせて画面を切り替える。
理由 (docs/REQUIREMENTS_購入部品追加依頼.md §5.1):
  1. EXE が 2 本になるとリビルド漏れのリスクが倍になる (出図EXE で実際に発生済)
  2. 役割変更が Excel 1 列で済む (代理・増員・異動に再配布不要で追随)
  3. 認証なし環境では 2 本に分けても権限分離にならず、運用コストだけ増える
"""

from __future__ import annotations

import os
import tkinter as tk
import tomllib
from tkinter import messagebox, ttk
from typing import Any

from .account import get_windows_account
from .dove_client import DoveClient
from .kouban import master_key
from .mailer import resource_base_dir
from .master import load_master
from .master import lookup as lookup_master
from .members import ROLE_PURCHASE, Member, find_by_account, load_members

APP_TITLE = "購入部品追加依頼"

DEFAULT_CONFIG: dict[str, Any] = {
    "dove_base_url": "http://dove/api/v1",
    # 送付先マスタはファイルサーバ上に 1 つだけ置く (EXE と一緒に配布しない)。
    "master_xlsx_path": r"\\lineworks-sv\Data\郵便局\購入部品依頼\購入部品依頼_送付先マスタ.xlsx",
    # 工番マスタ (共有)。工番 → 納入先/品名 の解決に使う。
    "master_nittei_path": r"\\lineworks-sv\Data\総務部\社内\日程表\日程表A.xlsx",
    "master_shin_ichiran_path": r"\\lineworks-sv\Data\総務部\社内\日程表\新一覧.xlsm",
    # アップロードを伴うため出図EXE (15秒) より長めに取る。
    "request_timeout_sec": 30,
}


def load_config(base_dir: str) -> dict[str, Any]:
    """config.toml を読み、欠落キーは既定値で補完する。

    **BOM 付き UTF-8 を許容する**: Windows のメモ帳等で編集すると先頭に BOM が
    付くことがあり、`tomllib.load()` (バイナリ読み) はこれを解釈できず
    `TOMLDecodeError: Invalid statement (at line 1, column 1)` で落ちる。
    実運用で確実に踏むため、`utf-8-sig` でテキストとして読んでから解析する。
    """
    cfg = dict(DEFAULT_CONFIG)
    path = os.path.join(base_dir, "config.toml")
    if os.path.isfile(path):
        with open(path, encoding="utf-8-sig") as f:
            loaded = tomllib.loads(f.read())
        cfg.update({k: v for k, v in loaded.items() if v is not None})
    return cfg


def _error_box(message: str) -> None:
    root = tk.Tk()
    root.withdraw()
    messagebox.showerror(APP_TITLE, message)
    root.destroy()


class App(tk.Tk):
    """役割に応じた画面を 1 つだけ載せるシェル。"""

    def __init__(self, members: list[Member], me: Member, config: dict[str, Any]) -> None:
        super().__init__()
        self.members = members
        self.me = me
        self.config_data = config
        self.dove = DoveClient(
            str(config.get("dove_base_url") or "http://dove/api/v1"),
            timeout=float(config.get("request_timeout_sec") or 30),
        )
        self._master_data: dict[str, dict[str, str]] | None = None

        mode = "購買" if me["role"] == ROLE_PURCHASE else "設計"
        self.title(f"{APP_TITLE} — {me['name']} さん ({mode}モード)")
        self.geometry("900x560" if me["role"] == ROLE_PURCHASE else "720x480")

        if me["role"] == ROLE_PURCHASE:
            from .gui_purchase import PurchaseFrame

            frame: ttk.Frame = PurchaseFrame(self, self)
        else:
            from .gui_request import RequestFrame

            frame = RequestFrame(self, self)
        frame.pack(fill="both", expand=True)

    def lookup_master(self, job_no_input: str) -> dict[str, Any] | None:
        """工番マスタ Excel から納入先・品名を引く (枝番キーで照合)。

        マスタは工番を枝番付き (`25146-1`) で保持しており、親工番 (`LW25146`) では
        引けない。読込は 1 回だけ行い以降はメモリ上のキャッシュを使う。
        Excel は読むだけ (書込・削除・改名は一切しない)。
        """
        key = master_key(job_no_input)
        if not key:
            return None
        if self._master_data is None:
            try:
                self._master_data = load_master(
                    str(self.config_data.get("master_nittei_path") or ""),
                    str(self.config_data.get("master_shin_ichiran_path") or ""),
                )
            except Exception:  # noqa: BLE001 - 読めなくても依頼自体は続行できる
                self._master_data = {}
        return lookup_master(self._master_data, key)


def main() -> None:
    base = resource_base_dir()
    try:
        config = load_config(base)
    except Exception as e:  # noqa: BLE001 - 設定不備は原因を示して終了する
        # ここで握らないと PyInstaller の "Unhandled exception" ダイアログになり、
        # 利用者には何が悪いのか分からない。
        _error_box(
            "config.toml を読み込めませんでした。\n\n"
            f"場所:\n{os.path.join(base, 'config.toml')}\n\n"
            f"エラー:\n{e}"
        )
        return

    xlsx = str(config.get("master_xlsx_path") or "")
    if not os.path.isfile(xlsx):
        _error_box(
            "送付先マスタが見つかりません。\n\n"
            f"参照先:\n{xlsx}\n\n"
            "config.toml の master_xlsx_path を確認してください。"
        )
        return

    try:
        members = load_members(xlsx)
    except Exception as e:  # noqa: BLE001 - 起動失敗はダイアログで通知
        _error_box(f"送付先マスタの読み込みに失敗しました:\n{e}")
        return
    if not members:
        _error_box("送付先マスタにデータがありません。")
        return

    account = get_windows_account()
    me = find_by_account(members, account)
    if me is None:
        # 誤送信を防ぐため、本人が特定できない場合は起動させない。
        _error_box(
            f"あなたの Windows アカウント「{account}」が\n送付先マスタに登録されていません。\n\n"
            "マスタの「Windowsアカウント」列に追加してもらってください。"
        )
        return
    if not me["email"]:
        _error_box(f"{me['name']} さんのメールアドレスがマスタに登録されていません。")
        return

    App(members, me, config).mainloop()


if __name__ == "__main__":
    main()
