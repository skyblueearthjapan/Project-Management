"""Outlook COM ラッパ。Windows + Outlook がインストールされている環境でのみ動作。"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Iterable

# pywin32 は Windows 専用。CI Linux でも import が落ちないよう遅延 import する。
if sys.platform == "win32":
    import pythoncom
    import win32com.client
else:  # pragma: no cover - 非 Windows では Outlook 連携自体が無効
    pythoncom = None  # type: ignore[assignment]
    win32com = None  # type: ignore[assignment]


@dataclass
class Recipient:
    kind: str  # "to" | "cc" | "bcc"
    email: str
    name: str | None = None


def _format_addr(r: Recipient) -> str:
    return f"{r.name} <{r.email}>" if r.name else r.email


def send_via_outlook(
    subject: str,
    body: str,
    recipients: Iterable[Recipient],
    attachments: Iterable[str] = (),
    display_only: bool = False,
) -> dict[str, str]:
    """既定の Outlook プロファイルからメールを送信する (または下書きとして表示)。

    `display_only=True` の場合は送信せず Outlook 上に下書きを開く。
    """
    if sys.platform != "win32":
        raise RuntimeError("Outlook 連携は Windows 専用です")

    pythoncom.CoInitialize()
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)  # 0 = olMailItem
        mail.Subject = subject
        mail.Body = body

        to_list = [_format_addr(r) for r in recipients if r.kind == "to"]
        cc_list = [_format_addr(r) for r in recipients if r.kind == "cc"]
        bcc_list = [_format_addr(r) for r in recipients if r.kind == "bcc"]
        if to_list:
            mail.To = "; ".join(to_list)
        if cc_list:
            mail.CC = "; ".join(cc_list)
        if bcc_list:
            mail.BCC = "; ".join(bcc_list)

        for path in attachments:
            mail.Attachments.Add(Source=path)

        if display_only:
            mail.Display(False)  # 非モーダル表示
            return {"status": "displayed"}

        mail.Send()
        return {"status": "sent"}
    finally:
        pythoncom.CoUninitialize()
