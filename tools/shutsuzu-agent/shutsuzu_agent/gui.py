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
    flag_kind,
    get_recipients,
    get_recipients_label,
)
from .members import Member as MemberT
from .paths import normalize_unc, to_fileserver_relative

APP_TITLE = "出図のお知らせ × DOVE連携 メール送信"

# 工番別指示書 ファイルサーバー初期フォルダ（UNC・参照EXE :34-37）
SHIJI_SERVER_BASE = os.path.join(os.sep * 2 + "lineworks-sv", "Data", "部署間共通", "工番別指示書")

# 本文プレビュー（編集可）の初期メッセージ。これと一致 or 空欄なら「未編集」とみなす。
_BODY_PLACEHOLDER = (
    "（軸を追加し『本文を再生成』を押すと本文が表示されます。ここで直接編集もできます）"
)


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


class RecipientPickerDialog(tk.Toplevel):
    """テスト送信の宛先を絞り込むダイアログ（宛先を TO/CC/送らない から選ぶ）。

    初期値は送付先一覧の「テスト送信」列（``test`` フラグ）から設定し、ここで自由に
    変更できる。``result`` は (to_list, cc_list)。キャンセル時は None。
    """

    _CHOICES = ("送らない", "TO", "CC")
    _KIND_TO_CHOICE = {"none": "送らない", "to": "TO", "cc": "CC"}

    def __init__(self, parent: tk.Misc, members: list[MemberT]) -> None:
        super().__init__(parent)
        self.title("テスト送信先の選択（宛先を絞る）")
        self.geometry("560x620")
        self.transient(parent)
        self.grab_set()
        self.result: tuple[list[MemberT], list[MemberT]] | None = None
        self._app = parent
        self._members = members
        self._vars: list[tuple[MemberT, tk.StringVar]] = []

        ttk.Label(
            self,
            text="テスト送信する宛先だけを選んでください（既定値は『テスト送信』列）。",
            foreground="#555",
        ).pack(anchor="w", padx=12, pady=(12, 4))

        # 一括操作
        top = ttk.Frame(self)
        top.pack(fill="x", padx=12, pady=(0, 4))
        ttk.Button(top, text="全て送らない", command=lambda: self._set_all("送らない")).pack(
            side="left"
        )
        ttk.Button(top, text="既定に戻す", command=self._reset_defaults).pack(side="left", padx=6)

        # メンバー一覧（縦スクロール）
        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, padx=12, pady=4)
        canvas = tk.Canvas(body, highlightthickness=0)
        vbar = ttk.Scrollbar(body, orient="vertical", command=canvas.yview)
        inner = ttk.Frame(canvas)
        inner_id = canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=vbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        vbar.pack(side="right", fill="y")
        inner.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfigure(inner_id, width=e.width))
        canvas.bind_all("<MouseWheel>", lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))

        head = ttk.Frame(inner)
        head.pack(fill="x", pady=(0, 2))
        ttk.Label(head, text="送信区分", width=10, foreground="#555").pack(side="left")
        ttk.Label(head, text="名前 / メールアドレス", foreground="#555").pack(side="left", padx=6)
        for m in members:
            row = ttk.Frame(inner)
            row.pack(fill="x", pady=1)
            var = tk.StringVar(value=self._KIND_TO_CHOICE[flag_kind(m["test"])])
            ttk.Combobox(
                row, textvariable=var, values=self._CHOICES, state="readonly", width=8
            ).pack(side="left")
            ttk.Label(row, text=f"{m['name']}  <{m['email']}>").pack(side="left", padx=8)
            self._vars.append((m, var))

        btns = ttk.Frame(self)
        btns.pack(fill="x", padx=12, pady=10)
        ttk.Button(btns, text="キャンセル", command=self._on_cancel).pack(side="right", padx=6)
        ttk.Button(btns, text="この宛先で下書き作成", command=self._on_ok).pack(side="right")

        self.bind("<Escape>", lambda _e: self._on_cancel())
        self.protocol("WM_DELETE_WINDOW", self._on_cancel)

    def _set_all(self, choice: str) -> None:
        for _m, var in self._vars:
            var.set(choice)

    def _reset_defaults(self) -> None:
        for m, var in self._vars:
            var.set(self._KIND_TO_CHOICE[flag_kind(m["test"])])

    def _on_ok(self) -> None:
        to_list = [m for m, var in self._vars if var.get() == "TO"]
        cc_list = [m for m, var in self._vars if var.get() == "CC"]
        self.result = (to_list, cc_list)
        self._teardown()

    def _on_cancel(self) -> None:
        self.result = None
        self._teardown()

    def _teardown(self) -> None:
        # bind_all はアプリ全体に効くため、閉じる際は App 本体のホイール束ねを復元する
        # （解除したままだと本画面の縦スクロールがホイールで効かなくなる）。
        handler = getattr(self._app, "_on_mousewheel", None)
        if handler is not None:
            self._app.bind_all("<MouseWheel>", handler)
        else:
            self.unbind_all("<MouseWheel>")
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
        # 縦スクロール対象の Canvas（軸が増えても操作ボタンが隠れないようにする）。
        # 画面遷移ごとに張り替えるため、ホイールは1度だけ束ねて参照先で切替える。
        self._scroll_canvas: tk.Canvas | None = None
        self.bind_all("<MouseWheel>", self._on_mousewheel)

        self._build_role_select()

    # ------------------------------------------------------------------
    # スクロール基盤（ヘッダー固定・中央スクロール・操作ボタン固定）
    # ------------------------------------------------------------------
    def _on_mousewheel(self, event: tk.Event) -> None:
        """現在表示中のスクロール領域をホイールで縦スクロールする。"""
        canvas = self._scroll_canvas
        if canvas is not None and canvas.winfo_exists():
            canvas.yview_scroll(int(-event.delta / 120), "units")

    def _make_scrollable(self, parent: tk.Misc) -> ttk.Frame:
        """parent 内に縦スクロール可能な内側フレームを作って返す。

        Canvas + Scrollbar で「中身が縦に伸びても見切れない」領域を作る。
        内側フレームの幅は Canvas 幅に追従させ、横スクロールは出さない。
        """
        canvas = tk.Canvas(parent, highlightthickness=0)
        vbar = ttk.Scrollbar(parent, orient="vertical", command=canvas.yview)
        inner = ttk.Frame(canvas)
        inner_id = canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=vbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        vbar.pack(side="right", fill="y")

        def _on_inner_config(_e: tk.Event) -> None:
            canvas.configure(scrollregion=canvas.bbox("all"))

        def _on_canvas_config(e: tk.Event) -> None:
            canvas.itemconfigure(inner_id, width=e.width)

        inner.bind("<Configure>", _on_inner_config)
        canvas.bind("<Configure>", _on_canvas_config)
        self._scroll_canvas = canvas
        return inner

    @staticmethod
    def _bind_text_wheel(widget: tk.Misc) -> None:
        """テキスト欄上ではその欄自身をスクロールし、外側 Canvas へ伝播させない。"""

        def _wheel(event: tk.Event) -> str:
            widget.yview_scroll(int(-event.delta / 120), "units")  # type: ignore[attr-defined]
            return "break"

        widget.bind("<MouseWheel>", _wheel)

    # ------------------------------------------------------------------
    # 役割選択
    # ------------------------------------------------------------------
    def _build_role_select(self) -> None:
        self._scroll_canvas = None
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

        # ── 固定ヘッダー（戻る / タイトル）──────────────────────────────
        head = ttk.Frame(self.frm_main)
        head.pack(fill="x", side="top")
        ttk.Button(head, text="← 戻る", command=self._go_back).pack(anchor="w", padx=10, pady=6)
        ttk.Label(head, text=f"出図のお知らせ（{label}）", font=("", 13, "bold")).pack(pady=(0, 6))
        ttk.Separator(self.frm_main, orient="horizontal").pack(fill="x", side="top")

        # ── 固定フッター（操作ボタン / ステータス）── 先に下から確保し、
        #    残り領域をスクロール領域に充てる（軸が増えてもボタンが隠れない）。
        self.var_status = tk.StringVar(value="軸を追加してください")
        ttk.Label(self.frm_main, textvariable=self.var_status, foreground="gray").pack(
            side="bottom", fill="x", pady=(2, 6), padx=12
        )
        # 2段構成（下=テスト / 上=本番）。bottom 詰めなので「テスト行→本番行」の順に積む。
        frm_test = ttk.Frame(self.frm_main)
        frm_test.pack(fill="x", side="bottom", padx=12, pady=(2, 4))
        ttk.Button(
            frm_test,
            text="テスト下書き作成（宛先を絞る・DOVE登録なし）",
            command=self._test_draft_zuzu,
        ).pack(side="left", padx=10)
        frm_btn = ttk.Frame(self.frm_main)
        frm_btn.pack(fill="x", side="bottom", **pad)
        ttk.Separator(self.frm_main, orient="horizontal").pack(fill="x", side="bottom")
        ttk.Button(
            frm_btn,
            text="下書き作成 → DOVE登録",
            command=lambda: self._submit_zuzu("draft"),
        ).pack(side="left", padx=10)
        ttk.Button(
            frm_btn,
            text="DOVE登録のみ（メール送信なし）",
            command=lambda: self._submit_zuzu("dove"),
        ).pack(side="left", padx=10)
        ttk.Button(
            frm_btn,
            text="確認して送信 → DOVE登録",
            command=lambda: self._submit_zuzu("send"),
        ).pack(side="right", padx=10)

        # ── 中央スクロール領域（軸 / 指示書 / 宛先 / 本文編集）──────────
        body = self._make_scrollable(self.frm_main)

        # 1. 軸構成
        frm_axes_outer = ttk.LabelFrame(body, text="1. 軸の構成（＋で軸を追加・軸名を入力）")
        frm_axes_outer.pack(fill="x", **pad)

        header = ttk.Frame(frm_axes_outer)
        header.pack(fill="x", padx=8, pady=(6, 0))
        ttk.Button(header, text="＋ 軸を追加", command=self._add_axis).pack(side="left")
        ttk.Label(
            header, text="（各軸: 軸名 / 出図PDF1枚 / DXFフォルダ任意）", foreground="gray"
        ).pack(side="left", padx=10)

        self.frm_axes = ttk.Frame(frm_axes_outer)
        self.frm_axes.pack(fill="x", padx=8, pady=6)

        # 2. 工番別指示書PDF（Job単位・添付）
        frm_instr = ttk.LabelFrame(body, text="2. 工番別指示書PDF（工番に1つ・メール添付）")
        frm_instr.pack(fill="x", **pad)
        row = ttk.Frame(frm_instr)
        row.pack(fill="x", padx=10, pady=8)
        ttk.Button(row, text="指示書PDFを選択", command=self._select_instruction).pack(side="left")
        self.var_instruction = tk.StringVar(value="（未選択・任意）")
        ttk.Label(row, textvariable=self.var_instruction, wraplength=560).pack(side="left", padx=10)

        # 3. 宛先
        frm_dest = ttk.LabelFrame(body, text="3. 宛先（自動振り分け）")
        frm_dest.pack(fill="x", **pad)
        to_text, cc_text, _to, _cc = get_recipients_label(self.members, role)
        ttk.Label(frm_dest, text=to_text).pack(anchor="w", padx=10, pady=4)
        ttk.Label(frm_dest, text=cc_text).pack(anchor="w", padx=10, pady=(0, 8))

        # 4. 本文（プレビュー兼編集欄）
        frm_body = ttk.LabelFrame(body, text="4. 本文（編集可・送信前にここで直接修正できます）")
        frm_body.pack(fill="x", **pad)
        subj_row = ttk.Frame(frm_body)
        subj_row.pack(fill="x", padx=10, pady=(8, 2))
        ttk.Label(subj_row, text="件名:", foreground="#555").pack(side="left")
        self.var_subject = tk.StringVar(value="（軸の出図PDFから自動作成）")
        ttk.Label(subj_row, textvariable=self.var_subject, anchor="w").pack(
            side="left", fill="x", expand=True, padx=6
        )
        ttk.Button(
            frm_body,
            text="本文を再生成（工番情報をDOVEから取得・編集内容は上書き）",
            command=self._refresh_preview,
        ).pack(anchor="w", padx=10, pady=(0, 2))
        self.txt_preview = scrolledtext.ScrolledText(frm_body, height=12, wrap="word")
        self.txt_preview.pack(fill="x", padx=10, pady=(0, 8))
        self.txt_preview.insert("1.0", _BODY_PLACEHOLDER)
        self._bind_text_wheel(self.txt_preview)

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
        """工番情報を取得し、件名と本文（編集欄）を再生成する。編集内容は上書きされる。"""
        resolved = self._resolve_job()
        if resolved is None:
            return
        job_id, _kubun = resolved
        axes = self._build_axis_mail_entries()
        subject = mailer.build_zuzu_subject(job_id)
        body = mailer.build_zuzu_body(self.current_role or "", job_id, axes)
        self.var_subject.set(subject)
        self.txt_preview.delete("1.0", "end")
        self.txt_preview.insert("1.0", body)
        self.var_status.set(f"本文を再生成: 工番 {job_id} / 軸 {len(axes)}件")

    def _zuzu_edited_body(self) -> str | None:
        """編集欄の本文を返す。未編集（空欄 or 初期メッセージ）なら None。"""
        text = self.txt_preview.get("1.0", "end").rstrip("\n")
        stripped = text.strip()
        if not stripped or stripped == _BODY_PLACEHOLDER.strip():
            return None
        return text

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

    def _submit_zuzu(self, mode: str) -> None:
        """出図のお知らせを3モードで実行する。

        - ``"send"`` : 確認ダイアログ → メール送信 → DOVE登録（送信履歴 mail_logs を記録）。
        - ``"draft"``: Outlook 下書き表示 → DOVE登録（mail なし＝送信履歴は残さない）。
        - ``"dove"`` : メールを一切作らず DOVE登録のみ（mail なし）。

        図面データ（Job/軸/出図PDF/DXF/指示書）の登録は3モード共通。送信履歴は実際に
        送信した ``send`` のときだけ ``mail`` ブロックを付けて記録する（要件①③）。
        """
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

        # 宛先はメールを作るモード（send/draft）でのみ必須。
        to_list, cc_list = get_recipients(self.members, self.current_role)
        if mode in ("send", "draft") and not to_list:
            messagebox.showwarning(APP_TITLE, "宛先(TO)が0名です。\n送付先一覧を確認してください。")
            return

        # ★ パス相対化は登録/送信前に検証（不一致なら中断）。設計書 §4/§6-4。
        try:
            axes_payload = self._build_axes_payload()
            instr_rel = (
                to_fileserver_relative(self.instruction_unc, self.fileserver_root, require_pdf=True)
                if self.instruction_unc
                else None
            )
        except ValueError as e:
            messagebox.showerror(APP_TITLE, f"パス変換エラー（処理を中止しました）:\n{e}")
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

        # 本文は編集欄を最優先。未編集なら自動生成し、編集欄にも反映（送信内容を見せる）。
        body = self._zuzu_edited_body()
        if body is None:
            body = mailer.build_zuzu_body(self.current_role, job_id, mail_axes)
            self.var_subject.set(subject)
            self.txt_preview.delete("1.0", "end")
            self.txt_preview.insert("1.0", body)
        # 編集後テキスト中の UNC 行を自動リンク化して HTML 本文にする（要件②）。
        html_body = mailer.build_html_from_text(body)
        attachments = [self.instruction_unc] if self.instruction_unc else None

        if mode == "dove":
            self._submit_zuzu_dove_only(
                job_id, kubun, customer, hinmei, delivery_date, axes_payload, instr_rel
            )
            return

        if mode == "send":
            dlg = ConfirmDialog(
                self, self.current_role, to_list, cc_list, subject, body, attachments
            )
            self.wait_window(dlg)
            if not dlg.result:
                return

        # register payload を「メール作成前に1回だけ」構築して保持する。
        # send は mail ブロック付き（sent_at 固定で冪等キー不変・mail_logs 重複防止）。
        # draft は mail なし（送信していないため送信履歴を残さない・要件①）。
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
            include_mail=(mode == "send"),
        )

        # メール作成（send=即送信 / draft=Outlook下書き表示）
        try:
            mailer.send_outlook_mail(
                to_list,
                cc_list,
                subject,
                body,
                attachments=attachments,
                send_immediately=(mode == "send"),
                html_body=html_body,
            )
        except Exception as e:  # noqa: BLE001 - 失敗をログ+ダイアログで通知
            verb = "送信" if mode == "send" else "下書き"
            mailer.append_send_log(self.current_role, to_list, cc_list, subject, f"失敗: {e}")
            messagebox.showerror(APP_TITLE, f"メール{verb}エラー:\n{e}")
            return

        action = "送信" if mode == "send" else "下書き"
        mailer.append_send_log(self.current_role, to_list, cc_list, subject, action)
        now = datetime.datetime.now().strftime("%H:%M:%S")

        # 送信/下書きの後に DOVE 登録（保持済み payload で冪等。失敗してもメールは再送しない）。
        payload = self._pending_payload
        if payload is None:
            return
        try:
            result = self.dove.register(payload)
        except Exception as e:  # noqa: BLE001 - メールは作成済。登録のみ再試行で整合回復可。
            self.var_status.set(f"{action} {now} / DOVE登録は失敗（登録のみ再試行可）")
            if messagebox.askretrycancel(
                APP_TITLE,
                f"メールは{action}しましたが、DOVE登録に失敗しました。\n"
                "［再試行］を押すと、メールは再作成せず登録だけ補完します（冪等）。\n\n"
                f"詳細: {e}",
            ):
                self._retry_register_only()
            return

        self._pending_payload = None
        suffix = "（Outlookに下書き表示）" if mode == "draft" else ""
        self.var_status.set(
            f"{action}完了 {now} / DOVE登録OK 工番{result.get('job_id', job_id)} "
            f"軸{len(result.get('axes', []))}件 {suffix}"
        )
        messagebox.showinfo(
            APP_TITLE,
            f"{action} + DOVE登録が完了しました。\n工番: {result.get('job_id', job_id)}",
        )

    def _submit_zuzu_dove_only(
        self,
        job_id: str,
        kubun: str,
        customer: str | None,
        hinmei: str | None,
        delivery_date: str | None,
        axes_payload: list[dict[str, Any]],
        instr_rel: str | None,
    ) -> None:
        """メールを一切作らず DOVE登録のみ実行する（要件③・mail なし）。"""
        if not messagebox.askokcancel(
            APP_TITLE,
            f"メールは送信せず、DOVEへの登録だけを行います。\n工番: {job_id}\n\nよろしいですか？",
        ):
            return
        self._pending_payload = self._build_register_payload(
            job_id,
            kubun,
            customer,
            hinmei,
            delivery_date,
            axes_payload,
            instr_rel,
            mailer.build_zuzu_subject(job_id),
            [],
            [],
            include_mail=False,
        )
        now = datetime.datetime.now().strftime("%H:%M:%S")
        try:
            result = self.dove.register(self._pending_payload)
        except Exception as e:  # noqa: BLE001 - メールは未送信。登録のみ再試行で整合回復可。
            self.var_status.set(f"DOVE登録のみ {now} / 失敗（再試行可）")
            if messagebox.askretrycancel(
                APP_TITLE,
                f"DOVE登録に失敗しました（メールは送信していません）。\n"
                "［再試行］で登録だけ再度補完します（冪等）。\n\n"
                f"詳細: {e}",
            ):
                self._retry_register_only()
            return
        self._pending_payload = None
        self.var_status.set(
            f"DOVE登録のみ完了 {now} 工番{result.get('job_id', job_id)} "
            f"軸{len(result.get('axes', []))}件（メール送信なし）"
        )
        messagebox.showinfo(
            APP_TITLE,
            "DOVE登録が完了しました（メールは送信していません）。\n"
            f"工番: {result.get('job_id', job_id)}",
        )

    # ------------------------------------------------------------------
    # テスト下書き（宛先を絞る・DOVE登録なし）
    # ------------------------------------------------------------------
    def _open_test_picker(self) -> tuple[list[MemberT], list[MemberT]] | None:
        """テスト送信先ピッカーを開き、(TO, CC) を返す。キャンセル時は None。"""
        dlg = RecipientPickerDialog(self, self.members)
        self.wait_window(dlg)
        return dlg.result

    def _do_test_draft(
        self,
        role: str,
        subject: str,
        body: str,
        html_body: str | None,
        attachments: list[str] | None,
    ) -> None:
        """宛先を絞って Outlook 下書きを作る共通処理。DOVE登録は一切しない（要件・テスト）。"""
        picked = self._open_test_picker()
        if picked is None:
            return
        to_list, cc_list = picked
        if not to_list:
            messagebox.showwarning(APP_TITLE, "テスト送信のTO宛先を1名以上選んでください")
            return

        try:
            mailer.send_outlook_mail(
                to_list,
                cc_list,
                subject,
                body,
                attachments=attachments,
                send_immediately=False,
                html_body=html_body,
            )
        except Exception as e:  # noqa: BLE001 - 失敗をログ+ダイアログで通知
            mailer.append_send_log(role, to_list, cc_list, subject, f"テスト失敗: {e}")
            messagebox.showerror(APP_TITLE, f"テスト下書き作成エラー:\n{e}")
            return

        mailer.append_send_log(role, to_list, cc_list, subject, "テスト下書き")
        now = datetime.datetime.now().strftime("%H:%M:%S")
        to_names = ", ".join(m["name"] for m in to_list)
        cc_names = ", ".join(m["name"] for m in cc_list) or "(なし)"
        self.var_status.set(
            f"テスト下書き作成 {now} — TO({len(to_list)}): {to_names} / "
            f"CC({len(cc_list)}): {cc_names}（DOVE登録なし）"
        )
        messagebox.showinfo(
            APP_TITLE,
            "テスト用の下書きをOutlookに表示しました（DOVE登録なし・送信はしていません）。\n\n"
            f"TO: {to_names}\nCC: {cc_names}",
        )

    def _test_draft_zuzu(self) -> None:
        """出図のお知らせを、絞った宛先でテスト下書き化する（DOVE登録なし）。"""
        if not self.current_role:
            return
        named = [ax for ax in self.axes if ax["name_var"].get().strip() and ax["pdf_unc"]]
        if not named:
            messagebox.showwarning(APP_TITLE, "軸名と出図PDFを入力した軸を1つ以上用意してください")
            return
        resolved = self._resolve_job()
        if resolved is None:
            return
        job_id, _kubun = resolved
        mail_axes = self._build_axis_mail_entries()
        subject = mailer.build_zuzu_subject(job_id)
        body = self._zuzu_edited_body()
        if body is None:
            body = mailer.build_zuzu_body(self.current_role, job_id, mail_axes)
            self.var_subject.set(subject)
            self.txt_preview.delete("1.0", "end")
            self.txt_preview.insert("1.0", body)
        html_body = mailer.build_html_from_text(body)
        attachments = [self.instruction_unc] if self.instruction_unc else None
        self._do_test_draft(self.current_role, subject, body, html_body, attachments)

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
        *,
        include_mail: bool,
    ) -> dict[str, Any]:
        """DOVE 合成エンドポイントへの登録ペイロード（設計書 §2.1）。本文/PIIは入れない。

        ``include_mail=False`` のときは ``mail`` を付けない（下書き/DOVE登録のみでは
        送信履歴 mail_logs を残さない・要件①③）。
        """
        payload: dict[str, Any] = {
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
            "mail": None,
        }
        if include_mail:
            payload["mail"] = {
                "subject": subject,
                "sent_at": datetime.datetime.now().astimezone().isoformat(),
                "body": "",
                "to": [{"name": m["name"], "email": m["email"]} for m in to_list if m["email"]],
                "cc": [{"name": m["name"], "email": m["email"]} for m in cc_list if m["email"]],
            }
        return payload

    # ------------------------------------------------------------------
    # 工番別指示書（毎週末報告分・メールのみ）
    # ------------------------------------------------------------------
    def _build_shiji_ui(self) -> None:
        self._scroll_canvas = None
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
        ttk.Button(
            frm_btn,
            text="テスト下書き作成（宛先を絞る）",
            command=self._test_draft_shiji,
        ).pack(side="right", padx=10)

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

    def _test_draft_shiji(self) -> None:
        """工番別指示書を、絞った宛先でテスト下書き化する（DOVE連携は元々なし）。"""
        if not self.shiji_unc_path:
            messagebox.showwarning(APP_TITLE, "ファイルを選択してください")
            return
        subject = mailer.build_shiji_subject()
        body = mailer.build_shiji_body(self.shiji_unc_path)
        self._do_test_draft(ROLE_SHIJI, subject, body, None, [self.shiji_unc_path])

    # ------------------------------------------------------------------
    # 共通ヘルパ
    # ------------------------------------------------------------------
    @staticmethod
    def _set_text(widget: scrolledtext.ScrolledText, text: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        widget.configure(state="disabled")
