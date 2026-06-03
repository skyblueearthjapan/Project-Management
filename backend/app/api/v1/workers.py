from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.worker import Worker
from app.schemas.worker import WorkerCreate, WorkerRead, WorkerUpdate
from app.services.audit import client_actor, write_action_log

router = APIRouter()


@router.get("", response_model=list[WorkerRead])
async def list_workers(
    include_inactive: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> list[WorkerRead]:
    stmt = select(Worker).order_by(Worker.name)
    if not include_inactive:
        stmt = stmt.where(Worker.active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [WorkerRead.model_validate(r) for r in rows]


@router.post("", response_model=WorkerRead, status_code=status.HTTP_201_CREATED)
async def create_worker(
    body: WorkerCreate, request: Request, db: AsyncSession = Depends(get_db)
) -> WorkerRead:
    # 同名の active worker が既にあれば 409 (同姓は dept 指定で区別する想定)
    # department は NULL 可能なので等価比較ではなく IS NOT DISTINCT FROM 相当を使う。
    if body.department is None:
        dept_pred = Worker.department.is_(None)
    else:
        dept_pred = Worker.department == body.department
    existing = (
        await db.execute(
            select(Worker).where(
                Worker.name == body.name,
                dept_pred,
                Worker.active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="同じ名前/所属の作業者が既に登録されています",
        )
    w = Worker(**body.model_dump())
    db.add(w)
    await db.flush()
    await db.refresh(w)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="worker.create",
        payload={"worker_id": w.id, "name": w.name, "department": w.department},
    )
    return WorkerRead.model_validate(w)


@router.patch("/{worker_id}", response_model=WorkerRead)
async def update_worker(
    worker_id: int,
    body: WorkerUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> WorkerRead:
    w = await db.get(Worker, worker_id)
    if w is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="作業者が見つかりません"
        )
    payload = body.model_dump(exclude_unset=True)
    for k, v in payload.items():
        setattr(w, k, v)
    await db.flush()
    await db.refresh(w)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="worker.update",
        payload={"worker_id": w.id, "changes": payload},
    )
    return WorkerRead.model_validate(w)
