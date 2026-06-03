from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.pdf_rotation import PdfRotation
from app.models.version import Version
from app.schemas.pdf_rotation import (
    PdfRotationRead,
    PdfRotationsReplaceRequest,
)
from app.services.audit import client_actor, write_action_log

# Phase O: PDF の表示回転メタ。
# `buildComposite` で新 PDF を作って永続化する方式は履歴を肥大化させるため、
# 回転 (旋回ページの向き合わせ) だけはこの軽量テーブルで保持する。
router = APIRouter()


@router.get("/{version_id}/rotations", response_model=list[PdfRotationRead])
async def list_rotations(
    version_id: int, db: AsyncSession = Depends(get_db)
) -> list[PdfRotationRead]:
    v = await db.get(Version, version_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="バージョンが見つかりません"
        )
    rows = (
        await db.execute(
            select(PdfRotation)
            .where(PdfRotation.version_id == version_id)
            .order_by(PdfRotation.page_index)
        )
    ).scalars().all()
    return [
        PdfRotationRead(page_index=r.page_index, rotation=r.rotation) for r in rows
    ]


@router.put("/{version_id}/rotations", response_model=list[PdfRotationRead])
async def replace_rotations(
    version_id: int,
    body: PdfRotationsReplaceRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> list[PdfRotationRead]:
    """指定バージョンの回転メタ列をリクエスト内容で全置換。

    - body.rotations に含まれない page_index は削除
    - rotation == 0 のページも (リクエストに含まれていれば) 通常は省くべき
      だが、ここでは含まれていれば 0 で更新するだけ。0 のレコードを残す/消すの
      判断はクライアント側に任せる
    """
    v = await db.get(Version, version_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="バージョンが見つかりません"
        )

    # rotation の値は 0/90/180/270 だけ許可
    for it in body.rotations:
        if it.rotation not in (0, 90, 180, 270):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"rotation は 0/90/180/270 のいずれかである必要があります (got {it.rotation})",
            )

    # 既存行を取得
    existing = (
        await db.execute(
            select(PdfRotation).where(PdfRotation.version_id == version_id)
        )
    ).scalars().all()
    existing_by_page = {r.page_index: r for r in existing}

    incoming_pages: set[int] = set()
    for it in body.rotations:
        incoming_pages.add(it.page_index)
        cur = existing_by_page.get(it.page_index)
        if cur is None:
            db.add(
                PdfRotation(
                    version_id=version_id,
                    page_index=it.page_index,
                    rotation=it.rotation,
                )
            )
        else:
            cur.rotation = it.rotation

    # 送られなかった page_index は削除
    pages_to_remove = [p for p in existing_by_page.keys() if p not in incoming_pages]
    if pages_to_remove:
        await db.execute(
            delete(PdfRotation).where(
                PdfRotation.version_id == version_id,
                PdfRotation.page_index.in_(pages_to_remove),
            )
        )

    await db.flush()

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="pdf_rotation.replace",
        payload={
            "version_id": version_id,
            "count": len(body.rotations),
            "removed": pages_to_remove,
        },
    )

    rows = (
        await db.execute(
            select(PdfRotation)
            .where(PdfRotation.version_id == version_id)
            .order_by(PdfRotation.page_index)
        )
    ).scalars().all()
    return [
        PdfRotationRead(page_index=r.page_index, rotation=r.rotation) for r in rows
    ]
