"""Outlook COM 送信 + 本文生成。

出図EXE (`shutsuzu_agent.mailer`) との最大の違いは **送信元**:
出図EXE は木場さん固定だが、本アプリは **操作している本人のアカウント**から送る
(設計部員が各自で依頼を出すため)。`find_outlook_account` の仕組みは流用する。

ファイルの削除・改名は一切しない。添付は依頼者 PC 上の実ファイルを参照するのみ。
"""

from __future__ import annotations

import os
import sys

try:  # pragma: no cover - Windows 以外では import できない
    import win32com.client
except ImportError:  # pragma: no cover
    win32com = None  # type: ignore[assignment]

from .members import Member


def resource_base_dir() -> str:
    """EXE (またはスクリプト) と同じフォルダを返す。"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_request_subject(job_label: str) -> str:
    return f"【購入部品追加依頼】{job_label}"


def build_request_body(
    requester_name: str,
    job_label: str,
    customer: str | None,
    hinmei: str | None,
    note: str | None,
) -> str:
    """依頼メール本文 (設計 → 購買)。"""
    lines = [
        "お疲れ様です。",
        "購入部品の追加依頼です。",
        "",
        f"工番: {job_label}",
    ]
    if customer:
        lines.append(f"納入先: {customer}")
    if hinmei:
        lines.append(f"製品名: {hinmei}")
    lines.append("")
    lines.append("追加をお願いしたい部品は添付の部品リストをご確認ください。")
    if note:
        lines.extend(["", "【備考】", note])
    lines.extend(["", "よろしくお願いいたします。", requester_name])
    return "\r\n".join(lines)


def build_reply_subject(job_label: str) -> str:
    return f"【手配結果】購入部品追加依頼 {job_label}"


def build_reply_body(
    replier_name: str, job_label: str, requester_name: str, note: str | None
) -> str:
    """回答メール本文 (購買 → 設計)。"""
    lines = [
        f"{requester_name} 様",
        "",
        "お疲れ様です。",
        "ご依頼いただいた購入部品の手配結果をお送りします。",
        "",
        f"工番: {job_label}",
        "詳細は添付の資料をご確認ください。",
    ]
    if note:
        lines.extend(["", "【連絡事項】", note])
    lines.extend(["", "よろしくお願いいたします。", replier_name])
    return "\r\n".join(lines)


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
    sender_email: str,
    to_list: list[Member],
    cc_list: list[Member],
    subject: str,
    body: str,
    *,
    attachments: list[str] | None = None,
    send_immediately: bool = False,
) -> None:
    """Outlook でメールを作成し、送信または下書き表示する。

    `sender_email` は **操作している本人**のアドレス。そのアカウントが
    このPCの Outlook に無ければ、誤送信を避けるため送信せず中断する。
    """
    if win32com is None:
        raise RuntimeError("pywin32 がインストールされていません")

    outlook = win32com.client.Dispatch("Outlook.Application")
    account = find_outlook_account(outlook, sender_email)
    if account is None:
        raise RuntimeError(
            f"あなたのアカウント {sender_email} が\nこのPCの Outlook に登録されていません。\n"
            "送付先マスタのメールアドレスをご確認ください。"
        )

    mail = outlook.CreateItem(0)
    # SendUsingAccount を COM 経由でセット (出図EXE と同手法)。
    mail._oleobj_.Invoke(*(64209, 0, 8, 0, account))

    mail.To = "; ".join(m["email"] for m in to_list if m["email"])
    mail.CC = "; ".join(m["email"] for m in cc_list if m["email"])
    mail.Subject = subject
    mail.Body = body

    if attachments:
        for path in attachments:
            if not os.path.isfile(path):
                raise RuntimeError(f"添付ファイルが見つかりません:\n{path}")
            # 位置引数で渡す (Source= キーワード渡しは pywin32 の版差で
            # 例外なく無添付になることがあるため避ける)。
            mail.Attachments.Add(path)
        if int(mail.Attachments.Count) < len(attachments):
            raise RuntimeError(
                "添付ファイルの追加に失敗しました (Outlook に拒否された可能性があります)。"
            )

    if send_immediately:
        mail.Send()
    else:
        mail.Display(False)
