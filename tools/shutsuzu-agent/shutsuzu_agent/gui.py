"""Tkinter GUI: 役割選択 → 軸の動的追加 → プレビュー → 送信 → DOVE登録。

出図のお知らせ（LW/TS）は「1工番=1Job・複数軸」を 1 回の送信でまとめて扱う。
- 各軸: 軸名（手入力）/ 出図図面PDF 1枚（本文UNCリンク）/ DXFフォルダ（任意）。
- 工番別指示書PDF は工番に 1 つ（添付）。
- 送信成功時のみ DOVE へ パス参照登録（コピー/移動/削除/上書き/rename なし）。
工番別指示書（毎週末報告分）は現行どおりメール送信のみ（DOVE連携なし）。
"""

from __future__ import annotations

import datetime
import os
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk
from typing import Any

from . import mailer
from .dove_client import DoveClient
from .kouban import (
    extract_kouban_from_filename,
    extract_master_key_from_filename,
    kubun_for_role,
    to_job_id,
)
from .mailer import SENDER
from .master import load_master
from .master import lookup as lookup_master
from .members import (
    ROLE_LW,
    ROLE_SHIJI,
    ROLE_TS,
    get_recipients,
    get_recipients_label,
)
from .members import Member as MemberT
from .paths import normalize_unc, to_fileserver_relative

APP_TITLE = "出図のお知らせ × DOVE連携 メール送信"

# 工番別指示書 ファイルサーバー初期フォルダ（UNC・参照EXE :34-37）
SHIJI_SERVER_BASE = os.path.join(os.sep * 2 + "lineworks-sv", "Data", "部署間共通", "工番別指示書")


class ConfirmDialog(tk.Toplevel):
    """送信内容の最終確認ダイアログ（参照EXE :383-443）。"""

    def __init__(
        self,
        parent: tk.Misc,
        role: str,
        to_list: list[MemberT],
        cc_list: list[MemberT],
        subject: str,
        body: str,
        attachments: list[str] | None = None,
    ) -> None:
        super().__init__(parent)
        self.title("送信内容の最終確認")
        self.geometry("800x680")
        self.transient(parent)
        self.grab_set()
        self.result = False

        pad = {"padx": 10, "pady": 4}
        frm = ttk.Frame(self)
        frm.pack(fill="both", expand=True, padx=10, pady=10)

        def add_row(label: str, value: str) -> None:
            row = ttk.Frame(frm)
            row.pack(fill="x", **pad)
            ttk.Label(row, text=label, width=12, anchor="w", foreground="#555").pack(side="left")
            ttk.Label(row, text=value, anchor="w", wraplength=680, justify="left").pack(
                side="left", fill="x", expand=True
            )

        add_row("役割:", role)
        add_row("送信元:", f"{SENDER['name']} <{SENDER['email']}>")
        add_row("宛先 TO:", "; ".join(m["email"] for m in to_list))
        add_row("CC:", "; ".join(m["email"] for m in cc_list) or "(なし)")
        add_row("件名:", subject)

        if attachments:
            att_text = "\n".join(
                f"{i + 1:02d}. {os.path.basename(p)}" for i, p in enumerate(attachments)
            )
            add_row(f"添付({len(attachments)}件):", att_text)

        ttk.Label(frm, text="本文プレビュー:", foreground="#555").pack(
            anchor="w", padx=10, pady=(10, 2)
        )
        txt = scrolledtext.ScrolledText(frm, height=14, wrap="word")
        txt.pack(fill="both", expand=True, padx=10)
        txt.insert("1.0", body)
        txt.configure(state="disabled")

        btns = ttk.Frame(self)
        btns.pack(fill="x", padx=10, pady=10)
        ttk.Button(btns, text="キャンセル", command=self._on_cancel).pack(side="right", padx=6)
        ttk.Button(btns, text="この内容で送信", command=self._on_ok).pack(side="right")

        self.bind("<Escape>", lambda _e: self._on_cancel())
        self.protocol("WM_DELETE_WINDOW", self._on_cancel)

    def _on_ok(self) -> None:
        self.result = True
        self.destroy()

    def _on_cancel(self) -> None:
        self.result = False
        self.destroy()


class App(tk.Tk):
    """メインウィンドウ。"""

    def __init__(self, members: list[MemberT], config: dict[str, Any]) -> None:
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("860x760")

        self.members = members
        self.config_data = config
        self.fileserver_root = str(config.get("fileserver_unc_root") or "\\\\lineworks-sv\\Data")
        self.dove = DoveClient(
            str(config.get("dove_base_url") or "http://dove/api/v1"),
            float(config.get("request_timeout_sec") or 15),
        )

        self.current_role: str | None = None
        self.axes: list[dict[str, Any]] = []
        self.instruction_unc = ""
        self.shiji_unc_path = ""
        self.master_cache: dict[str, Any] | None = None
        # 工番マスタ Excel（新一覧/日程表A）の遅延ロードキャッシュ。
        self._master_data: dict[str, dict[str, str]] | None = None
        # 送信前に1回だけ構築する register payload。sent_at を固定し、
        # DOVE登録失敗時に「メール再送なし」で再試行するために保持する。
        self._pending_payload: dict[str, Any] | None = None

        self._build_role_select()

    # ------------------------------------------------------------------
    # 役割選択
    # ------------------------------------------------------------------
    def _build_role_select(self) -> None:
        self.frm_main = ttk.Frame(self)
        self.frm_main.pack(fill="both", expand=True)

        ttk.Label(self.frm_main, text="メール種別を選択してください", font=("", 14)).pack(
            pady=(40, 30)
        )

        frm_btns = ttk.Frame(self.frm_main)
        frm_btns.pack()
        style = {"width": 38}
        ttk.Button(
            frm_btns,
            text="出図のお知らせ（LW工番）→ DOVE連携",
            command=lambda: self._select_role(ROLE_LW),
            **style,
        ).pack(pady=8)
        ttk.Button(
            frm_btns,
            text="出図のお知らせ（TS工番）→ DOVE連携",
            command=lambda: self._select_role(ROLE_TS),
            **style,
        ).pack(pady=8)
        ttk.Button(
            frm_btns,
            text="工番別指示書（毎週末報告分）※メールのみ",
            command=lambda: self._select_role(ROLE_SHIJI),
            **style,
        ).pack(pady=8)

        ttk.Label(
            self.frm_main,
            text=f"送付先一覧: {len(self.members)}名 登録済み",
            foreground="gray",
        ).pack(pady=(30, 0))

    def _select_role(self, role: str) -> None:
        self.current_role = role
        self.axes = []
        self.instruction_unc = ""
        self.shiji_unc_path = ""
        self.master_cache = None
        self.frm_main.destroy()
        if role == ROLE_SHIJI:
            self._build_shiji_ui()
        else:
            self._build_zuzu_ui(role)

    def _go_back(self) -> None:
        self.frm_main.destroy()
        self.current_role = None
        self.axes = []
        self.instruction_unc = ""
        self.shiji_unc_path = ""
        self._build_role_select()

    # ------------------------------------------------------------------
    # 出図のお知らせ UI（LW / TS）
    # ------------------------------------------------------------------
    def _build_zuzu_ui(self, role: str) -> None:
        self.frm_main = ttk.Frame(self)
        self.frm_main.pack(fill="both", expand=True)
        pad = {"padx": 12, "pady": 6}
        label = "LW工番" if role == ROLE_LW else "TS工番"

        ttk.Button(self.frm_main, text="← 戻る", command=self._go_back).pack(
            anchor="w", padx=10, pady=6
        )
        ttk.Label(self.frm_main, text=f"出図のお知らせ（{label}）", font=("", 13, "bold")).pack(
            pady=(4, 10)
        )

        # 1. 軸構成
        frm_axes_outer = ttk.LabelFrame(
            self.frm_main, text="1. 軸の構成（＋で軸を追加・軸名を入力）"
        )
        frm_axes_outer.pack(fill="both", expand=True, **pad)

        header = ttk.Frame(frm_axes_outer)
        header.pack(fill="x", padx=8, pady=(6, 0))
        ttk.Button(header, text="＋ 軸を追加", command=self._add_axis).pack(side="left")
        ttk.Label(
            header, text="（各軸: 軸名 / 出図PDF1枚 / DXFフォルダ任意）", foreground="gray"
        ).pack(side="left", padx=10)

        self.frm_axes = ttk.Frame(frm_axes_outer)
        self.frm_axes.pack(fill="both", expand=True, padx=8, pady=6)

        # 2. 工番別指示書PDF（Job単位・添付）
        frm_instr = ttk.LabelFrame(
            self.frm_main, text="2. 工番別指示書PDF（工番に1つ・メール添付）"
        )
        frm_instr.pack(fill="x", **pad)
        row = ttk.Frame(frm_instr)
        row.pack(fill="x", padx=10, pady=8)
        ttk.Button(row, text="指示書PDFを選択", command=self._select_instruction).pack(side="left")
        self.var_instruction = tk.StringVar(value="（未選択・任意）")
        ttk.Label(row, textvariable=self.var_instruction, wraplength=560).pack(side="left", padx=10)

        # 3. 宛先
        frm_dest = ttk.LabelFrame(self.frm_main, text="3. 宛先（自動振り分け）")
        frm_dest.pack(fill="x", **pad)
        to_text, cc_text, _to, _cc = get_recipients_label(self.members, role)
        ttk.Label(frm_dest, text=to_text).pack(anchor="w", padx=10, pady=4)
        ttk.Label(frm_dest, text=cc_text).pack(anchor="w", padx=10, pady=(0, 8))

        # 4. プレビュー
        frm_body = ttk.LabelFrame(self.frm_main, text="4. 本文プレビュー")
        frm_body.pack(fill="both", expand=True, **pad)
        ttk.Button(
            frm_body, text="プレビュー更新（工番情報をDOVEから取得）", command=self._refresh_preview
        ).pack(anchor="w", padx=10, pady=(8, 2))
        self.txt_preview = scrolledtext.ScrolledText(frm_body, height=10, wrap="word")
        self.txt_preview.pack(fill="both", expand=True, padx=10, pady=(0, 8))
        self._set_text(
            self.txt_preview, "（軸を追加し『プレビュー更新』を押すと本文が表示されます）"
        )

        # 送信
        frm_btn = ttk.Frame(self.frm_main)
        frm_btn.pack(fill="x", **pad)
        ttk.Button(
            frm_btn,
            text="下書き作成（Outlook表示・DOVE登録なし）",
            command=lambda: self._send_zuzu(False),
        ).pack(side="left", padx=10)
        ttk.Button(
            frm_btn, text="確認して送信 → DOVE登録", command=lambda: self._send_zuzu(True)
        ).pack(side="left", padx=10)

        self.var_status = tk.StringVar(value="軸を追加してください")
        ttk.Label(self.frm_main, textvariable=self.var_status, foreground="gray").pack(
            side="bottom", pady=6
        )

        self._add_axis()

    def _add_axis(self) -> None:
        idx = len(self.axes)
        frame = ttk.Frame(self.frm_axes, relief="groove", borderwidth=1)
        frame.pack(fill="x", pady=4)

        head = ttk.Frame(frame)
        head.pack(fill="x", padx=6, pady=(4, 0))
        title_var = tk.StringVar(value=f"軸 {idx + 1}")
        ttk.Label(head, textvariable=title_var, width=8).pack(side="left")
        ttk.Label(head, text="軸名:").pack(side="left")
        name_var = tk.StringVar()
        ttk.Entry(head, textvariable=name_var, width=24).pack(side="left", padx=6)
        ttk.Button(head, text="この軸を外す", command=lambda: self._remove_axis(frame)).pack(
            side="right"
        )

        pdf_row = ttk.Frame(frame)
        pdf_row.pack(fill="x", padx=6, pady=2)
        pdf_var = tk.StringVar(value="（出図PDF未選択）")
        ttk.Button(pdf_row, text="出図PDF", command=lambda: self._select_axis_pdf(frame)).pack(
            side="left"
        )
        ttk.Label(pdf_row, textvariable=pdf_var, wraplength=560, foreground="#333").pack(
            side="left", padx=8
        )

        dxf_row = ttk.Frame(frame)
        dxf_row.pack(fill="x", padx=6, pady=(2, 6))
        dxf_var = tk.StringVar(value="（DXFフォルダ未選択・任意）")
        ttk.Button(dxf_row, text="DXFフォルダ", command=lambda: self._select_axis_dxf(frame)).pack(
            side="left"
        )
        ttk.Label(dxf_row, textvariable=dxf_var, wraplength=560, foreground="#666").pack(
            side="left", padx=8
        )

        self.axes.append(
            {
                "frame": frame,
                "title_var": title_var,
                "name_var": name_var,
                "pdf_var": pdf_var,
                "dxf_var": dxf_var,
                "pdf_unc": "",
                "dxf_unc": "",
            }
        )

    def _remove_axis(self, frame: tk.Misc) -> None:
        for i, ax in enumerate(self.axes):
            if ax["frame"] is frame:
                ax["frame"].destroy()
                self.axes.pop(i)
                break
        self._renumber_axes()

    def _renumber_axes(self) -> None:
        for i, ax in enumerate(self.axes):
            ax["title_var"].set(f"軸 {i + 1}")

    def _select_axis_pdf(self, frame: tk.Misc) -> None:
        ax = self._axis_of(frame)
        if ax is None:
            return
        path = filedialog.askopenfilename(
            title="出図図面PDFを選択（ファイルサーバー）",
            filetypes=[("PDF", "*.pdf"), ("すべてのファイル", "*.*")],
        )
        if not path:
            return
        unc = normalize_unc(path)
        ax["pdf_unc"] = unc
        ax["pdf_var"].set(unc)

    def _select_axis_dxf(self, frame: tk.Misc) -> None:
        ax = self._axis_of(frame)
        if ax is None:
            return
        path = filedialog.askdirectory(title="DXFフォルダを選択（ファイルサーバー）")
        if not path:
            return
        unc = normalize_unc(path)
        ax["dxf_unc"] = unc
        ax["dxf_var"].set(unc)

    def _axis_of(self, frame: tk.Misc) -> dict[str, Any] | None:
        for ax in self.axes:
            if ax["frame"] is frame:
                return ax
        return None

    def _select_instruction(self) -> None:
        path = filedialog.askopenfilename(
            title="工番別指示書PDFを選択（ファイルサーバー）",
            initialdir=SHIJI_SERVER_BASE,
            filetypes=[("PDF", "*.pdf"), ("すべてのファイル", "*.*")],
        )
        if not path:
            return
        unc = normalize_unc(path)
        self.instruction_unc = unc
        self.var_instruction.set(unc)

    # ------------------------------------------------------------------
    # 工番情報 / プレビュー
    # ------------------------------------------------------------------
    def _resolve_job(self) -> tuple[str, str] | None:
        """全軸の出図PDFファイル名から親工番を決める（全軸同一であることを検証）。"""
        if not self.current_role:
            return None
        keys: set[str] = set()
        job_id = ""
        for ax in self.axes:
            if not ax["pdf_unc"]:
                continue
            fname = os.path.basename(ax["pdf_unc"])
            prefix, key = extract_kouban_from_filename(fname)
            if key is None:
                messagebox.showwarning(APP_TITLE, f"工番を読み取れないファイルがあります:\n{fname}")
                return None
            job_id = to_job_id(prefix or kubun_for_role(self.current_role), key)
            keys.add(job_id)
        if not keys:
            return None
        if len(keys) > 1:
            messagebox.showwarning(
                APP_TITLE,
                "出図PDFの親工番が複数あります。1回の送信は1工番に揃えてください:\n"
                + "、".join(sorted(keys)),
            )
            return None
        return job_id, kubun_for_role(self.current_role)

    def _fetch_master(self, job_id: str) -> dict[str, Any] | None:
        # 1) 工番マスタ Excel（新一覧/日程表A・ファイルサーバ固定パス）= 元アプリと同方式。
        try:
            if self._master_data is None:
                self._master_data = load_master(
                    str(self.config_data.get("master_nittei_path") or ""),
                    str(self.config_data.get("master_shin_ichiran_path") or ""),
                )
            hit = lookup_master(self._master_data, job_id)
            if hit:
                return hit
        except Exception as e:  # noqa: BLE001 - Excel不可は DOVE 照会へフォールバック
            self.var_status.set(f"工番マスタExcel読込に失敗（DOVE照会へ）: {e}")
        # 2) フォールバック: DOVE API（Excel未ヒット or 読込失敗時）。
        try:
            return self.dove.search_master(job_id)
        except Exception as e:  # noqa: BLE001 - 照会失敗はフォールバックで継続
            self.var_status.set(f"工番マスタ照会に失敗（フォールバック継続）: {e}")
            return None

    def _refresh_preview(self) -> None:
        resolved = self._resolve_job()
        if resolved is None:
            return
        job_id, _kubun = resolved
        axes = self._build_axis_mail_entries()
        subject = mailer.build_zuzu_subject(job_id)
        body = mailer.build_zuzu_body(self.current_role or "", job_id, axes)
        self._set_text(self.txt_preview, f"件名: {subject}\n\n{body}")
        self.var_status.set(f"プレビュー更新: 工番 {job_id} / 軸 {len(axes)}件")

    # ------------------------------------------------------------------
    # 送信 + DOVE登録
    # ------------------------------------------------------------------
    def _build_axes_payload(self) -> list[dict[str, Any]]:
        """軸ペイロードを構築（パス相対化を含む。不一致は ValueError を送出）。"""
        out: list[dict[str, Any]] = []
        for ax in self.axes:
            name = ax["name_var"].get().strip()
            if not name or not ax["pdf_unc"]:
                continue
            rel_pdf = to_fileserver_relative(ax["pdf_unc"], self.fileserver_root, require_pdf=True)
            dxf_rel = (
                to_fileserver_relative(ax["dxf_unc"], self.fileserver_root)
                if ax["dxf_unc"]
                else None
            )
            out.append(
                {
                    "name": name,
                    "drawing_pdf_path": rel_pdf,
                    "drawing_label": None,
                    "dxf_folder_path": dxf_rel,
                }
            )
        return out

    def _build_axis_mail_entries(self) -> list[dict[str, Any]]:
        """本文用: 軸ごとに {name, customer, hinmei, link} を作る。

        納品先/製品名は、その軸の出図PDFファイル名の **枝番**（例 25146-1）で
        マスタ照会する（マスタは枝番付きで保持しており親工番 25146 では引けない）。
        """
        entries: list[dict[str, Any]] = []
        for ax in self.axes:
            if not ax["pdf_unc"]:
                continue
            mkey = extract_master_key_from_filename(os.path.basename(ax["pdf_unc"]))
            info = self._fetch_master(mkey) if mkey else None
            entries.append(
                {
                    "name": ax["name_var"].get().strip(),
                    "customer": (info or {}).get("customer"),
                    "hinmei": (info or {}).get("title"),
                    "link": normalize_unc(ax["pdf_unc"]),
                }
            )
        return entries

    def _send_zuzu(self, send_immediately: bool) -> None:
        if not self.current_role:
            return

        # 軸の妥当性検証
        named = [ax for ax in self.axes if ax["name_var"].get().strip() and ax["pdf_unc"]]
        if not named:
            messagebox.showwarning(APP_TITLE, "軸名と出図PDFを入力した軸を1つ以上用意してください")
            return

        resolved = self._resolve_job()
        if resolved is None:
            return
        job_id, kubun = resolved

        to_list, cc_list = get_recipients(self.members, self.current_role)
        if not to_list:
            messagebox.showwarning(APP_TITLE, "宛先(TO)が0名です。\n送付先一覧を確認してください。")
            return

        # ★ パス相対化は送信前に検証（不一致なら登録前=送信前に中断）。設計書 §4/§6-4。
        try:
            axes_payload = self._build_axes_payload()
            instr_rel = (
                to_fileserver_relative(self.instruction_unc, self.fileserver_root, require_pdf=True)
                if self.instruction_unc
                else None
            )
        except ValueError as e:
            messagebox.showerror(APP_TITLE, f"パス変換エラー（送信を中止しました）:\n{e}")
            return

        # 本文用: 軸ごとに（PDFファイル名の枝番で）マスタ照会し、納品先/製品名/軸名称を明記。
        mail_axes = self._build_axis_mail_entries()
        # DOVE Job（親工番）の代表 納品先/製品名 は、最初に情報が引けた軸から採る
        # （親工番はマスタに無く、枝番にしか情報がないため）。
        first = next((e for e in mail_axes if e.get("customer") or e.get("hinmei")), None)
        customer = (first or {}).get("customer")
        hinmei = (first or {}).get("hinmei")
        delivery_date = None

        subject = mailer.build_zuzu_subject(job_id)
        body = mailer.build_zuzu_body(self.current_role, job_id, mail_axes)
        html_body = mailer.build_zuzu_html_body(self.current_role, job_id, mail_axes)
        attachments = [self.instruction_unc] if self.instruction_unc else None

        if send_immediately:
            dlg = ConfirmDialog(
                self, self.current_role, to_list, cc_list, subject, body, attachments
            )
            self.wait_window(dlg)
            if not dlg.result:
                return

        # ★ 送信即時のみ: register payload を「メール送信前に1回だけ」構築して保持する。
        # sent_at をこの1回の値で固定 → 再試行でも冪等キー (job_id, subject, sent_at) が
        # 不変になり、メール二重送信・mail_logs 重複を防ぐ（設計書 §6-1）。
        if send_immediately:
            self._pending_payload = self._build_register_payload(
                job_id,
                kubun,
                customer,
                hinmei,
                delivery_date,
                axes_payload,
                instr_rel,
                subject,
                to_list,
                cc_list,
            )

        # メール送信
        try:
            mailer.send_outlook_mail(
                to_list,
                cc_list,
                subject,
                body,
                attachments=attachments,
                send_immediately=send_immediately,
                html_body=html_body,
            )
        except Exception as e:  # noqa: BLE001 - 失敗をログ+ダイアログで通知
            mailer.append_send_log(self.current_role, to_list, cc_list, subject, f"失敗: {e}")
            messagebox.showerror(APP_TITLE, f"メール送信エラー:\n{e}")
            return

        action = "送信" if send_immediately else "下書き"
        mailer.append_send_log(self.current_role, to_list, cc_list, subject, action)
        now = datetime.datetime.now().strftime("%H:%M:%S")

        if not send_immediately:
            self.var_status.set(f"下書き作成 {now} — Outlookに表示しました（DOVE登録なし）")
            return

        # 送信成功時のみ DOVE 登録（保持済み payload で冪等。失敗してもメールは再送しない）。
        payload = self._pending_payload
        if payload is None:
            return
        try:
            result = self.dove.register(payload)
        except Exception as e:  # noqa: BLE001 - メールは送信済。登録のみ再試行で整合回復可。
            self.var_status.set(f"送信完了 {now} / DOVE登録は失敗（登録のみ再試行可）")
            if messagebox.askretrycancel(
                APP_TITLE,
                "メールは送信しましたが、DOVE登録に失敗しました。\n"
                "［再試行］を押すと、メールは再送せず登録だけ補完します（冪等）。\n\n"
                f"詳細: {e}",
            ):
                self._retry_register_only()
            return

        self._pending_payload = None
        self.var_status.set(
            f"送信完了 {now} / DOVE登録OK 工番{result.get('job_id', job_id)} "
            f"軸{len(result.get('axes', []))}件"
        )
        messagebox.showinfo(
            APP_TITLE,
            f"送信 + DOVE登録が完了しました。\n工番: {result.get('job_id', job_id)}",
        )

    def _retry_register_only(self) -> None:
        """メールを再送せず、保持済み payload で DOVE 登録のみを再試行する（冪等）。

        ★ メール送信は一切行わない。冪等キー (job_id, subject, sent_at) は
        送信前に確定した payload で固定済みのため、何度再試行しても重複しない。
        """
        payload = self._pending_payload
        if payload is None:
            messagebox.showinfo(APP_TITLE, "再試行できる保留中のDOVE登録はありません。")
            return
        job_id = str(payload.get("job_id", ""))
        try:
            result = self.dove.register(payload)
        except Exception as e:  # noqa: BLE001 - メールは再送しない。再度の再試行で補完可。
            self.var_status.set("DOVE登録の再試行に失敗（メールは再送していません）")
            if messagebox.askretrycancel(
                APP_TITLE,
                "DOVE登録の再試行に失敗しました（メールは再送していません）。\n"
                "［再試行］で登録だけ再度補完します（冪等）。\n\n"
                f"詳細: {e}",
            ):
                self._retry_register_only()
            return

        self._pending_payload = None
        self.var_status.set(
            f"DOVE登録OK（再試行）工番{result.get('job_id', job_id)} "
            f"軸{len(result.get('axes', []))}件"
        )
        messagebox.showinfo(
            APP_TITLE,
            "DOVE登録が完了しました（メールは再送していません）。\n"
            f"工番: {result.get('job_id', job_id)}",
        )

    def _build_register_payload(
        self,
        job_id: str,
        kubun: str,
        customer: str | None,
        hinmei: str | None,
        delivery_date: str | None,
        axes_payload: list[dict[str, Any]],
        instr_rel: str | None,
        subject: str,
        to_list: list[MemberT],
        cc_list: list[MemberT],
    ) -> dict[str, Any]:
        """DOVE 合成エンドポイントへの登録ペイロード（設計書 §2.1）。本文/PIIは入れない。"""
        sent_at = datetime.datetime.now().astimezone().isoformat()
        return {
            "job_id": job_id,
            "kubun": kubun,
            "title": hinmei or None,
            "customer": customer or None,
            "delivery_date": delivery_date or None,
            "released_by": SENDER["name"],
            "axes": axes_payload,
            "instruction_pdf_path": instr_rel,
            "instruction_original_name": (
                os.path.basename(self.instruction_unc) if self.instruction_unc else None
            ),
            "mail": {
                "subject": subject,
                "sent_at": sent_at,
                "body": "",
                "to": [{"name": m["name"], "email": m["email"]} for m in to_list if m["email"]],
                "cc": [{"name": m["name"], "email": m["email"]} for m in cc_list if m["email"]],
            },
        }

    # ------------------------------------------------------------------
    # 工番別指示書（毎週末報告分・メールのみ）
    # ------------------------------------------------------------------
    def _build_shiji_ui(self) -> None:
        self.frm_main = ttk.Frame(self)
        self.frm_main.pack(fill="both", expand=True)
        pad = {"padx": 12, "pady": 6}

        ttk.Button(self.frm_main, text="← 戻る", command=self._go_back).pack(
            anchor="w", padx=10, pady=6
        )
        ttk.Label(self.frm_main, text="工番別指示書（毎週末報告分）", font=("", 13, "bold")).pack(
            pady=(4, 12)
        )

        frm_file = ttk.LabelFrame(self.frm_main, text="1. ファイルサーバーから指示書を選択")
        frm_file.pack(fill="x", **pad)
        frm_sel = ttk.Frame(frm_file)
        frm_sel.pack(fill="x", padx=10, pady=8)
        self.var_shiji_path = tk.StringVar(value="（未選択）")
        ttk.Button(frm_sel, text="ファイルを選択", command=self._select_shiji_file).pack(
            side="left"
        )
        ttk.Label(frm_sel, textvariable=self.var_shiji_path, wraplength=580).pack(
            side="left", padx=10
        )

        frm_dest = ttk.LabelFrame(self.frm_main, text="2. 宛先（自動振り分け）")
        frm_dest.pack(fill="x", **pad)
        to_text, cc_text, _to, _cc = get_recipients_label(self.members, ROLE_SHIJI)
        ttk.Label(frm_dest, text=to_text).pack(anchor="w", padx=10, pady=4)
        ttk.Label(frm_dest, text=cc_text).pack(anchor="w", padx=10, pady=(0, 8))

        frm_body = ttk.LabelFrame(self.frm_main, text="3. 本文プレビュー")
        frm_body.pack(fill="both", expand=True, **pad)
        self.txt_shiji_preview = scrolledtext.ScrolledText(frm_body, height=12, wrap="word")
        self.txt_shiji_preview.pack(fill="both", expand=True, padx=10, pady=8)
        self._set_text(self.txt_shiji_preview, "（ファイルを選択すると本文が表示されます）")

        frm_btn = ttk.Frame(self.frm_main)
        frm_btn.pack(fill="x", **pad)
        ttk.Button(
            frm_btn, text="下書き作成（Outlook表示）", command=lambda: self._send_shiji(False)
        ).pack(side="left", padx=10)
        ttk.Button(frm_btn, text="確認して送信", command=lambda: self._send_shiji(True)).pack(
            side="left", padx=10
        )

        self.var_status = tk.StringVar(value="ファイルを選択してください")
        ttk.Label(self.frm_main, textvariable=self.var_status, foreground="gray").pack(
            side="bottom", pady=6
        )

    def _select_shiji_file(self) -> None:
        path = filedialog.askopenfilename(
            title="工番別指示書を選択（ファイルサーバー）",
            initialdir=SHIJI_SERVER_BASE,
            filetypes=[("PDF", "*.pdf"), ("すべてのファイル", "*.*")],
        )
        if not path:
            return
        unc = normalize_unc(path)
        self.shiji_unc_path = unc
        self.var_shiji_path.set(unc)
        self._set_text(self.txt_shiji_preview, mailer.build_shiji_body(unc))
        self.var_status.set("ファイル選択済み — 送信準備完了")

    def _send_shiji(self, send_immediately: bool) -> None:
        if not self.shiji_unc_path:
            messagebox.showwarning(APP_TITLE, "ファイルを選択してください")
            return
        to_list, cc_list = get_recipients(self.members, ROLE_SHIJI)
        if not to_list:
            messagebox.showwarning(APP_TITLE, "宛先(TO)が0名です。\n送付先一覧を確認してください。")
            return

        subject = mailer.build_shiji_subject()
        body = mailer.build_shiji_body(self.shiji_unc_path)

        if send_immediately:
            dlg = ConfirmDialog(self, ROLE_SHIJI, to_list, cc_list, subject, body)
            self.wait_window(dlg)
            if not dlg.result:
                return

        try:
            mailer.send_outlook_mail(
                to_list,
                cc_list,
                subject,
                body,
                attachments=[self.shiji_unc_path],
                send_immediately=send_immediately,
            )
        except Exception as e:  # noqa: BLE001
            mailer.append_send_log(ROLE_SHIJI, to_list, cc_list, subject, f"失敗: {e}")
            messagebox.showerror(APP_TITLE, f"エラー:\n{e}")
            return

        action = "送信" if send_immediately else "下書き"
        mailer.append_send_log(ROLE_SHIJI, to_list, cc_list, subject, action)
        now = datetime.datetime.now().strftime("%H:%M:%S")
        if send_immediately:
            self.var_status.set(f"送信完了 {now} — TO:{len(to_list)}名")
        else:
            self.var_status.set(f"下書き作成 {now} — Outlookに表示しました")

    # ------------------------------------------------------------------
    # 共通ヘルパ
    # ------------------------------------------------------------------
    @staticmethod
    def _set_text(widget: scrolledtext.ScrolledText, text: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        widget.configure(state="disabled")
