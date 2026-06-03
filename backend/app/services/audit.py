from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.action import ActionLog


def client_actor(request: Request) -> str:
    """リクエスト元のクライアント識別子 (IP) を返す。

    認証なし環境では IP しか取れないため、社内 LAN 内の発信元 IP を actor として残す。
    取得失敗時は "unknown" を返す (ActionLog.actor は nullable だが、空にせず明示する)。
    """
    if request.client is not None and request.client.host:
        return request.client.host
    return "unknown"


async def write_action_log(
    db: AsyncSession,
    *,
    actor: str,
    action_type: str,
    job_id: str | None = None,
    axis_id: int | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """監査ログを 1 行追記する。commit は呼出元 (get_db dependency) に任せる。

    PII / メール本文は payload に含めない (呼出側でフィルタする責任)。
    """
    db.add(
        ActionLog(
            actor=actor,
            action_type=action_type,
            job_id=job_id,
            axis_id=axis_id,
            payload=payload,
        )
    )
