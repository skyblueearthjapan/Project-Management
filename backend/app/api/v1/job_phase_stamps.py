from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.db import get_db
from app.models.axis import Axis
from app.models.job import Job
from app.models.job_phase_stamp import JobPhaseStamp
from app.models.progress import AxisProgress, ProgressStep
from app.models.worker import Worker
from app.schemas.job_phase_stamp import (
    PhaseStampRead,
    StampApply,
    StampDueDateUpdate,
)
from app.services.audit import client_actor, write_action_log

router = APIRouter()


def _serialize(stamp: JobPhaseStamp, worker: Worker | None) -> PhaseStampRead:
    return PhaseStampRead(
        step_id=stamp.step_id,
        worker_id=stamp.worker_id,
        worker_name=worker.name if worker else None,
        worker_department=worker.department if worker else None,
        stamp_color=worker.stamp_color if worker else None,
        stamped_at=stamp.stamped_at,
        due_date=stamp.due_date,
    )


async def _get_or_create_stamp(
    db: AsyncSession, job_id: str, step_id: int
) -> JobPhaseStamp:
    """(job_id, step_id) の行を取得。無ければ空 (worker/stamped_at NULL) で作成。"""
    row = (
        await db.execute(
            select(JobPhaseStamp).where(
                JobPhaseStamp.job_id == job_id,
                JobPhaseStamp.step_id == step_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = JobPhaseStamp(job_id=job_id, step_id=step_id)
        db.add(row)
        await db.flush()
    return row


async def _sync_axis_progress_for_step(
    db: AsyncSession, job_id: str, step_id: int, state: str
) -> None:
    """指定 (job, step) に紐づく全軸の axis_progress.state を一括同期する。

    axis_progress 行が存在しない軸については新規作成する。
    """
    now = datetime.now()
    axes = (
        await db.execute(select(Axis).where(Axis.job_id == job_id))
    ).scalars().all()
    for axis in axes:
        ap = (
            await db.execute(
                select(AxisProgress).where(
                    AxisProgress.axis_id == axis.id,
                    AxisProgress.step_id == step_id,
                )
            )
        ).scalar_one_or_none()
        if ap is None:
            ap = AxisProgress(axis_id=axis.id, step_id=step_id, state=state)
            db.add(ap)
        else:
            ap.state = state
        if state == "done" and ap.done_at is None:
            ap.done_at = now
        if state == "notstarted":
            ap.done_at = None
            ap.started_at = None
    await db.flush()


async def _ensure_job_exists(db: AsyncSession, job_id: str) -> None:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="工番が見つかりません"
        )


async def _load_step(db: AsyncSession, step_id: int) -> ProgressStep:
    step = await db.get(ProgressStep, step_id)
    if step is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="工程が見つかりません"
        )
    return step


@router.get("/{job_id}/phase-stamps", response_model=list[PhaseStampRead])
async def list_phase_stamps(
    job_id: str, db: AsyncSession = Depends(get_db)
) -> list[PhaseStampRead]:
    await _ensure_job_exists(db, job_id)
    stmt = (
        select(JobPhaseStamp)
        .where(JobPhaseStamp.job_id == job_id)
        .options(selectinload(JobPhaseStamp.worker))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialize(r, r.worker) for r in rows]


@router.post(
    "/{job_id}/phase-stamps",
    response_model=PhaseStampRead,
    status_code=status.HTTP_201_CREATED,
)
async def apply_stamp(
    job_id: str,
    body: StampApply,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PhaseStampRead:
    """指定工程に「今日の日付で押印」+ 同工程の全 axis_progress を done に同期。"""
    await _ensure_job_exists(db, job_id)
    await _load_step(db, body.step_id)
    worker = await db.get(Worker, body.worker_id)
    if worker is None or not worker.active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="作業者が見つからないか無効化されています",
        )

    row = await _get_or_create_stamp(db, job_id, body.step_id)
    row.worker_id = worker.id
    row.stamped_at = datetime.now().date()
    await db.flush()

    # 全軸の axis_progress を done に同期
    await _sync_axis_progress_for_step(db, job_id, body.step_id, "done")

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="phase_stamp.apply",
        job_id=job_id,
        payload={
            "job_id": job_id,
            "step_id": body.step_id,
            "worker_id": worker.id,
            "worker_name": worker.name,
        },
    )
    return _serialize(row, worker)


@router.delete("/{job_id}/phase-stamps/{step_id}", response_model=PhaseStampRead)
async def cancel_stamp(
    job_id: str,
    step_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PhaseStampRead:
    """押印の取消。worker_id / stamped_at を NULL に戻す + 全軸を notstarted へ。

    行自体は削除せず (CLAUDE.md §2.1 整合)、due_date は残す。
    """
    await _ensure_job_exists(db, job_id)
    await _load_step(db, step_id)
    row = (
        await db.execute(
            select(JobPhaseStamp)
            .where(
                JobPhaseStamp.job_id == job_id,
                JobPhaseStamp.step_id == step_id,
            )
            .options(selectinload(JobPhaseStamp.worker))
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

    # 全軸を notstarted に戻す
    await _sync_axis_progress_for_step(db, job_id, step_id, "notstarted")

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="phase_stamp.cancel",
        job_id=job_id,
        payload={
            "job_id": job_id,
            "step_id": step_id,
            "previous_worker_id": prev_worker_id,
        },
    )
    # 再読込で最新値を返す (worker は NULL なので color などは None)
    return _serialize(row, None)


@router.patch(
    "/{job_id}/phase-stamps/{step_id}/due-date", response_model=PhaseStampRead
)
async def set_due_date(
    job_id: str,
    step_id: int,
    body: StampDueDateUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PhaseStampRead:
    """期日のみ更新 (押印無しでもレコードは作成)。"""
    await _ensure_job_exists(db, job_id)
    await _load_step(db, step_id)

    row = await _get_or_create_stamp(db, job_id, step_id)
    row.due_date = body.due_date
    await db.flush()

    # worker JOIN で印影色等を埋めて返す
    worker: Worker | None = None
    if row.worker_id is not None:
        worker = await db.get(Worker, row.worker_id)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="phase_stamp.set_due_date",
        job_id=job_id,
        payload={
            "job_id": job_id,
            "step_id": step_id,
            "due_date": body.due_date.isoformat() if body.due_date else None,
        },
    )
    return _serialize(row, worker)
