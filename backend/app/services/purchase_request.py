"""購入部品追加依頼のオーケストレーション (DESIGN_購入部品追加依頼.md §2)。

1 リクエスト = 1 DB トランザクション (commit は get_db dependency に委譲、
失敗時は全ロールバック)。

不変条件 (CLAUDE.md §2.1 / §2.2):
  - アップロードは `/mnt/uploads` 配下への **新規作成のみ**
    (`services/uploads.save_uploaded_file` が `open(path, "xb")` で排他作成する)。
  - 依頼者 PC 上の元ファイルには一切触らない (読み取ってアップロードするだけ)。
  - 削除・改名関数 (`os.remove` / `Path.unlink` / `Path.rename` 等) を登場させない。
  - メール本文 / PII は action_logs payload に入れない (宛先は mail_log_recipients のみ)。
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.job import Job
from app.models.job_master import JobMasterCache
from app.models.mail import MailLog, MailLogRecipient
from app.models.purchase_request import PurchaseRequest, PurchaseRequestReply
from app.schemas.purchase_request import (
    PurchaseReplyCreate,
    PurchaseRequestCreate,
    PurchaseRequestRegisterOut,
    PurchaseRequestUpdate,
)
from app.services.audit import write_action_log
from app.services.uploads import save_uploaded_file

# 部品リスト Excel として受け付ける拡張子。
REQUEST_FILE_EXT = {".xlsx", ".xlsm", ".xls"}
REPLY_FILE_EXT = {".pdf"}

# 保存先ディレクトリに request_id を使うため、行を flush して id を確定させてから
# ファイルを保存する。その間だけ NOT NULL を満たすための仮値。
# 保存に失敗すればトランザクションごとロールバックされるため外部には漏れない。
_PENDING_PATH = "(pending)"


async def register_purchase_request(
    db: AsyncSession,
    body: PurchaseRequestCreate,
    upload: UploadFile,
    actor: str,
) -> PurchaseRequestRegisterOut:
    """依頼を登録する (冪等)。

    冪等キーは `client_request_id`。メール送信は成功したが登録が失敗した場合に、
    EXE がメールを再送せず登録だけ再試行しても重複を作らない。
    """
    warnings: list[str] = []

    existing = (
        await db.execute(
            select(PurchaseRequest).where(
                PurchaseRequest.client_request_id == body.client_request_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        # 再送。ファイルが未保存のまま残っている場合のみ補完する
        # (1 トランザクション構成なので通常は発生しないが、防御的に扱う)。
        if existing.request_file_path == _PENDING_PATH:
            await _store_request_file(db, existing, upload)
        return PurchaseRequestRegisterOut(
            id=existing.id,
            created=False,
            job_id=existing.job_id,
            job_created=False,
            job_unassigned=existing.job_id is None,
            branch_no=existing.branch_no,
            status=existing.status,
            request_file_path=existing.request_file_path,
            request_file_original_name=existing.request_file_original_name,
            mail_log_id=None,
            warnings=["同じ依頼が既に登録されていました (再送のため重複は作成していません)"],
        )

    job_created = False
    if body.job_id:
        _job, job_created = await _get_or_create_job(
            db,
            job_id=body.job_id,
            title=body.title,
            customer=body.customer,
            delivery_date=body.delivery_date,
        )

    request = PurchaseRequest(
        job_id=body.job_id,
        job_no_input=body.job_no_input,
        branch_no=body.branch_no,
        requester_account=body.requester_account,
        requester_name=body.requester_name,
        requester_email=body.requester_email,
        requested_at=body.requested_at or datetime.now(UTC),
        request_file_path=_PENDING_PATH,
        request_file_original_name=upload.filename or "部品リスト.xlsx",
        subject=body.subject,
        note=body.note,
        status="requested",
        client_request_id=body.client_request_id,
    )
    db.add(request)
    try:
        await db.flush()
    except IntegrityError:
        # 同一 client_request_id の同時登録レース。既存を再取得して冪等に返す。
        existing = (
            await db.execute(
                select(PurchaseRequest).where(
                    PurchaseRequest.client_request_id == body.client_request_id
                )
            )
        ).scalar_one()
        return PurchaseRequestRegisterOut(
            id=existing.id,
            created=False,
            job_id=existing.job_id,
            job_created=False,
            job_unassigned=existing.job_id is None,
            branch_no=existing.branch_no,
            status=existing.status,
            request_file_path=existing.request_file_path,
            request_file_original_name=existing.request_file_original_name,
            warnings=["同じ依頼が既に登録されていました (再送のため重複は作成していません)"],
        )

    await _store_request_file(db, request, upload)

    mail_log_id = await _register_mail_log(db, body, request)

    if body.job_id is None:
        warnings.append("工番未定の依頼として登録しました (後から工番を紐づけられます)")

    await write_action_log(
        db,
        actor=actor,
        action_type="purchase_request.register",
        job_id=body.job_id,
        payload={
            "request_id": request.id,
            "job_id": body.job_id,
            "branch_no": body.branch_no,
            "job_created": job_created,
            "requester_account": body.requester_account,
            "mail_logged": mail_log_id is not None,
        },
    )

    return PurchaseRequestRegisterOut(
        id=request.id,
        created=True,
        job_id=request.job_id,
        job_created=job_created,
        job_unassigned=request.job_id is None,
        branch_no=request.branch_no,
        status=request.status,
        request_file_path=request.request_file_path,
        request_file_original_name=request.request_file_original_name,
        mail_log_id=mail_log_id,
        warnings=warnings,
    )


async def _store_request_file(
    db: AsyncSession, request: PurchaseRequest, upload: UploadFile
) -> None:
    """部品リスト Excel を `/mnt/uploads/purchase/{request_id}/` へ排他作成で保存する。

    `request_id` 単位でディレクトリを分けるため、`部品リスト.xlsx` のような汎用名が
    何件来ても衝突しない。元ファイル名は表示用に DB へ残す。
    """
    _rel, rel_str, size = await save_uploaded_file(
        upload,
        sub_dir=Path("purchase") / str(request.id),
        allowed_ext=REQUEST_FILE_EXT,
    )
    request.request_file_path = rel_str
    request.request_file_size = size
    await db.flush()


async def _get_or_create_job(
    db: AsyncSession,
    *,
    job_id: str,
    title: str | None,
    customer: str | None,
    delivery_date: object | None,
) -> tuple[Job, bool]:
    """工番を get-or-create する。

    DOVE 未登録の工番が大多数 (登録済 22 件に対し日程表マスタは 100 件超) のため、
    購入依頼が工番作成の起点になり得る。新規作成時は `origin="purchase"` を立て、
    工番一覧・件数・検索から除外する (記録は残し、表示だけ抑える)。

    アーカイブ済み工番は **自動復活させない**。購入依頼は UI に出さない情報であり、
    意図的にアーカイブした工番が裏の経路で一覧へ戻るのは驚きが大きいため
    (出図登録での自動復活とは方針を分ける)。
    """
    job = await db.get(Job, job_id)
    if job is not None:
        return job, False

    master = await db.get(JobMasterCache, job_id)
    # title は master → request → job_id の順でフォールバック (NOT NULL のため必ず埋める)。
    resolved_title = (master.title if master else None) or title or job_id
    resolved_customer = (master.customer if master else None) or customer
    resolved_due = delivery_date or (master.delivery_date if master else None)

    try:
        async with db.begin_nested():
            job = Job(
                id=job_id,
                title=resolved_title,
                customer=resolved_customer,
                delivery_date=resolved_due,
                origin="purchase",
            )
            db.add(job)
            await db.flush()
    except IntegrityError:
        # 競合で既に作られていた → 再取得して既存扱い。
        job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one()
        return job, False
    return job, True


async def _register_mail_log(
    db: AsyncSession, body: PurchaseRequestCreate, request: PurchaseRequest
) -> int | None:
    """送信履歴を mail_logs に記録する。

    `MailLog.job_id` は nullable なので、工番未定の依頼でも履歴を残せる。
    本文は保持しない (PII 回避)。
    """
    if body.subject is None and not body.mail_to and not body.mail_cc:
        return None

    mail_log = MailLog(
        job_id=request.job_id,
        subject=body.subject or "(件名なし)",
        body="",
        method="purchase_agent",
        status="sent",
        sent_at=request.requested_at,
        sent_by=body.requester_name,
    )
    db.add(mail_log)
    await db.flush()

    for kind, recipients in (("to", body.mail_to), ("cc", body.mail_cc)):
        for recipient in recipients:
            db.add(
                MailLogRecipient(
                    mail_log_id=mail_log.id,
                    kind=kind,
                    name=recipient.name,
                    email=recipient.email,
                )
            )
    await db.flush()
    return mail_log.id


async def add_reply(
    db: AsyncSession,
    request_id: int,
    body: PurchaseReplyCreate,
    upload: UploadFile,
    actor: str,
) -> PurchaseRequestReply:
    """手配結果のスキャン PDF を登録し、ステータスを進める (冪等)。"""
    request = await _get_active_request(db, request_id)

    existing = (
        await db.execute(
            select(PurchaseRequestReply).where(
                PurchaseRequestReply.client_reply_id == body.client_reply_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    reply = PurchaseRequestReply(
        request_id=request.id,
        pdf_path=_PENDING_PATH,
        original_name=upload.filename,
        replied_by_account=body.replied_by_account,
        replied_by_name=body.replied_by_name,
        replied_at=body.replied_at or datetime.now(UTC),
        note=body.note,
        client_reply_id=body.client_reply_id,
    )
    db.add(reply)
    await db.flush()

    _rel, rel_str, size = await save_uploaded_file(
        upload,
        sub_dir=Path("purchase") / str(request.id) / "replies",
        allowed_ext=REPLY_FILE_EXT,
    )
    reply.pdf_path = rel_str
    reply.size = size

    request.status = body.set_status
    if body.set_status == "answered":
        request.closed_at = datetime.now(UTC)
    await db.flush()

    await write_action_log(
        db,
        actor=actor,
        action_type="purchase_request.reply",
        job_id=request.job_id,
        payload={
            "request_id": request.id,
            "reply_id": reply.id,
            "status": request.status,
            "replied_by_account": body.replied_by_account,
        },
    )
    return reply


async def update_request(
    db: AsyncSession, request_id: int, body: PurchaseRequestUpdate, actor: str
) -> PurchaseRequest:
    """工番の後付け紐づけ / ステータス変更 / 論理アーカイブ。"""
    request = await _get_active_request(db, request_id, allow_archived=True)

    job_created = False
    if body.job_id is not None:
        _job, job_created = await _get_or_create_job(
            db,
            job_id=body.job_id,
            title=body.title,
            customer=body.customer,
            delivery_date=None,
        )
        request.job_id = body.job_id

    if body.branch_no is not None:
        request.branch_no = body.branch_no
    if body.status is not None:
        request.status = body.status
        request.closed_at = datetime.now(UTC) if body.status == "answered" else None
    if body.note is not None:
        request.note = body.note
    if body.archived is not None:
        # 削除はしない。表示から外すだけ (CLAUDE.md §2.1)。
        request.archived_at = datetime.now(UTC) if body.archived else None

    await db.flush()
    await write_action_log(
        db,
        actor=actor,
        action_type="purchase_request.update",
        job_id=request.job_id,
        payload={
            "request_id": request.id,
            "job_id": request.job_id,
            "job_created": job_created,
            "status": request.status,
            "archived": request.archived_at is not None,
        },
    )
    return request


async def _get_active_request(
    db: AsyncSession, request_id: int, *, allow_archived: bool = False
) -> PurchaseRequest:
    request = (
        await db.execute(
            select(PurchaseRequest)
            .where(PurchaseRequest.id == request_id)
            .options(selectinload(PurchaseRequest.replies))
        )
    ).scalar_one_or_none()
    if request is None or (not allow_archived and request.archived_at is not None):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="依頼が見つかりません")
    return request
