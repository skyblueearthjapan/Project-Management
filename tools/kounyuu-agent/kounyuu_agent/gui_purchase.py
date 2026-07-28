"""購買モード (復路): 未対応一覧から手配結果を返す。

紙の手配状況資料を各設計部員へ手渡しで配って回っていた運用を置き換える。

不変条件:
  - 一覧の並び順は **サーバが決める** (工番未定が先頭)。ここでは並べ替えない。
    埋もれによる手配漏れ防止をクライアント実装に依存させないため。
  - スキャン PDF は読み取ってアップロードするだけ。元ファイルは触らない。
  - ダウンロードした部品リストは作業用フォルダへ **新規作成のみ**。削除しない。
"""

from __future__ import annotations

import os
import tempfile
import tkinter as tk
import uuid
from datetime import datetime
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any

from . import kouban, mailer
from .members import Member, split_by_flag

APP_TITLE = "購入部品追加依頼"
UNASSIGNED = "(工番未定)"

# 書き込み直後に一覧を取り直すと、まだ古い状態が返ることがある。
# DOVE は commit を FastAPI の dependency 終了時に行うため、レスポンスを受け取った
# 時点ではまだ確定していない瞬間がある (実測: 0.3 秒後には確定済み)。
# 待たずに reload すると「完了したのに未対応のまま」に見えて混乱するので、
# 書き込み後の再読込だけ少し遅らせる。
RELOAD_DELAY_MS = 900


class PurchaseFrame(ttk.Frame):
    """購買担当モードの画面。"""

    def __init__(self, master: tk.Misc, app: Any) -> None:
        super().__init__(master, padding=10)
        self.app = app
        self.me: Member = app.me
        self.rows: list[dict[str, Any]] = []
        self._pending: tuple[int, dict[str, Any], str] | None = None

        self.var_status = tk.StringVar(value=f"{self.me['name']} さんとして操作します")
        self._build()
        self.reload()

    # ------------------------------------------------------------------
    def _build(self) -> None:
        self.rowconfigure(1, weight=1)
        self.columnconfigure(0, weight=1)

        top = ttk.Frame(self)
        top.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        ttk.Label(top, text="未対応の購入部品追加依頼", font=("", 10, "bold")).pack(side="left")
        ttk.Button(top, text="再読み込み", command=self.reload).pack(side="right")

        cols = ("job", "branch", "requester", "file", "requested", "status")
        self.tree = ttk.Treeview(self, columns=cols, show="headings", selectmode="browse")
        for col, text, width in (
            ("job", "工番", 110),
            ("branch", "枝番", 80),
            ("requester", "依頼者", 90),
            ("file", "部品リスト", 220),
            ("requested", "依頼日時", 130),
            ("status", "状態", 80),
        ):
            self.tree.heading(col, text=text)
            self.tree.column(col, width=width, anchor="w")
        self.tree.grid(row=1, column=0, sticky="nsew")
        # 工番未定は視認性を上げる (埋もれると手配漏れになる)。
        self.tree.tag_configure("unassigned", background="#fef3c7")

        btns = ttk.Frame(self)
        btns.grid(row=2, column=0, sticky="ew", pady=(8, 0))
        ttk.Button(btns, text="部品リストを開く", command=self._open_excel).pack(side="left")
        ttk.Button(btns, text="工番を紐づける", command=self._assign_job).pack(side="left", padx=6)
        ttk.Button(btns, text="手配結果を返信 → 完了", command=self._reply).pack(side="left")
        self.btn_retry = ttk.Button(
            btns, text="登録だけ再試行", command=self._retry_register, state="disabled"
        )
        self.btn_retry.pack(side="left", padx=6)

        ttk.Label(self, textvariable=self.var_status, foreground="#334155").grid(
            row=3, column=0, sticky="w", pady=(8, 0)
        )

    # ------------------------------------------------------------------
    def reload(self) -> None:
        try:
            self.rows = self.app.dove.list_requests("open")
        except Exception as e:  # noqa: BLE001
            messagebox.showerror(APP_TITLE, f"一覧の取得に失敗しました:\n{e}")
            return
        for item in self.tree.get_children():
            self.tree.delete(item)
        for r in self.rows:
            unassigned = r.get("job_id") is None
            self.tree.insert(
                "",
                "end",
                values=(
                    r.get("job_id") or UNASSIGNED,
                    r.get("branch_no") or "",
                    r.get("requester_name") or "",
                    r.get("request_file_original_name") or "",
                    _fmt(r.get("requested_at")),
                    r.get("status") or "",
                ),
                tags=("unassigned",) if unassigned else (),
            )
        self.var_status.set(f"未対応 {len(self.rows)} 件")

    def _selected(self) -> dict[str, Any] | None:
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo(APP_TITLE, "一覧から依頼を選択してください。")
            return None
        return self.rows[self.tree.index(sel[0])]

    # ------------------------------------------------------------------
    def _open_excel(self) -> None:
        row = self._selected()
        if row is None:
            return
        name = row.get("request_file_original_name") or f"parts-{row['id']}.xlsx"
        # 依頼ごとにフォルダを分け、同名ファイルでも取り違えないようにする。
        work_dir = os.path.join(tempfile.gettempdir(), "kounyuu-agent", str(row["id"]))
        os.makedirs(work_dir, exist_ok=True)
        save_path = os.path.join(work_dir, name)
        try:
            if not os.path.isfile(save_path):
                # 既存があれば取得し直さない (上書きしない = CLAUDE.md §2.2)。
                self.app.dove.download_request_file(int(row["id"]), save_path)
            os.startfile(save_path)  # noqa: S606 - Windows で既定アプリを開く
        except Exception as e:  # noqa: BLE001
            messagebox.showerror(APP_TITLE, f"部品リストを開けませんでした:\n{e}")
            return
        self.var_status.set(f"部品リストを開きました: {name}")

    def _assign_job(self) -> None:
        """工番未定の依頼に、後から工番を紐づける (要件 D-06)。"""
        row = self._selected()
        if row is None:
            return
        current = row.get("job_id") or ""
        raw = simpledialog.askstring(
            APP_TITLE,
            "紐づける工番を入力してください (例: LW25146 / 25146-1 / TS26007)",
            initialvalue=current,
            parent=self,
        )
        if not raw:
            return
        job_id = kouban.to_job_id(raw)
        if job_id is None:
            messagebox.showwarning(APP_TITLE, f"工番を読み取れませんでした: {raw}")
            return
        info = self.app.lookup_master(raw) or {}
        try:
            self.app.dove.patch_request(
                int(row["id"]),
                {
                    "job_id": job_id,
                    "branch_no": kouban.branch_no(raw),
                    "title": info.get("title"),
                    "customer": info.get("customer"),
                },
            )
        except Exception as e:  # noqa: BLE001
            messagebox.showerror(APP_TITLE, f"工番の紐づけに失敗しました:\n{e}")
            return
        self.var_status.set(f"依頼#{row['id']} に工番 {job_id} を紐づけました")
        self.after(RELOAD_DELAY_MS, self.reload)

    # ------------------------------------------------------------------
    def _reply(self) -> None:
        row = self._selected()
        if row is None:
            return
        pdf = filedialog.askopenfilename(
            title="手配結果のスキャン PDF を選択",
            filetypes=[("PDF", "*.pdf"), ("すべてのファイル", "*.*")],
        )
        if not pdf:
            return
        if not os.path.isfile(pdf):
            messagebox.showerror(APP_TITLE, f"ファイルが見つかりません:\n{pdf}")
            return

        job_label = row.get("job_id") or UNASSIGNED
        requester = _requester_member(self.app.members, row) or Member(
            id=None,
            name=str(row.get("requester_name") or ""),
            account=str(row.get("requester_account") or ""),
            email=str(row.get("requester_email") or ""),
            role="設計",
            request_cc="×",
            reply_cc="×",
        )
        _extra_to, cc_list = split_by_flag(self.app.members, "reply_cc")
        cc_list = [m for m in cc_list if m["email"] != requester["email"]]

        subject = mailer.build_reply_subject(job_label)
        body = mailer.build_reply_body(self.me["name"], job_label, requester["name"], None)

        if not messagebox.askokcancel(
            APP_TITLE,
            "以下の内容で返信します。\n\n"
            f"宛先: {requester['name']}\n"
            f"件名: {subject}\n"
            f"添付: {os.path.basename(pdf)}",
        ):
            return

        fields: dict[str, Any] = {
            "client_reply_id": str(uuid.uuid4()),
            "replied_by_account": self.me["account"],
            "replied_by_name": self.me["name"],
            "set_status": "answered",
            "replied_at": datetime.now().astimezone().isoformat(),
        }

        try:
            mailer.send_outlook_mail(
                self.me["email"],
                [requester],
                cc_list,
                subject,
                body,
                attachments=[pdf],
                send_immediately=True,
            )
        except Exception as e:  # noqa: BLE001 - 送信失敗なら登録もしない
            messagebox.showerror(APP_TITLE, f"メールの送信に失敗しました:\n{e}")
            return

        self._pending = (int(row["id"]), fields, pdf)
        self._register(first=True)

    def _register(self, *, first: bool) -> None:
        if self._pending is None:
            return
        request_id, fields, pdf = self._pending
        try:
            self.app.dove.add_reply(request_id, fields, pdf, os.path.basename(pdf))
        except Exception as e:  # noqa: BLE001
            self.btn_retry.configure(state="normal")
            self.var_status.set("メールは送信済み。DOVE登録に失敗 → [登録だけ再試行]")
            messagebox.showerror(
                APP_TITLE,
                "メールは送信できましたが、DOVE への登録に失敗しました。\n"
                "［登録だけ再試行］でメールを再送せずに補完できます。\n\n"
                f"詳細:\n{e}",
            )
            return

        self._pending = None
        self.btn_retry.configure(state="disabled")
        self.var_status.set(f"依頼#{request_id} を完了にしました")
        if first:
            messagebox.showinfo(
                APP_TITLE, f"手配結果を登録し、依頼#{request_id} を完了にしました。"
            )
        self.after(RELOAD_DELAY_MS, self.reload)

    def _retry_register(self) -> None:
        """メールを再送せず、保持済みの内容で登録だけ再試行する (冪等)。"""
        if self._pending is None:
            messagebox.showinfo(APP_TITLE, "再試行できる保留中の登録はありません。")
            return
        self._register(first=True)


def _requester_member(members: list[Member], row: dict[str, Any]) -> Member | None:
    account = str(row.get("requester_account") or "").strip().lower()
    for m in members:
        if m["account"].strip().lower() == account:
            return m
    return None


def _fmt(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return iso
