from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.db import get_db
from app.models.axis import Axis
from app.models.axis_phase_stamp import AxisPhaseStamp
from app.models.progress import AxisProgress, ProgressStep
from app.models.worker import Worker
from app.schemas.axis_phase_stamp import (
    AxisPhaseStampRead,
    AxisStampApply,
    AxisStampDueDateUpdate,
)
from app.services.audit import client_actor, write_action_log

# Phase N-2: 軸単位の電子データネーム印 API。
# Phase N (job_phase_stamps) は工番単位だったが、ユーザ要件で軸単位に拡張するため
# 新ルーターを追加した。旧 /v1/jobs/{job_id}/phase-stamps はデータ保持のため残し、
# UI からは本ルーターだけを叩く。

router = APIRouter()


def _serialize(stamp: AxisPhaseStamp, worker: Worker | None) -> AxisPhaseStampRead:
    return AxisPhaseStampRead(
        step_id=stamp.step_id,
        worker_id=stamp.worker_id,
        worker_name=worker.name if worker else None,
        worker_department=worker.department if worker else None,
        stamp_color=worker.stamp_color if worker else None,
        stamped_at=stamp.stamped_at,
        due_date=stamp.due_date,
    )


async def _get_or_create_stamp(
    db: AsyncSession, axis_id: int, step_id: int
) -> AxisPhaseStamp:
    """(axis_id, step_id) の行を取得。無ければ空 (worker/stamped_at NULL) で作成。"""
    row = (
        await db.execute(
            select(AxisPhaseStamp).where(
                AxisPhaseStamp.axis_id == axis_id,
                AxisPhaseStamp.step_id == step_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = AxisPhaseStamp(axis_id=axis_id, step_id=step_id)
        db.add(row)
        await db.flush()
    return row


async def _sync_axis_progress(
    db: AsyncSession, axis_id: int, step_id: int, state: str
) -> None:
    """対象軸 1 件のみ axis_progress.state を更新 (他軸には影響させない)。

    行が無ければ新規作成。Phase N の `_sync_axis_progress_for_step` (全軸一括)
    と異なり、当該軸 1 行に限定するのが軸単位の本ルーターのポイント。
    """
    now = datetime.now()
    ap = (
        await db.execute(
            select(AxisProgress).where(
                AxisProgress.axis_id == axis_id,
                AxisProgress.step_id == step_id,
            )
        )
    ).scalar_one_or_none()
    if ap is None:
        ap = AxisProgress(axis_id=axis_id, step_id=step_id, state=state)
        db.add(ap)
    else:
        ap.state = state
    if state == "done" and ap.done_at is None:
        ap.done_at = now
    if state == "notstarted":
        ap.done_at = None
        ap.started_at = None
    await db.flush()


async def _load_axis(db: AsyncSession, axis_id: int) -> Axis:
    axis = await db.get(Axis, axis_id)
    if axis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="軸が見つかりません"
        )
    return axis


async def _load_step(db: AsyncSession, step_id: int) -> ProgressStep:
    step = await db.get(ProgressStep, step_id)
    if step is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="工程が見つかりません"
        )
    return step


@router.get("/{axis_id}/phase-stamps", response_model=list[AxisPhaseStampRead])
async def list_axis_phase_stamps(
    axis_id: int, db: AsyncSession = Depends(get_db)
) -> list[AxisPhaseStampRead]:
    await _load_axis(db, axis_id)
    stmt = (
        select(AxisPhaseStamp)
        .where(AxisPhaseStamp.axis_id == axis_id)
        .options(selectinload(AxisPhaseStamp.worker))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialize(r, r.worker) for r in rows]


@router.post(
    "/{axis_id}/phase-stamps",
    response_model=AxisPhaseStampRead,
    status_code=status.HTTP_201_CREATED,
)
async def apply_axis_stamp(
    axis_id: int,
    body: AxisStampApply,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AxisPhaseStampRead:
    """指定軸の工程に「今日の日付で押印」+ 該当軸の axis_progress を done に同期。"""
    axis = await _load_axis(db, axis_id)
    await _load_step(db, body.step_id)
    worker = await db.get(Worker, body.worker_id)
    if worker is None or not worker.active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="作業者が見つからないか無効化されています",
        )

    row = await _get_or_create_stamp(db, axis_id, body.step_id)
    row.worker_id = worker.id
    row.stamped_at = datetime.now().date()
    await db.flush()

    # 該当軸のみ done に同期 (Phase N と違い、他軸は変更しない)
    await _sync_axis_progress(db, axis_id, body.step_id, "done")

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="axis_phase_stamp.apply",
        job_id=axis.job_id,
        payload={
            "axis_id": axis_id,
            "step_id": body.step_id,
            "worker_id": worker.id,
            "worker_name": worker.name,
        },
    )
    return _serialize(row, worker)


@router.delete(
    "/{axis_id}/phase-stamps/{step_id}", response_model=AxisPhaseStampRead
)
async def cancel_axis_stamp(
    axis_id: int,
    step_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AxisPhaseStampRead:
    """押印取消。worker_id/stamped_at を NULL に戻し、該当軸のみ notstarted へ。

    行自体は削除しない (CLAUDE.md §2.1 整合)、due_date は残す。
    """
    axis = await _load_axis(db, axis_id)
    await _load_step(db, step_id)
    row = (
        await db.execute(
            select(AxisPhaseStamp)
            .where(
                AxisPhaseStamp.axis_id == axis_id,
                AxisPhaseStamp.step_id == step_id,
            )
            .options(selectinload(AxisPhaseStamp.worker))
        )
    ).scalar_one_or_none()
    if row is None or row.worker_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="押印レコードが見つかりません",
        )
    prev_worker_id = row.worker_id
    row.worker_id = None
    row.stamped_at = None
    await db.flush()

    await _sync_axis_progress(db, axis_id, step_id, "notstarted")

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="axis_phase_stamp.cancel",
        job_id=axis.job_id,
        payload={
            "axis_id": axis_id,
            "step_id": step_id,
            "previous_worker_id": prev_worker_id,
        },
    )
    return _serialize(row, None)


@router.patch(
    "/{axis_id}/phase-stamps/{step_id}/due-date",
    response_model=AxisPhaseStampRead,
)
async def set_axis_due_date(
    axis_id: int,
    step_id: int,
    body: AxisStampDueDateUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AxisPhaseStampRead:
    """期日のみ更新 (押印無しでもレコード作成)。"""
    axis = await _load_axis(db, axis_id)
    await _load_step(db, step_id)

    row = await _get_or_create_stamp(db, axis_id, step_id)
    row.due_date = body.due_date
    await db.flush()

    worker: Worker | None = None
    if row.worker_id is not None:
        worker = await db.get(Worker, row.worker_id)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="axis_phase_stamp.set_due_date",
        job_id=axis.job_id,
        payload={
            "axis_id": axis_id,
            "step_id": step_id,
            "due_date": body.due_date.isoformat() if body.due_date else None,
        },
    )
    return _serialize(row, worker)
