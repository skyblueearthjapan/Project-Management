"""出図のお知らせ × DOVE連携ルーター (DESIGN §2)。

- POST /shutsuzu/register             … 合成登録 (冪等)
- GET  /shutsuzu/jobs/{job_id}/instructions       … 工番別指示書 一覧 (active)
- POST /shutsuzu/jobs/{job_id}/instructions       … 工番別指示書 パス参照登録
- DELETE /shutsuzu/jobs/{job_id}/instructions/{id} … 工番別指示書 ソフトデリート

認証は不要 (api_router の enforce_lan_only で LAN 限定)。actor は発信元 IP。
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.job import Job
from app.models.job_instruction import JobInstruction
from app.schemas.shutsuzu import (
    JobInstructionCreate,
    JobInstructionRead,
    ShutsuzuRegisterIn,
    ShutsuzuRegisterOut,
)
from app.services.audit import client_actor, write_action_log
from app.services.shutsuzu import register_shutsuzu

router = APIRouter()

# 工番フォーマット制約 (Path Traversal 防止 / Job.id String(32) 整合)。
_JOB_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,32}$")


def _validate_job_id(job_id: str) -> str:
    if not _JOB_ID_RE.match(job_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="job_id の書式が不正です",
        )
    return job_id


@router.post("/register", response_model=ShutsuzuRegisterOut)
async def register(
    body: ShutsuzuRegisterIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ShutsuzuRegisterOut:
    """出図のお知らせをまとめて登録する (Job/Axis/Version/DXF/指示書/送信ログ)。

    1 リクエスト = 1 トランザクション。失敗時は get_db dependency が全ロールバックする。
    """
    return await register_shutsuzu(db, body, client_actor(request))


@router.get(
    "/jobs/{job_id}/instructions",
    response_model=list[JobInstructionRead],
)
async def list_instructions(
    job_id: str, db: AsyncSession = Depends(get_db)
) -> list[JobInstructionRead]:
    """工番別指示書の active 行を created_at DESC で一覧する。"""
    _validate_job_id(job_id)
    rows = (
        (
            await db.execute(
                select(JobInstruction)
                .where(JobInstruction.job_id == job_id)
                .where(JobInstruction.deleted_at.is_(None))
                .order_by(JobInstruction.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [JobInstructionRead.model_validate(r) for r in rows]


@router.post(
    "/jobs/{job_id}/instructions",
    response_model=JobInstructionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_instruction(
    job_id: str,
    body: JobInstructionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> JobInstructionRead:
    """工番別指示書を「既存ファイルへのパス参照」として 1 件登録する。

    実ファイルへの書き込みは行わない (CLAUDE.md §2.2)。
    """
    _validate_job_id(job_id)
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工番が見つかりません")

    instruction = JobInstruction(
        job_id=job_id,
        file_path=body.file_path,
        original_name=body.original_name,
        note=body.note,
        created_by="api",
    )
    db.add(instruction)
    await db.flush()
    await db.refresh(instruction)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="job_instruction.create",
        job_id=job_id,
        payload={"job_id": job_id, "file_path": instruction.file_path},
    )
    return JobInstructionRead.model_validate(instruction)


@router.delete(
    "/jobs/{job_id}/instructions/{instruction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def soft_delete_instruction(
    job_id: str,
    instruction_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """工番別指示書をソフトデリート (deleted_at に NOW() を立てる)。

    実ファイルは絶対に削除しない (CLAUDE.md §2.1)。既に削除済みの行は 404。
    """
    _validate_job_id(job_id)
    instruction = await db.get(JobInstruction, instruction_id)
    if instruction is None or instruction.job_id != job_id or instruction.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="工番別指示書が見つかりません"
        )
    instruction.deleted_at = datetime.now(UTC)
    await db.flush()

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="job_instruction.soft_delete",
        job_id=job_id,
        payload={
            "job_id": job_id,
            "instruction_id": instruction_id,
            "file_path": instruction.file_path,
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
