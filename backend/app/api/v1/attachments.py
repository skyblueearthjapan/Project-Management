from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import resolve_under
from app.models.attachment import (
    PartsList,
    PartsListVersion,
    PdfReplacement,
    RelatedDoc,
)
from app.models.axis import Axis
from app.models.version import Version
from app.schemas.attachment import (
    PartsListRead,
    PartsListVersionCreate,
    PartsListVersionRead,
    PdfReplacementCreate,
    PdfReplacementRead,
    RelatedDocCreate,
    RelatedDocRead,
)
from app.services.audit import client_actor, write_action_log
from app.services.link_check import (
    TARGET_PARTS_LIST_VERSION,
    TARGET_PDF_REPLACEMENT,
    TARGET_RELATED_DOC,
    latest_link_status,
)

router = APIRouter()


def _safe_filename(name: str) -> str:
    """アップロードファイル名から危険な文字を除いた最終ファイル名を返す。"""
    # path separator や `..` を除去 (Path Traversal 防止)
    p = Path(name)
    base = p.name
    # 制御文字や Windows 予約文字を「_」に
    bad = set('<>:"/\\|?*\x00')
    return "".join("_" if c in bad else c for c in base)[:128] or "file.bin"


async def _ensure_axis(db: AsyncSession, job_id: str, axis_id: int) -> Axis:
    axis = await db.get(Axis, axis_id)
    if axis is None or axis.job_id != job_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="軸が見つかりません")
    return axis


# ---- 関連資料 ----
@router.get(
    "/{job_id}/axes/{axis_id}/related-docs",
    response_model=list[RelatedDocRead],
)
async def list_related(
    job_id: str, axis_id: int, db: AsyncSession = Depends(get_db)
) -> list[RelatedDocRead]:
    await _ensure_axis(db, job_id, axis_id)
    rows = (
        await db.execute(
            select(RelatedDoc)
            .where(RelatedDoc.axis_id == axis_id)
            # ソフトデリート行は一覧から除外
            .where(RelatedDoc.deleted_at.is_(None))
            .order_by(RelatedDoc.created_at.desc())
        )
    ).scalars().all()
    # Phase D: link_check_results 最新行を JOIN して is_link_broken を付与
    broken_map = await latest_link_status(
        db, TARGET_RELATED_DOC, [r.id for r in rows]
    )
    return [
        RelatedDocRead.model_validate(
            {
                **{c.name: getattr(r, c.name) for c in RelatedDoc.__table__.columns},
                "is_link_broken": broken_map.get(r.id, False),
            }
        )
        for r in rows
    ]


@router.post(
    "/{job_id}/axes/{axis_id}/related-docs",
    response_model=RelatedDocRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_related(
    job_id: str,
    axis_id: int,
    body: RelatedDocCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> RelatedDocRead:
    await _ensure_axis(db, job_id, axis_id)
    # 既存ファイルへの参照のみ。書き込みは行わない。
    doc = RelatedDoc(axis_id=axis_id, **body.model_dump())
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="related_doc.create",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "file_path": doc.file_path,
        },
    )
    return RelatedDocRead.model_validate(doc)


# ---- 部品リスト ----
@router.get(
    "/{job_id}/axes/{axis_id}/parts-list",
    response_model=PartsListRead | None,
)
async def get_parts_list(
    job_id: str, axis_id: int, db: AsyncSession = Depends(get_db)
) -> PartsListRead | None:
    await _ensure_axis(db, job_id, axis_id)
    stmt = (
        select(PartsList)
        .where(PartsList.axis_id == axis_id)
        .options(selectinload(PartsList.versions))
    )
    pl = (await db.execute(stmt)).scalar_one_or_none()
    if pl is None:
        return None
    # ソフトデリート済みのバージョンは一覧から除外
    active_versions = [v for v in pl.versions if v.deleted_at is None]
    # Phase D: versions 各行に is_link_broken を埋め込む
    broken_map = await latest_link_status(
        db, TARGET_PARTS_LIST_VERSION, [v.id for v in active_versions]
    )
    return PartsListRead.model_validate(
        {
            "id": pl.id,
            "axis_id": pl.axis_id,
            "note": pl.note,
            "updated_at": pl.updated_at,
            "versions": [
                PartsListVersionRead.model_validate(
                    {
                        **{
                            c.name: getattr(v, c.name)
                            for c in PartsListVersion.__table__.columns
                        },
                        "is_link_broken": broken_map.get(v.id, False),
                    }
                )
                for v in active_versions
            ],
        }
    )


@router.post(
    "/{job_id}/axes/{axis_id}/parts-list/versions",
    response_model=PartsListVersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_parts_list_version(
    job_id: str,
    axis_id: int,
    body: PartsListVersionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PartsListVersionRead:
    await _ensure_axis(db, job_id, axis_id)
    pl = (
        await db.execute(select(PartsList).where(PartsList.axis_id == axis_id))
    ).scalar_one_or_none()
    if pl is None:
        pl = PartsList(axis_id=axis_id)
        db.add(pl)
        await db.flush()
    last_no = (
        await db.execute(
            select(PartsListVersion.version_no)
            .where(PartsListVersion.parts_list_id == pl.id)
            .order_by(PartsListVersion.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    next_no = (last_no or 0) + 1
    v = PartsListVersion(
        parts_list_id=pl.id,
        version_no=next_no,
        file_path=body.file_path,
        label=body.label,
        note=body.note,
        created_by=body.created_by,
    )
    db.add(v)
    await db.flush()
    await db.refresh(v)

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="parts_list.add_version",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "version_no": next_no,
            "file_path": body.file_path,
            "created_by": body.created_by,
        },
    )
    return PartsListVersionRead.model_validate(v)


# ---- PDF差し替えアップロード (Marin-PDF 流) ----
@router.post(
    "/{job_id}/axes/{axis_id}/versions/{version_id}/pdf-replacement",
    response_model=PdfReplacementRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_pdf_replacement(
    job_id: str,
    axis_id: int,
    version_id: int,
    request: Request,
    file: UploadFile = File(..., description="差し替え用 PDF (注釈/朱書き)"),
    note: str | None = Form(default=None),
    created_by: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> PdfReplacementRead:
    """差し替え PDF を `/mnt/uploads/replacements/{job}/{axis}/{ver}/` に保存し、履歴を残す。

    保存ファイル名規約: `{元PDFファイル名(無し)}__replace-{yyyymmddHHMMSS}.pdf`
    保存先は `/mnt/uploads` 配下のみ (security: resolve_under)。
    """
    await _ensure_axis(db, job_id, axis_id)
    version = await db.get(Version, version_id)
    if version is None or version.axis_id != axis_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="バージョンが見つかりません"
        )
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PDF以外のファイルは受け付けません: {file.content_type}",
        )

    settings = get_settings()
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    safe = _safe_filename(file.filename or "replacement.pdf")
    if not safe.lower().endswith(".pdf"):
        safe = f"{safe}.pdf"
    stem = Path(safe).stem
    out_name = f"{stem}__replace-{ts}.pdf"

    rel_dir = Path("replacements") / job_id / str(axis_id) / str(version_id)
    rel_path = rel_dir / out_name
    abs_path = resolve_under(settings.upload_dir, str(rel_path))
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="50MB を超える PDF は受け付けません",
        )
    abs_path.write_bytes(content)

    rep = PdfReplacement(
        axis_id=axis_id,
        version_id=version_id,
        replaced_pdf_path=str(rel_path).replace("\\", "/"),
        note=note,
        created_by=created_by,
    )
    db.add(rep)
    await db.flush()
    await db.refresh(rep)

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="pdf_replacement.upload",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "version_id": version_id,
            "replaced_pdf_path": str(rel_path).replace("\\", "/"),
            "created_by": created_by,
        },
    )
    return PdfReplacementRead.model_validate(rep)


def _exclusive_write_bytes(path: Path, data: bytes) -> None:
    """`open(path, "xb")` で排他作成。

    CLAUDE.md §2.1 / §2.2: 既存ファイルがあれば `FileExistsError` を投げて
    上書きを拒否する。呼び出し側は 409 に変換する。
    aiofiles は "xb" を安定サポートしていないため同期 open + `to_thread` で
    event loop をブロックしないようにする。
    """
    with open(path, "xb") as f:
        f.write(data)


_MAX_UPLOAD_BYTES = 50 * 1024 * 1024


async def _save_uploaded_file(
    upload: UploadFile, *, sub_dir: Path, allowed_ext: set[str] | None = None
) -> tuple[Path, str, int]:
    """`/mnt/uploads/{sub_dir}/` 配下に排他作成で保存し (rel_path, abs_path, size) を返す。

    保存ファイル名: `{stem}__{yyyymmddHHMMSS}{ext}` で衝突時のリトライ余地を確保。
    """
    settings = get_settings()
    safe = _safe_filename(upload.filename or "upload.bin")
    ext = Path(safe).suffix.lower()
    if allowed_ext is not None and ext not in allowed_ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"許可されていない拡張子です: {ext or '(無拡張子)'}",
        )
    content = await upload.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="50MB を超えるファイルは受け付けません",
        )

    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    stem = Path(safe).stem
    out_name = f"{stem}__{ts}{ext}"
    rel_path = sub_dir / out_name
    abs_path = resolve_under(settings.upload_dir, str(rel_path))
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        await asyncio.to_thread(_exclusive_write_bytes, abs_path, content)
    except FileExistsError as exc:
        # 1 秒以内の同名連打のみ起こり得る。タイムスタンプ + サフィックスで再試行。
        for attempt in range(1, 6):
            out_name = f"{stem}__{ts}-{attempt}{ext}"
            rel_path = sub_dir / out_name
            abs_path = resolve_under(settings.upload_dir, str(rel_path))
            try:
                await asyncio.to_thread(_exclusive_write_bytes, abs_path, content)
                break
            except FileExistsError:
                continue
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="同名ファイルが連続衝突しました。しばらく待って再試行してください。",
            ) from exc
    return rel_path, str(rel_path).replace("\\", "/"), len(content)


@router.post(
    "/{job_id}/axes/{axis_id}/related-docs/upload",
    response_model=RelatedDocRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_related_doc(
    job_id: str,
    axis_id: int,
    request: Request,
    file: UploadFile = File(..., description="関連資料の実体ファイル"),
    title: str | None = Form(default=None),
    note: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> RelatedDocRead:
    """PC からの関連資料アップロード。

    保存先: `/mnt/uploads/related-docs/{job}/{axis}/{file}` (排他作成、上書き禁止)。
    """
    await _ensure_axis(db, job_id, axis_id)
    sub_dir = Path("related-docs") / job_id / str(axis_id)
    _rel_path, rel_str, size = await _save_uploaded_file(file, sub_dir=sub_dir)

    doc = RelatedDoc(
        axis_id=axis_id,
        file_path=rel_str,
        title=title or (file.filename or None),
        note=note,
        size=size,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="related_doc.upload",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "file_path": rel_str,
            "size": size,
        },
    )
    return RelatedDocRead.model_validate(doc)


@router.post(
    "/{job_id}/axes/{axis_id}/parts-list/versions/upload",
    response_model=PartsListVersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_parts_list_version(
    job_id: str,
    axis_id: int,
    request: Request,
    file: UploadFile = File(..., description="部品リストファイル (Excel / PDF 等)"),
    label: str | None = Form(default=None),
    note: str | None = Form(default=None),
    created_by: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> PartsListVersionRead:
    """PC からの部品リスト (新バージョン) アップロード。

    保存先: `/mnt/uploads/parts-lists/{job}/{axis}/{file}` (排他作成、上書き禁止)。
    """
    await _ensure_axis(db, job_id, axis_id)
    sub_dir = Path("parts-lists") / job_id / str(axis_id)
    _rel_path, rel_str, _size = await _save_uploaded_file(file, sub_dir=sub_dir)

    pl = (
        await db.execute(select(PartsList).where(PartsList.axis_id == axis_id))
    ).scalar_one_or_none()
    if pl is None:
        pl = PartsList(axis_id=axis_id)
        db.add(pl)
        await db.flush()
    last_no = (
        await db.execute(
            select(PartsListVersion.version_no)
            .where(PartsListVersion.parts_list_id == pl.id)
            .order_by(PartsListVersion.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    next_no = (last_no or 0) + 1
    v = PartsListVersion(
        parts_list_id=pl.id,
        version_no=next_no,
        file_path=rel_str,
        label=label,
        note=note,
        created_by=created_by,
    )
    db.add(v)
    await db.flush()
    await db.refresh(v)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="parts_list.upload_version",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "version_no": next_no,
            "file_path": rel_str,
            "created_by": created_by,
        },
    )
    return PartsListVersionRead.model_validate(v)


@router.get(
    "/{job_id}/axes/{axis_id}/pdf-replacements",
    response_model=list[PdfReplacementRead],
)
async def list_replacements(
    job_id: str, axis_id: int, db: AsyncSession = Depends(get_db)
) -> list[PdfReplacementRead]:
    await _ensure_axis(db, job_id, axis_id)
    rows = (
        await db.execute(
            select(PdfReplacement)
            .where(PdfReplacement.axis_id == axis_id)
            # ソフトデリート行は一覧から除外
            .where(PdfReplacement.deleted_at.is_(None))
            .order_by(PdfReplacement.created_at.desc())
        )
    ).scalars().all()
    # Phase D: link_check_results 最新行を JOIN して is_link_broken を付与
    broken_map = await latest_link_status(
        db, TARGET_PDF_REPLACEMENT, [r.id for r in rows]
    )
    return [
        PdfReplacementRead.model_validate(
            {
                **{c.name: getattr(r, c.name) for c in PdfReplacement.__table__.columns},
                "is_link_broken": broken_map.get(r.id, False),
            }
        )
        for r in rows
    ]


# ---- PDF差替 path-based 登録 (LinkModal A/P モード用) ----
@router.post(
    "/{job_id}/axes/{axis_id}/pdf-replacements/by-path",
    response_model=PdfReplacementRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_pdf_replacement_by_path(
    job_id: str,
    axis_id: int,
    body: PdfReplacementCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PdfReplacementRead:
    """差替 PDF を「既存ファイルへのパス参照」として登録する (DB 行のみ作成)。

    LinkModal の A (サーバから選ぶ) / P (パスを貼り付け) モードで使う。
    ファイル実体は触らない (アップロード経路は別エンドポイント)。
    """
    await _ensure_axis(db, job_id, axis_id)
    version = await db.get(Version, body.version_id)
    if version is None or version.axis_id != axis_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="差替対象のバージョンが見つかりません",
        )

    rep = PdfReplacement(
        axis_id=axis_id,
        version_id=body.version_id,
        replaced_pdf_path=body.file_path,
        note=body.note,
        created_by=body.created_by,
    )
    db.add(rep)
    await db.flush()
    await db.refresh(rep)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="pdf_replacement.create_by_path",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "version_id": body.version_id,
            "replaced_pdf_path": body.file_path,
            "created_by": body.created_by,
        },
    )
    return PdfReplacementRead.model_validate(rep)


# ---- ソフトデリート系 (CLAUDE.md §2.1 厳守: ファイル実体は触らない) ----
@router.delete(
    "/{job_id}/axes/{axis_id}/related-docs/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def soft_delete_related_doc(
    job_id: str,
    axis_id: int,
    doc_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """関連資料をソフトデリート (deleted_at に NOW() を立てる)。

    実ファイルは絶対に削除しない (CLAUDE.md §2.1)。
    既に削除済みの行は 404 として扱う。
    """
    await _ensure_axis(db, job_id, axis_id)
    doc = await db.get(RelatedDoc, doc_id)
    if doc is None or doc.axis_id != axis_id or doc.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="関連資料が見つかりません"
        )
    doc.deleted_at = datetime.now(timezone.utc)
    await db.flush()

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="related_doc.soft_delete",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "related_doc_id": doc_id,
            "file_path": doc.file_path,
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{job_id}/axes/{axis_id}/parts-list/versions/{version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def soft_delete_parts_list_version(
    job_id: str,
    axis_id: int,
    version_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """部品リストのバージョンをソフトデリートする。

    実ファイルは触らない。version_no はそのまま残す (採番の連続性維持のため)。
    """
    await _ensure_axis(db, job_id, axis_id)
    v = await db.get(PartsListVersion, version_id)
    if v is None or v.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="バージョンが見つかりません"
        )
    # axis 整合性: parts_list 経由で axis_id を確認
    pl = await db.get(PartsList, v.parts_list_id)
    if pl is None or pl.axis_id != axis_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="バージョンが見つかりません"
        )
    v.deleted_at = datetime.now(timezone.utc)
    await db.flush()

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="parts_list_version.soft_delete",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "parts_list_version_id": version_id,
            "version_no": v.version_no,
            "file_path": v.file_path,
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{job_id}/axes/{axis_id}/pdf-replacements/{rep_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def soft_delete_pdf_replacement(
    job_id: str,
    axis_id: int,
    rep_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """差替 PDF レコードをソフトデリートする。実ファイルは触らない。"""
    await _ensure_axis(db, job_id, axis_id)
    rep = await db.get(PdfReplacement, rep_id)
    if rep is None or rep.axis_id != axis_id or rep.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="差替が見つかりません"
        )
    rep.deleted_at = datetime.now(timezone.utc)
    await db.flush()

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="pdf_replacement.soft_delete",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "pdf_replacement_id": rep_id,
            "replaced_pdf_path": rep.replaced_pdf_path,
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
