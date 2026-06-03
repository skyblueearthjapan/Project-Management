from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.contact import Contact
from app.models.progress import ProgressStep
from app.models.system import User
from app.services.audit import client_actor, write_action_log
from app.services.importers.excel import sync_master_excel
from app.schemas.admin import (
    ContactRead,
    ContactUpsert,
    ProgressStepUpsert,
    UserRead,
    UserUpsert,
)
from app.schemas.axis import ProgressStepRead

router = APIRouter()


@router.post("/master/sync")
async def trigger_master_sync(db: AsyncSession = Depends(get_db)) -> dict:
    """工番マスタ Excel の手動同期 (Phase1 + Phase2)。"""
    return await sync_master_excel(db)


# ---- contacts ----
@router.get("/contacts", response_model=list[ContactRead])
async def list_contacts(
    include_inactive: bool = False, db: AsyncSession = Depends(get_db)
) -> list[ContactRead]:
    stmt = select(Contact).order_by(Contact.name)
    if not include_inactive:
        stmt = stmt.where(Contact.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [ContactRead.model_validate(r) for r in rows]


@router.put("/contacts/{contact_id}", response_model=ContactRead)
async def upsert_contact(
    contact_id: int, body: ContactUpsert, db: AsyncSession = Depends(get_db)
) -> ContactRead:
    c = await db.get(Contact, contact_id) if contact_id > 0 else None
    if c is None:
        c = Contact(**body.model_dump())
        db.add(c)
    else:
        for k, v in body.model_dump().items():
            setattr(c, k, v)
    await db.flush()
    return ContactRead.model_validate(c)


@router.post("/contacts", response_model=ContactRead, status_code=status.HTTP_201_CREATED)
async def create_contact(
    body: ContactUpsert, request: Request, db: AsyncSession = Depends(get_db)
) -> ContactRead:
    existing = (
        await db.execute(select(Contact).where(Contact.email == body.email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="同じメールアドレスが既に存在します"
        )
    c = Contact(**body.model_dump())
    db.add(c)
    await db.flush()
    await db.refresh(c)

    # H-1: 監査ログ (連絡先マスタ追加。email は PII だが業務上 actor が知るべき情報なので残す)
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="admin.contact.create",
        payload={"contact_id": c.id, "name": c.name, "email": c.email},
    )
    return ContactRead.model_validate(c)


# ---- users (社員) ----
@router.get("/users", response_model=list[UserRead])
async def list_users(
    include_inactive: bool = False, db: AsyncSession = Depends(get_db)
) -> list[UserRead]:
    stmt = select(User).order_by(User.code)
    if not include_inactive:
        stmt = stmt.where(User.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [UserRead.model_validate(r) for r in rows]


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserUpsert, request: Request, db: AsyncSession = Depends(get_db)
) -> UserRead:
    existing = (
        await db.execute(select(User).where(User.code == body.code))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="同じユーザーコードが既に存在します"
        )
    u = User(**body.model_dump())
    db.add(u)
    await db.flush()
    await db.refresh(u)

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="admin.user.create",
        payload={"user_id": u.id, "code": u.code, "display_name": u.display_name},
    )
    return UserRead.model_validate(u)


@router.put("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int, body: UserUpsert, db: AsyncSession = Depends(get_db)
) -> UserRead:
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ユーザーが見つかりません")
    for k, v in body.model_dump().items():
        setattr(u, k, v)
    await db.flush()
    return UserRead.model_validate(u)


# ---- progress steps ----
@router.get("/progress-steps", response_model=list[ProgressStepRead])
async def list_progress_steps(db: AsyncSession = Depends(get_db)) -> list[ProgressStepRead]:
    rows = (
        await db.execute(select(ProgressStep).order_by(ProgressStep.sort_order))
    ).scalars().all()
    return [ProgressStepRead.model_validate(r) for r in rows]


@router.put("/progress-steps/{step_id}", response_model=ProgressStepRead)
async def update_progress_step(
    step_id: int,
    body: ProgressStepUpsert,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ProgressStepRead:
    s = await db.get(ProgressStep, step_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工程が見つかりません")
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    await db.flush()

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="admin.progress_step.update",
        payload={"step_id": s.id, "code": s.code, "name": s.name},
    )
    return ProgressStepRead.model_validate(s)
