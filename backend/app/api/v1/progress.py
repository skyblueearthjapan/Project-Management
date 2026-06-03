from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.axis import Axis
from app.models.progress import AxisProgress, ProgressStep
from app.schemas.axis import ProgressStepRead, ProgressUpdate
from app.services.audit import client_actor, write_action_log

router = APIRouter()


@router.get("/steps", response_model=list[ProgressStepRead])
async def list_steps(db: AsyncSession = Depends(get_db)) -> list[ProgressStepRead]:
    rows = (
        await db.execute(select(ProgressStep).order_by(ProgressStep.sort_order))
    ).scalars().all()
    return [ProgressStepRead.model_validate(r) for r in rows]


@router.patch("/{axis_id}/{step_code}")
async def update_progress(
    axis_id: int,
    step_code: str,
    body: ProgressUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    step = (
        await db.execute(select(ProgressStep).where(ProgressStep.code == step_code))
    ).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工程コードが不正です")
    progress = (
        await db.execute(
            select(AxisProgress).where(
                AxisProgress.axis_id == axis_id, AxisProgress.step_id == step.id
            )
        )
    ).scalar_one_or_none()
    if progress is None:
        progress = AxisProgress(axis_id=axis_id, step_id=step.id, state=body.state)
        db.add(progress)
    else:
        progress.state = body.state
    now = datetime.now()
    if body.state == "inprogress" and progress.started_at is None:
        progress.started_at = now
    if body.state == "done":
        progress.done_at = now
    progress.updated_by = body.updated_by
    await db.flush()

    # H-1: 監査ログ。job_id は axis から逆引き (失敗しても監査自体は止めない)。
    axis_job_id: str | None = None
    axis = await db.get(Axis, axis_id)
    if axis is not None:
        axis_job_id = axis.job_id
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="progress.update",
        job_id=axis_job_id,
        axis_id=axis_id,
        payload={
            "axis_id": axis_id,
            "step_code": step_code,
            "state": body.state,
            "by": body.updated_by,
        },
    )
    return {"axis_id": axis_id, "step_code": step_code, "state": body.state}
