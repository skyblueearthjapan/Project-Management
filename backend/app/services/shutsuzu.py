"""出図のお知らせ × DOVE連携: 合成登録のオーケストレーション (DESIGN §2.1)。

1 リクエスト = 1 DB トランザクション (commit は get_db dependency に委譲、
失敗時は呼出側 / dependency が全ロールバック)。

不変条件 (CLAUDE.md §2.1 / §2.2):
  - すべてパス参照のみ。ファイルの copy/move/delete/overwrite/rename を行わない。
  - os.* / shutil.* / Path.rename 等の削除・改名関数を一切登場させない。
  - メール本文 / PII は action_logs payload に入れない。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import resolve_under
from app.models.axis import Axis
from app.models.dxf import DxfFile
from app.models.job import Job
from app.models.job_instruction import JobInstruction
from app.models.job_master import JobMasterCache
from app.models.mail import MailLog, MailLogRecipient
from app.models.progress import AxisProgress, ProgressStep
from app.models.version import Version
from app.schemas.shutsuzu import (
    ShutsuzuAxisIn,
    ShutsuzuAxisResult,
    ShutsuzuMailIn,
    ShutsuzuRegisterIn,
    ShutsuzuRegisterOut,
)
from app.services.audit import write_action_log

log = logging.getLogger(__name__)


async def register_shutsuzu(
    db: AsyncSession, body: ShutsuzuRegisterIn, actor: str
) -> ShutsuzuRegisterOut:
    """出図のお知らせをまとめて DOVE に登録する (冪等)。"""
    warnings: list[str] = []

    job, job_created = await _get_or_create_job(db, body)

    axis_results: list[ShutsuzuAxisResult] = []
    for axis_in in body.axes:
        axis_results.append(await _register_axis(db, job.id, axis_in, body.released_by, warnings))

    instruction_id, instruction_created = await _register_instruction(db, body)
    mail_log_id = await _register_mail_log(db, body)

    await write_action_log(
        db,
        actor=actor,
        action_type="shutsuzu.register",
        job_id=job.id,
        payload={
            "job_id": job.id,
            "kubun": body.kubun,
            "job_created": job_created,
            "axis_count": len(axis_results),
            "instruction_created": instruction_created,
            "mail_logged": mail_log_id is not None,
        },
    )

    return ShutsuzuRegisterOut(
        job_id=job.id,
        job_created=job_created,
        axes=axis_results,
        instruction_id=instruction_id,
        instruction_created=instruction_created,
        mail_log_id=mail_log_id,
        warnings=warnings,
    )


async def _get_or_create_job(db: AsyncSession, body: ShutsuzuRegisterIn) -> tuple[Job, bool]:
    """工番を get-or-create。既存 Job は上書きしない (冪等キー = job_id)。

    新規作成は savepoint で包み、PK 競合 (初回同時作成・再試行レース) の
    IntegrityError は savepoint をロールバックして再取得し既存扱いにする
    (本体トランザクションは温存し、500 を返さない)。
    """
    job = await db.get(Job, body.job_id)
    if job is not None:
        return job, False

    master = await db.get(JobMasterCache, body.job_id)
    # title は master → request → job_id の順でフォールバック (NOT NULL のため必ず埋める)。
    title = (master.title if master else None) or body.title or body.job_id
    customer = (master.customer if master else None) or body.customer
    delivery_date = body.delivery_date or (master.delivery_date if master else None)

    try:
        async with db.begin_nested():
            job = Job(
                id=body.job_id,
                title=title,
                customer=customer,
                delivery_date=delivery_date,
            )
            db.add(job)
            await db.flush()
    except IntegrityError:
        # 競合で既に作られていた → 再取得して既存扱い。
        existing = (await db.execute(select(Job).where(Job.id == body.job_id))).scalar_one()
        return existing, False
    return job, True


async def _register_axis(
    db: AsyncSession,
    job_id: str,
    axis_in: ShutsuzuAxisIn,
    released_by: str | None,
    warnings: list[str],
) -> ShutsuzuAxisResult:
    axis, axis_created = await _get_or_create_axis(db, job_id, axis_in.name)

    version, version_created = await _upsert_version(
        db, axis.id, axis_in.drawing_pdf_path, axis_in.drawing_label, released_by
    )

    dxf_registered = 0
    dxf_skipped = 0
    dxf_warning: str | None = None
    if axis_in.dxf_folder_path:
        dxf_registered, dxf_skipped, dxf_warning = await _register_dxf_folder(
            db, axis.id, axis_in.dxf_folder_path
        )
        if dxf_warning is not None:
            # 当該 axis のみ warning 化し、全体は継続 (DESIGN §6-3)。
            warnings.append(f"[{axis_in.name}] {dxf_warning}")

    return ShutsuzuAxisResult(
        name=axis_in.name,
        axis_id=axis.id,
        axis_created=axis_created,
        version_id=version.id,
        version_created=version_created,
        dxf_registered=dxf_registered,
        dxf_skipped=dxf_skipped,
        dxf_warning=dxf_warning,
    )


async def _get_or_create_axis(db: AsyncSession, job_id: str, name: str) -> tuple[Axis, bool]:
    """軸を (job_id, name) で get-or-create。進捗 10 工程を初期化する。

    Unique 制約 (uq_axes_job_name) 違反は savepoint をロールバックして再取得する
    (本体トランザクションは温存)。
    """
    axis = (
        await db.execute(select(Axis).where(Axis.job_id == job_id, Axis.name == name))
    ).scalar_one_or_none()
    if axis is not None:
        return axis, False

    try:
        async with db.begin_nested():
            axis = Axis(job_id=job_id, name=name)
            db.add(axis)
            await db.flush()
    except IntegrityError:
        # 競合で既に作られていた → 再取得して既存扱い。
        axis = (
            await db.execute(select(Axis).where(Axis.job_id == job_id, Axis.name == name))
        ).scalar_one()
        return axis, False

    # 進捗工程 10 件を notstarted で初期化 (create_axis と同等)。
    steps = (await db.execute(select(ProgressStep))).scalars().all()
    db.add_all(AxisProgress(axis_id=axis.id, step_id=s.id, state="notstarted") for s in steps)
    await db.flush()
    return axis, True


async def _upsert_version(
    db: AsyncSession,
    axis_id: int,
    pdf_path: str,
    label: str | None,
    released_by: str | None,
) -> tuple[Version, bool]:
    """出図 PDF を (axis_id, pdf_path) active 一致で upsert。1軸 = PDF 1枚。"""
    existing = (
        await db.execute(
            select(Version)
            .where(
                Version.axis_id == axis_id,
                Version.pdf_path == pdf_path,
                Version.archived_at.is_(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    last_no = (
        await db.execute(
            select(Version.version_no)
            .where(Version.axis_id == axis_id)
            .order_by(Version.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    next_no = (last_no or 0) + 1

    version = Version(
        axis_id=axis_id,
        version_no=next_no,
        label=label,
        pdf_path=pdf_path,
        released_at=datetime.now(UTC),
        released_by=released_by,
    )
    db.add(version)
    await db.flush()
    return version, True


async def _register_dxf_folder(
    db: AsyncSession, axis_id: int, rel_folder: str
) -> tuple[int, int, str | None]:
    """フォルダ配下の `.dxf` を file_path 一致で冪等登録。

    フォルダ未存在 / パス不正 / 走査失敗 (SMB 断などの OSError) は当該 axis の
    warning とし、(registered, skipped, warning) を返す (全体トランザクションは継続)。
    実ファイルのコピー/移動は行わない (パス参照 INSERT のみ)。
    """
    settings = get_settings()
    try:
        abs_dir = resolve_under(settings.fileserver_root, rel_folder)
    except HTTPException:
        return 0, 0, f"DXFフォルダのパスが不正です: {rel_folder}"

    existing_paths = {
        p
        for (p,) in (
            await db.execute(select(DxfFile.file_path).where(DxfFile.axis_id == axis_id))
        ).all()
    }

    registered = 0
    skipped = 0
    try:
        if not abs_dir.is_dir():
            return 0, 0, f"DXFフォルダが見つかりません: {rel_folder}"
        for child in sorted(abs_dir.iterdir(), key=lambda p: p.name.lower()):
            if not child.is_file() or child.suffix.lower() != ".dxf":
                continue
            child_rel = f"{rel_folder}/{child.name}"
            if child_rel in existing_paths:
                skipped += 1
                continue
            try:
                size: int | None = child.stat().st_size
            except OSError:
                size = None
            db.add(
                DxfFile(
                    axis_id=axis_id,
                    file_path=child_rel,
                    size=size,
                    created_by="shutsuzu_agent",
                )
            )
            existing_paths.add(child_rel)
            registered += 1
    except OSError as e:
        # SMB 断などのフォルダ走査失敗は当該 axis の warning とし、全体は継続 (DESIGN §6-3)。
        if registered:
            await db.flush()
        return registered, skipped, f"DXFフォルダの走査に失敗しました ({rel_folder}): {e}"

    if registered:
        await db.flush()
    return registered, skipped, None


async def _register_instruction(
    db: AsyncSession, body: ShutsuzuRegisterIn
) -> tuple[int | None, bool]:
    """工番別指示書を (job_id, file_path) active 一致で upsert。"""
    rel = body.instruction_pdf_path
    if not rel:
        return None, False

    existing = (
        await db.execute(
            select(JobInstruction)
            .where(
                JobInstruction.job_id == body.job_id,
                JobInstruction.file_path == rel,
                JobInstruction.deleted_at.is_(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing.id, False

    instruction = JobInstruction(
        job_id=body.job_id,
        file_path=rel,
        original_name=body.instruction_original_name,
        created_by="shutsuzu_agent",
    )
    db.add(instruction)
    await db.flush()
    return instruction.id, True


async def _register_mail_log(db: AsyncSession, body: ShutsuzuRegisterIn) -> int | None:
    """送信ログを (job_id, subject, sent_at) 冪等キーで記録。"""
    mail: ShutsuzuMailIn | None = body.mail
    if mail is None:
        return None

    sent_at = mail.sent_at or datetime.now(UTC)
    existing = (
        await db.execute(
            select(MailLog)
            .where(
                MailLog.job_id == body.job_id,
                MailLog.subject == mail.subject,
                MailLog.sent_at == sent_at,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing.id

    mail_log = MailLog(
        job_id=body.job_id,
        subject=mail.subject,
        body=mail.body or "",
        method="agent",
        status="sent",
        sent_at=sent_at,
        sent_by=body.released_by,
    )
    db.add(mail_log)
    await db.flush()

    for recipient in mail.to:
        db.add(
            MailLogRecipient(
                mail_log_id=mail_log.id,
                kind="to",
                name=recipient.name,
                email=recipient.email,
            )
        )
    for recipient in mail.cc:
        db.add(
            MailLogRecipient(
                mail_log_id=mail_log.id,
                kind="cc",
                name=recipient.name,
                email=recipient.email,
            )
        )
    await db.flush()
    return mail_log.id
