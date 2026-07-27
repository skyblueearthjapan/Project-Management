"""設計部員モード (往路): 部品リストを選んで購買へ依頼する。

不変条件:
  - 部品リスト Excel は **読み取ってアップロードするだけ**。
    依頼者 PC 上の元ファイルを移動・削除・改名しない (CLAUDE.md §2.1)。
  - `client_request_id` は **送信前に 1 回だけ**生成する。これにより
    「メールは送れたが登録に失敗」した場合でも、メールを再送せず登録だけ
    冪等に補完できる。
"""

from __future__ import annotations

import os
import tkinter as tk
import uuid
from datetime import datetime
from tkinter import filedialog, messagebox, scrolledtext, ttk
from typing import Any

from . import kouban, mailer
from .members import Member, purchasers, split_by_flag

APP_TITLE = "購入部品追加依頼"


class RequestFrame(ttk.Frame):
    """設計部員モードの画面。"""

    def __init__(self, master: tk.Misc, app: Any) -> None:
        super().__init__(master, padding=10)
        self.app = app
        self.me: Member = app.me
        self.excel_path: str = ""
        # 送信済みだが未登録の状態を保持し、[再試行] で登録だけを補完する。
        self._pending: dict[str, Any] | None = None

        self.var_job = tk.StringVar()
        self.var_unassigned = tk.BooleanVar(value=False)
        self.var_excel = tk.StringVar(value="(未選択)")
        self.var_status = tk.StringVar(value=f"{self.me['name']} さんとして依頼します")
        self.var_master = tk.StringVar(value="")

        self._build()

    # ------------------------------------------------------------------
    def _build(self) -> None:
        self.columnconfigure(1, weight=1)

        ttk.Label(self, text="工番").grid(row=0, column=0, sticky="w", pady=3)
        job_row = ttk.Frame(self)
        job_row.grid(row=0, column=1, sticky="ew", pady=3)
        job_row.columnconfigure(0, weight=1)
        self.ent_job = ttk.Entry(job_row, textvariable=self.var_job)
        self.ent_job.grid(row=0, column=0, sticky="ew")
        ttk.Button(job_row, text="工番を検索", command=self._search_master).grid(
            row=0, column=1, padx=(6, 0)
        )
        ttk.Checkbutton(
            job_row,
            text="工番未定 (先行手配)",
            variable=self.var_unassigned,
            command=self._toggle_unassigned,
        ).grid(row=0, column=2, padx=(6, 0))

        ttk.Label(self, textvariable=self.var_master, foreground="#0e7490").grid(
            row=1, column=1, sticky="w"
        )

        ttk.Label(self, text="部品リスト").grid(row=2, column=0, sticky="w", pady=3)
        excel_row = ttk.Frame(self)
        excel_row.grid(row=2, column=1, sticky="ew", pady=3)
        excel_row.columnconfigure(0, weight=1)
        ttk.Label(excel_row, textvariable=self.var_excel).grid(row=0, column=0, sticky="w")
        ttk.Button(excel_row, text="Excel を選択", command=self._pick_excel).grid(
            row=0, column=1, padx=(6, 0)
        )

        ttk.Label(self, text="備考").grid(row=3, column=0, sticky="nw", pady=3)
        self.txt_note = scrolledtext.ScrolledText(self, height=5, wrap="word")
        self.txt_note.grid(row=3, column=1, sticky="ew", pady=3)

        ttk.Label(self, text="宛先").grid(row=4, column=0, sticky="nw", pady=3)
        self.lbl_recipients = ttk.Label(self, text="", justify="left")
        self.lbl_recipients.grid(row=4, column=1, sticky="w", pady=3)
        self._refresh_recipients()

        btns = ttk.Frame(self)
        btns.grid(row=5, column=0, columnspan=2, sticky="ew", pady=(10, 0))
        ttk.Button(btns, text="確認して送信 → 登録", command=lambda: self._submit(send=True)).pack(
            side="left"
        )
        ttk.Button(btns, text="下書きを作成 → 登録", command=lambda: self._submit(send=False)).pack(
            side="left", padx=6
        )
        self.btn_retry = ttk.Button(
            btns, text="登録だけ再試行", command=self._retry_register, state="disabled"
        )
        self.btn_retry.pack(side="left")

        ttk.Label(self, textvariable=self.var_status, foreground="#334155").grid(
            row=6, column=0, columnspan=2, sticky="w", pady=(8, 0)
        )

    # ------------------------------------------------------------------
    def _toggle_unassigned(self) -> None:
        state = "disabled" if self.var_unassigned.get() else "normal"
        self.ent_job.configure(state=state)
        if self.var_unassigned.get():
            self.var_master.set("工番未定として登録します (後から紐づけられます)")
        else:
            self.var_master.set("")

    def _refresh_recipients(self) -> None:
        to_list, cc_list = self._recipients()
        text = "TO: " + ("、".join(m["name"] for m in to_list) or "(なし)")
        if cc_list:
            text += "\nCC: " + "、".join(m["name"] for m in cc_list)
        self.lbl_recipients.configure(text=text)

    def _recipients(self) -> tuple[list[Member], list[Member]]:
        """TO = 購買担当 + 「依頼CC」列が ○ の人、CC = 同列が CC の人。

        購買担当が増員・交代しても Excel の役割列だけで追随できるよう、
        TO は名前ではなく役割から引く。重複はメールアドレスで除く。
        """
        extra_to, cc_candidates = split_by_flag(self.app.members, "request_cc")
        to_list: list[Member] = []
        seen: set[str] = set()
        for m in purchasers(self.app.members) + extra_to:
            if m["email"] and m["email"] not in seen:
                seen.add(m["email"])
                to_list.append(m)
        cc_list = [m for m in cc_candidates if m["email"] and m["email"] not in seen]
        return to_list, cc_list

    def _search_master(self) -> None:
        q = self.var_job.get().strip()
        if not q:
            messagebox.showinfo(APP_TITLE, "工番の一部を入力してから検索してください。")
            return
        try:
            items = self.app.dove.search_master(q)
        except Exception as e:  # noqa: BLE001 - 通信失敗はダイアログで通知
            messagebox.showerror(APP_TITLE, f"工番マスタの検索に失敗しました:\n{e}")
            return
        if not items:
            messagebox.showinfo(APP_TITLE, "該当する工番が見つかりませんでした。")
            return
        picked = _pick_from_list(self, items)
        if picked:
            self.var_job.set(str(picked.get("job_no") or ""))
            self._resolve_master()

    def _resolve_master(self) -> None:
        """選択した工番の納入先・製品名を解決して表示する。

        マスタは枝番付きキーで保持しているため、照合は枝番キーで行う
        (親工番では引けない)。
        """
        info = self.app.lookup_master(self.var_job.get())
        if info:
            self.var_master.set(
                f"{info.get('customer') or ''} / {info.get('title') or ''}".strip(" /")
            )
        else:
            self.var_master.set("(マスタに該当なし。工番はそのまま登録します)")

    def _pick_excel(self) -> None:
        path = filedialog.askopenfilename(
            title="追加依頼する部品リスト (Excel) を選択",
            filetypes=[("Excel", "*.xlsx *.xlsm *.xls"), ("すべてのファイル", "*.*")],
        )
        if not path:
            return
        self.excel_path = path
        self.var_excel.set(os.path.basename(path))

    # ------------------------------------------------------------------
    def _submit(self, *, send: bool) -> None:
        if not self.excel_path:
            messagebox.showwarning(APP_TITLE, "部品リストの Excel を選択してください。")
            return
        if not os.path.isfile(self.excel_path):
            messagebox.showerror(APP_TITLE, f"ファイルが見つかりません:\n{self.excel_path}")
            return

        unassigned = self.var_unassigned.get()
        raw = self.var_job.get().strip()
        if not unassigned and not raw:
            messagebox.showwarning(
                APP_TITLE, "工番を入力するか、「工番未定」にチェックを入れてください。"
            )
            return

        job_id = None if unassigned else kouban.to_job_id(raw)
        if not unassigned and job_id is None:
            messagebox.showwarning(
                APP_TITLE, f"工番を読み取れませんでした: {raw}\n例) LW25146 / 25146-1 / TS26007"
            )
            return

        info = self.app.lookup_master(raw) if not unassigned else None
        job_label = "(工番未定)" if unassigned else raw
        to_list, cc_list = self._recipients()
        if send and not to_list:
            messagebox.showwarning(
                APP_TITLE, "宛先 (購買担当) が0名です。マスタを確認してください。"
            )
            return

        note = self.txt_note.get("1.0", "end").strip() or None
        subject = mailer.build_request_subject(job_label)
        body = mailer.build_request_body(
            self.me["name"],
            job_label,
            (info or {}).get("customer"),
            (info or {}).get("title"),
            note,
        )

        if send:
            ok = messagebox.askokcancel(
                APP_TITLE,
                "以下の内容で送信します。\n\n"
                f"宛先: {'、'.join(m['name'] for m in to_list)}\n"
                f"件名: {subject}\n"
                f"添付: {os.path.basename(self.excel_path)}",
            )
            if not ok:
                return

        # 冪等キーは送信前に 1 回だけ確定させる (再試行しても重複しない)。
        fields: dict[str, Any] = {
            "client_request_id": str(uuid.uuid4()),
            "requester_account": self.me["account"],
            "requester_name": self.me["name"],
            "requester_email": self.me["email"],
            "job_id": job_id,
            "job_no_input": None if unassigned else raw,
            "branch_no": None if unassigned else kouban.branch_no(raw),
            "title": (info or {}).get("title"),
            "customer": (info or {}).get("customer"),
            "subject": subject,
            "note": note,
            "requested_at": datetime.now().astimezone().isoformat(),
            "mail_to": _recipients_json(to_list),
            "mail_cc": _recipients_json(cc_list),
        }

        try:
            mailer.send_outlook_mail(
                self.me["email"],
                to_list,
                cc_list,
                subject,
                body,
                attachments=[self.excel_path],
                send_immediately=send,
            )
        except Exception as e:  # noqa: BLE001 - 送信失敗は登録もしない
            messagebox.showerror(APP_TITLE, f"メールの作成に失敗しました:\n{e}")
            return

        self._pending = fields
        self._register(first=True, sent=send)

    def _register(self, *, first: bool, sent: bool) -> None:
        fields = self._pending
        if fields is None:
            return
        try:
            out = self.app.dove.create_request(
                fields, self.excel_path, os.path.basename(self.excel_path)
            )
        except Exception as e:  # noqa: BLE001 - 登録失敗は再試行導線を出す
            self.btn_retry.configure(state="normal")
            action = "送信" if sent else "下書き作成"
            self.var_status.set(f"メールは{action}済み。DOVE登録に失敗 → [登録だけ再試行]")
            messagebox.showerror(
                APP_TITLE,
                f"メールは{action}できましたが、DOVE への登録に失敗しました。\n"
                "［登録だけ再試行］でメールを再送せずに補完できます。\n\n"
                f"詳細:\n{e}",
            )
            return

        self._pending = None
        self.btn_retry.configure(state="disabled")
        job_txt = out.get("job_id") or "(工番未定)"
        dup = "" if out.get("created") else "（既に登録済みでした）"
        self.var_status.set(f"登録OK{dup} 依頼#{out.get('id')} 工番{job_txt}")
        if first:
            messagebox.showinfo(
                APP_TITLE,
                f"依頼を登録しました{dup}。\n\n工番: {job_txt}\n依頼番号: {out.get('id')}",
            )

    def _retry_register(self) -> None:
        """メールを再送せず、保持済みの内容で登録だけ再試行する (冪等)。"""
        if self._pending is None:
            messagebox.showinfo(APP_TITLE, "再試行できる保留中の登録はありません。")
            return
        self._register(first=True, sent=True)


def _recipients_json(members: list[Member]) -> str:
    import json

    return json.dumps(
        [{"name": m["name"], "email": m["email"]} for m in members], ensure_ascii=False
    )


def _pick_from_list(parent: tk.Misc, items: list[dict[str, Any]]) -> dict[str, Any] | None:
    """工番候補を選ばせる簡易ダイアログ。"""
    dlg = tk.Toplevel(parent)
    dlg.title("工番を選択")
    dlg.geometry("640x360")
    dlg.transient(parent.winfo_toplevel())
    dlg.grab_set()

    tree = ttk.Treeview(dlg, columns=("no", "title", "customer"), show="headings")
    for col, text, width in (
        ("no", "工番", 120),
        ("title", "品名", 300),
        ("customer", "納入先", 180),
    ):
        tree.heading(col, text=text)
        tree.column(col, width=width, anchor="w")
    tree.pack(fill="both", expand=True, padx=8, pady=8)
    for it in items:
        tree.insert(
            "", "end", values=(it.get("job_no"), it.get("title") or "", it.get("customer") or "")
        )

    chosen: dict[str, Any] = {}

    def _ok() -> None:
        sel = tree.selection()
        if sel:
            idx = tree.index(sel[0])
            chosen.update(items[idx])
        dlg.destroy()

    ttk.Button(dlg, text="決定", command=_ok).pack(pady=(0, 8))
    tree.bind("<Double-1>", lambda _e: _ok())
    parent.wait_window(dlg)
    return chosen or None
