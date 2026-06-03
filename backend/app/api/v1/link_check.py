from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.axis import Axis
from app.services.audit import client_actor, write_action_log
from app.services.link_check import run_link_check_for_axis

# Phase D: フロント「再チェック」ボタン用の即時リンク確認 API。
# 既存のスケジューラ (1時間ごと) の代わりに、当該軸のファイルだけ即時に is_file() 確認し、
# link_check_results に新規行を挿入する。

router = APIRouter()


@router.post("/axis/{axis_id}/recheck")
async def recheck_axis(
    axis_id: int, request: Request, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """軸限定の即時リンクチェック。

    対象: 当該軸の versions / related_docs / parts_list_versions / pdf_replacements
    レスポンス: { checked: int, ok: int, missing: int }
    """
    axis = await db.get(Axis, axis_id)
    if axis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="軸が見つかりません"
        )
    result = await run_link_check_for_axis(db, axis_id)

    # H-1: 監査ログ (commit 前に追記。下の db.commit() で監査も一緒にコミットされる)
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="link_check.run",
        job_id=axis.job_id,
        axis_id=axis_id,
        payload={
            "axis_id": axis_id,
            "checked": result.get("checked", 0),
            "missing": result.get("missing", 0),
        },
    )
    await db.commit()
    return result
