"""メール本文生成 + Outlook COM 送信 + 送信ログCSV（参照EXE :208-377 流用）。

送信元は固定（木場真佐子）。出図図面PDF は本文に UNC リンク、工番別指示書/図面集は添付。
win32com の import 失敗は send 時に RuntimeError 化（未実機でも import 自体は通す）。
CSV は追記のみ（``open(..., "a")``）。削除・上書き・rename はしない（CLAUDE.md §2.1）。
"""

from __future__ import annotations

import csv
import datetime
import os
import sys

from .members import ROLE_TS, Member

try:  # pragma: no cover - 実機 Outlook 依存
    import win32com.client
except ImportError:  # フォールバック: 未インストール環境でも起動できるようにする
    win32com = None  # type: ignore[assignment]


# 送信者情報（固定: 木場真佐子）
SENDER = {
    "name": "木場真佐子",
    "email": "m-kiba@lineworks.co.jp",
    "tel": "043-250-0165",
    "fax": "043-257-9488",
    "zip": "〒262-0012",
    "address": "千葉県千葉市花見川区千種町53",
}
COMPANY_NAME = "株式会社ラインワークス"

# メール HTML 本文のフォント（游ゴシック）。
_MAIL_FONT = "'游ゴシック', 'Yu Gothic', sans-serif"


def resource_base_dir() -> str:
    """EXE（凍結）なら実行ファイルのフォルダ、開発時はソースのフォルダを返す。"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


# =========================
# 本文生成
# =========================
def build_signature() -> str:
    """署名を生成する。"""
    lines = [
        "",
        "＊…──────────────────────────…＊",
        f"　{COMPANY_NAME}",
        f"　　　　　{SENDER['name']}",
        f"　{SENDER['zip']} {SENDER['address']}",
        f"　TEL: {SENDER['tel']}",
        f"　FAX: {SENDER['fax']}",
        f"　Email: {SENDER['email']}",
        "＊…──────────────────────────…＊",
    ]
    return "\r\n".join(lines)


def build_zuzu_subject(job_display: str) -> str:
    """出図のお知らせ 件名（工番1件=1Job）。"""
    return f"【出図のお知らせ】工番{job_display}"


def build_zuzu_body(
    role: str,
    job_display: str,
    customer: str | None,
    hinmei: str | None,
    axis_unc_links: list[str],
) -> str:
    """出図のお知らせ 本文（要件 §4.1 テンプレート準拠）。

    出図図面PDF は添付せず、UNC パスを本文にリンクとして列挙する。
    """
    if customer or hinmei:
        kouban_line = f"工番{job_display} {customer or ''}様向け {hinmei or ''}".rstrip()
    else:
        kouban_line = f"工番{job_display} （日程表に情報なし）"

    attach_line = "図面集を添付します。" if role == ROLE_TS else "工番別指示書を添付します。"

    lines = [
        "関係者各位",
        "",
        "お疲れ様です。",
        "出図のお知らせです。",
        kouban_line,
        "図面集リンクを↓貼り付けます。",
        attach_line,
        "",
    ]
    lines.extend(axis_unc_links)
    lines.append("")
    lines.append("どうぞよろしくお願いいたします。")
    return "\r\n".join(lines) + "\r\n" + build_signature()


def build_zuzu_html_body(
    role: str,
    job_display: str,
    customer: str | None,
    hinmei: str | None,
    axis_unc_links: list[str],
) -> str:
    """Outlook 送信用 HTML 本文（UNC リンクをクリック可能にする）。"""
    if customer or hinmei:
        kouban_line = f"工番{job_display} {customer or ''}様向け {hinmei or ''}".rstrip()
    else:
        kouban_line = f"工番{job_display} （日程表に情報なし）"
    attach_line = "図面集を添付します。" if role == ROLE_TS else "工番別指示書を添付します。"

    link_html = "<br>".join(
        f'<a href="file:///{p.replace(chr(92), "/")}">{p}</a>' for p in axis_unc_links
    )
    return (
        f'<html><body style="font-family: {_MAIL_FONT}; font-size: 10.5pt;">'
        "<p>関係者各位</p>"
        "<p>お疲れ様です。<br>出図のお知らせです。</p>"
        f"<p>{kouban_line}<br>図面集リンクを↓貼り付けます。<br>{attach_line}</p>"
        f"<p>{link_html}</p>"
        "<p>どうぞよろしくお願いいたします。</p>"
        f'<pre style="font-family: {_MAIL_FONT}; font-size: 10.5pt;">'
        f"{build_signature()}</pre>"
        "</body></html>"
    )


def build_shiji_subject() -> str:
    """工番別指示書（毎週末報告分）件名。"""
    return "毎週末報告分の工番別指示書"


def build_shiji_body(unc_path: str) -> str:
    """工番別指示書（毎週末報告分）本文（プレーンテキスト・プレビュー兼用）。"""
    lines = [
        "関係者各位",
        "",
        "お疲れ様です。",
        "毎週末報告分の工番別指示書を添付します。",
        "",
        "どうぞよろしくお願いいたします。",
        unc_path,
    ]
    return "\r\n".join(lines) + "\r\n" + build_signature()


# =========================
# Outlook 送信
# =========================
def find_outlook_account(outlook: object, email: str) -> object | None:
    """送信元アドレスに一致する Outlook アカウントを探す。"""
    target = (email or "").lower()
    session = outlook.Session  # type: ignore[attr-defined]
    for i in range(1, session.Accounts.Count + 1):
        acc = session.Accounts.Item(i)
        if (acc.SmtpAddress or "").lower() == target:
            return acc
    return None


def send_outlook_mail(
    to_list: list[Member],
    cc_list: list[Member],
    subject: str,
    body: str,
    *,
    attachments: list[str] | None = None,
    send_immediately: bool = False,
    html_body: str | None = None,
) -> bool:
    """Outlook で本文を作成し、送信または下書き表示する（参照EXE :306-352）。"""
    if win32com is None:
        raise RuntimeError("pywin32 がインストールされていません")

    outlook = win32com.client.Dispatch("Outlook.Application")

    account = find_outlook_account(outlook, SENDER["email"])
    if account is None:
        raise RuntimeError(
            f"送付主 {SENDER['email']} のアカウントが\nこのPCのOutlookに登録されていません。"
        )

    mail = outlook.CreateItem(0)
    # SendUsingAccount を COM 経由でセット（参照EXE と同手法）
    mail._oleobj_.Invoke(*(64209, 0, 8, 0, account))

    mail.To = "; ".join(m["email"] for m in to_list if m["email"])
    mail.CC = "; ".join(m["email"] for m in cc_list if m["email"])
    mail.Subject = subject
    if html_body:
        mail.HTMLBody = html_body
    else:
        mail.Body = body

    if attachments:
        for path in attachments:
            if not os.path.isfile(path):
                raise RuntimeError(f"添付ファイルが見つかりません:\n{path}")
            # 位置引数で渡す。Source= キーワード渡しは pywin32 の版差で
            # 例外なく無添付になることがあるため避ける。
            mail.Attachments.Add(path)
        if int(mail.Attachments.Count) < len(attachments):
            raise RuntimeError(
                "添付ファイルの追加に失敗しました（Outlook に拒否された可能性があります）。"
            )

    if send_immediately:
        mail.Send()
    else:
        mail.Display(False)

    return True


def append_send_log(
    role: str,
    to_list: list[Member],
    cc_list: list[Member],
    subject: str,
    action: str,
) -> None:
    """送信ログを CSV に **追記**する（参照EXE :355-377）。新規作成 or 追記のみ。"""
    log_path = os.path.join(resource_base_dir(), "送信ログ.csv")
    is_new = not os.path.isfile(log_path)
    try:
        with open(log_path, "a", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            if is_new:
                w.writerow(["日時", "動作", "役割", "送付主", "宛先TO", "CC", "件名"])
            w.writerow(
                [
                    datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    action,
                    role,
                    SENDER["name"],
                    "; ".join(m["email"] for m in to_list),
                    "; ".join(m["email"] for m in cc_list),
                    subject,
                ]
            )
    except OSError:
        # ログ書込失敗はメール送信本体を妨げない
        pass
