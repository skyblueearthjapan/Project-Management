"""購入部品追加依頼ルーター (DESIGN_購入部品追加依頼.md §2)。

- POST   /purchase-requests                       … 依頼登録 (multipart・冪等)
- GET    /purchase-requests                       … 一覧 (工番未定を先頭に固定)
- GET    /purchase-requests/{id}                  … 詳細
- PATCH  /purchase-requests/{id}                  … 工番の後付け紐づけ / ステータス / アーカイブ
- POST   /purchase-requests/{id}/replies          … 回答 PDF 登録 (multipart・冪等)
- GET    /purchase-requests/{id}/file             … 部品リスト Excel 配信
- GET    /purchase-requests/{id}/replies/{rid}/file … 回答 PDF 配信
- GET    /purchase-requests/export                … Excel 出力 (一方向)

認証は不要 (api_router の enforce_lan_only で LAN 限定)。actor は発信元 IP。
削除エンドポイントは設けない。非表示は archived_at のみ (CLAUDE.md §2.1)。
"""

from __future__ import annotations

import json
import mimetypes
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import resolve_under
from app.models.job import Job
from app.models.purchase_request import PurchaseRequest, PurchaseRequestReply
from app.schemas.common import Page
from app.schemas.purchase_request import (
    PurchaseReplyCreate,
    PurchaseReplyRead,
    PurchaseRequestCreate,
    PurchaseRequestRead,
    PurchaseRequestRegisterOut,
    PurchaseRequestUpdate,
)
from app.services.audit import client_actor
from app.services.purchase_request import (
    add_reply,
    register_purchase_request,
    update_request,
)

router = APIRouter()

# 未対応 = まだ回答が返っていない状態。
OPEN_STATUSES = ("requested", "ordered")


def _parse_recipients(raw: str | None) -> list[dict[str, str | None]]:
    """multipart で受けた宛先 JSON 文字列をパースする。空/不正は空リスト扱い。"""
    if not raw or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="宛先の形式が不正です (JSON 配列を指定してください)",
        ) from exc
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="宛先は JSON 配列で指定してください",
        )
    return parsed


def _to_read(row: PurchaseRequest) -> PurchaseRequestRead:
    out = PurchaseRequestRead.model_validate(row)
    if row.job is not None:
        out.job_title = row.job.title
        out.customer = row.job.customer
    return out


@router.post(
    "",
    response_model=PurchaseRequestRegisterOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_purchase_request(
    request: Request,
    response: Response,
    client_request_id: str = Form(..., description="EXE 生成の冪等キー (UUID)"),
    requester_account: str = Form(..., description="Windows アカウント"),
    requester_name: str = Form(...),
    requester_email: str = Form(...),
    file: UploadFile = File(..., description="部品リスト Excel"),
    job_id: str | None = Form(default=None, description="親工番。工番未定なら空"),
    job_no_input: str | None = Form(default=None, description="選択した工番文字列の原文"),
    branch_no: str | None = Form(default=None, description="枝番 (例 25146-1)"),
    title: str | None = Form(default=None),
    customer: str | None = Form(default=None),
    delivery_date: str | None = Form(default=None),
    subject: str | None = Form(default=None),
    note: str | None = Form(default=None),
    # EXE がメールを送った時刻。省略時はサーバ時刻。
    requested_at: str | None = Form(default=None),
    mail_to: str | None = Form(default=None, description='JSON 配列 [{"name":"","email":""}]'),
    mail_cc: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> PurchaseRequestRegisterOut:
    """購入部品追加依頼を登録する (冪等)。

    メール送信は EXE 側で完了済み。ここでは記録とファイル保管だけを行う。
    同じ `client_request_id` で再送されても依頼・ファイル・送信履歴は重複しない。
    """
    try:
        body = PurchaseRequestCreate(
            client_request_id=client_request_id,
            job_id=job_id,
            job_no_input=job_no_input,
            branch_no=branch_no,
            title=title,
            customer=customer,
            delivery_date=delivery_date or None,  # type: ignore[arg-type]
            requester_account=requester_account,
            requester_name=requester_name,
            requester_email=requester_email,
            subject=subject,
            note=note,
            requested_at=requested_at or None,  # type: ignore[arg-type]
            mail_to=_parse_recipients(mail_to),  # type: ignore[arg-type]
            mail_cc=_parse_recipients(mail_cc),  # type: ignore[arg-type]
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()
        ) from exc

    out = await register_purchase_request(db, body, file, client_actor(request))
    if not out.created:
        # 冪等ヒット (再送) は新規作成ではないため 200 で返す。
        response.status_code = status.HTTP_200_OK
    return out


@router.get("", response_model=Page[PurchaseRequestRead])
async def list_purchase_requests(
    status_filter: str = Query(
        default="open",
        alias="status",
        description="open / requested / ordered / answered / all",
    ),
    requester_account: str | None = Query(default=None),
    job_id: str | None = Query(default=None),
    unassigned_only: bool = Query(default=False, description="工番未定のみ"),
    include_archived: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> Page[PurchaseRequestRead]:
    """依頼一覧。

    **工番未定の依頼を必ず先頭に固定する** (要件 D-08)。埋もれると手配漏れに直結するため、
    並び順はサーバ側で担保し、クライアント (EXE) の実装に依存させない。
    """
    stmt = select(PurchaseRequest).options(
        selectinload(PurchaseRequest.replies), selectinload(PurchaseRequest.job)
    )
    count_stmt = select(func.count(PurchaseRequest.id))

    conditions = []
    if not include_archived:
        conditions.append(PurchaseRequest.archived_at.is_(None))
    if status_filter == "open":
        conditions.append(PurchaseRequest.status.in_(OPEN_STATUSES))
    elif status_filter != "all":
        conditions.append(PurchaseRequest.status == status_filter)
    if requester_account:
        conditions.append(PurchaseRequest.requester_account == requester_account)
    if job_id:
        conditions.append(PurchaseRequest.job_id == job_id)
    if unassigned_only:
        conditions.append(PurchaseRequest.job_id.is_(None))

    for cond in conditions:
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    total = (await db.execute(count_stmt)).scalar_one()
    stmt = (
        stmt.order_by(
            # 工番未定 (job_id IS NULL) を最上部へ。以降は依頼日の古い順。
            PurchaseRequest.job_id.is_(None).desc(),
            PurchaseRequest.requested_at.asc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = (await db.execute(stmt)).scalars().all()
    return Page[PurchaseRequestRead](
        items=[_to_read(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/export")
async def export_purchase_requests(
    include_archived: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """ステータス一覧を Excel で出力する。

    Excel は **出力物であってデータベースではない** (要件 D-10)。
    生成した Excel を取り込む経路は設けない (一方向)。
    """
    stmt = (
        select(PurchaseRequest)
        .options(selectinload(PurchaseRequest.job), selectinload(PurchaseRequest.replies))
        .order_by(PurchaseRequest.requested_at.desc())
    )
    if not include_archived:
        stmt = stmt.where(PurchaseRequest.archived_at.is_(None))
    rows = (await db.execute(stmt)).scalars().all()

    wb = Workbook()
    ws = wb.active
    ws.title = "購入部品追加依頼"
    ws.append(
        [
            "依頼ID",
            "工番",
            "枝番",
            "品名",
            "客先",
            "依頼者",
            "依頼日時",
            "部品リスト",
            "ステータス",
            "回答件数",
            "完了日時",
            "備考",
        ]
    )
    for r in rows:
        ws.append(
            [
                r.id,
                r.job_id or "(工番未定)",
                r.branch_no or "",
                (r.job.title if r.job else "") or "",
                (r.job.customer if r.job else "") or "",
                r.requester_name,
                r.requested_at.strftime("%Y-%m-%d %H:%M") if r.requested_at else "",
                r.request_file_original_name,
                r.status,
                len(r.replies),
                r.closed_at.strftime("%Y-%m-%d %H:%M") if r.closed_at else "",
                r.note or "",
            ]
        )

    buf = BytesIO()
    wb.save(buf)
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="purchase-requests-{stamp}.xlsx"'},
    )


@router.get("/jobs/{job_id}", response_model=list[PurchaseRequestRead])
async def list_by_job(job_id: str, db: AsyncSession = Depends(get_db)) -> list[PurchaseRequestRead]:
    """工番詳細タブ用。active な依頼を依頼日の新しい順で返す。

    パスを `/purchase-requests/jobs/{job_id}` にしているのは、既存の
    `/shutsuzu/jobs/{job_id}/instructions` と同じ流儀で jobs ルーターを触らずに済ませるため。
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工番が見つかりません")
    rows = (
        (
            await db.execute(
                select(PurchaseRequest)
                .where(PurchaseRequest.job_id == job_id)
                .where(PurchaseRequest.archived_at.is_(None))
                .options(
                    selectinload(PurchaseRequest.replies),
                    selectinload(PurchaseRequest.job),
                )
                .order_by(PurchaseRequest.requested_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_to_read(r) for r in rows]


@router.get("/{request_id}", response_model=PurchaseRequestRead)
async def get_purchase_request(
    request_id: int, db: AsyncSession = Depends(get_db)
) -> PurchaseRequestRead:
    row = await _load(db, request_id)
    return _to_read(row)


@router.patch("/{request_id}", response_model=PurchaseRequestRead)
async def patch_purchase_request(
    request_id: int,
    body: PurchaseRequestUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PurchaseRequestRead:
    """工番の後付け紐づけ / ステータス変更 / 論理アーカイブ。

    工番の紐づけは設計部員・購買担当の双方が実行できる (要件 D-06)。
    """
    await update_request(db, request_id, body, client_actor(request))
    return _to_read(await _load(db, request_id))


@router.post(
    "/{request_id}/replies",
    response_model=PurchaseReplyRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_reply(
    request_id: int,
    request: Request,
    client_reply_id: str = Form(..., description="冪等キー (UUID)"),
    replied_by_account: str = Form(...),
    file: UploadFile = File(..., description="手配結果のスキャン PDF"),
    replied_by_name: str | None = Form(default=None),
    note: str | None = Form(default=None),
    set_status: str = Form(default="answered"),
    replied_at: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> PurchaseReplyRead:
    """手配結果のスキャン PDF を登録し、ステータスを進める (冪等)。"""
    try:
        body = PurchaseReplyCreate(
            client_reply_id=client_reply_id,
            replied_by_account=replied_by_account,
            replied_by_name=replied_by_name,
            note=note,
            replied_at=replied_at or None,  # type: ignore[arg-type]
            set_status=set_status,  # type: ignore[arg-type]
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()
        ) from exc

    reply = await add_reply(db, request_id, body, file, client_actor(request))
    return PurchaseReplyRead.model_validate(reply)


@router.get("/{request_id}/file")
async def serve_request_file(request_id: int, db: AsyncSession = Depends(get_db)) -> FileResponse:
    """部品リスト Excel を配信する (五十嵐様が開く経路)。"""
    row = await _load(db, request_id)
    return _serve_upload(row.request_file_path, row.request_file_original_name)


@router.get("/{request_id}/replies/{reply_id}/file")
async def serve_reply_file(
    request_id: int, reply_id: int, db: AsyncSession = Depends(get_db)
) -> FileResponse:
    """手配結果のスキャン PDF を配信する。"""
    reply = await db.get(PurchaseRequestReply, reply_id)
    if reply is None or reply.request_id != request_id or reply.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="回答が見つかりません")
    return _serve_upload(reply.pdf_path, reply.original_name)


def _serve_upload(rel_path: str, original_name: str | None) -> FileResponse:
    """`/mnt/uploads` 配下のファイルを配信する。

    Path Traversal 最終防御は `resolve_under` が担う (`..` / 絶対パスは 400)。
    実体には一切書き込まない。
    """
    settings = get_settings()
    full = resolve_under(settings.upload_dir, rel_path.lstrip("/"))
    if not full.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ファイルが見つかりません"
        )
    mime, _ = mimetypes.guess_type(str(full))
    name = original_name or Path(full).name
    return FileResponse(
        full,
        media_type=mime or "application/octet-stream",
        filename=name,
    )


async def _load(db: AsyncSession, request_id: int) -> PurchaseRequest:
    row = (
        await db.execute(
            select(PurchaseRequest)
            .where(PurchaseRequest.id == request_id)
            .options(selectinload(PurchaseRequest.replies), selectinload(PurchaseRequest.job))
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="依頼が見つかりません")
    return row
