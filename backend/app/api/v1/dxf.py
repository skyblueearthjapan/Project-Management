"""V2 製造現場 DX: DXF を PDF と同格に扱うエンドポイント群。

設計方針 (Phase K 改訂):
  - DXF は **フォルダ単位** が主軸 (Phase J)。新規登録は ``POST .../dxf-folder``。
  - Phase K でブラウザからのアップロード経路を復活:
      * ``POST .../dxf-files/upload`` … 1 ファイル単位アップロード (再公開)
      * ``POST .../dxf-folder/upload`` … フォルダ単位アップロード (webkitdirectory)
      * ``POST .../dxf-folder/replace-by-upload`` … 現行 archive + 新フォルダ一括アップロード
  - サーバパス参照経路 (``POST .../dxf-files``, ``.../dxf-folder``) も継続有効。
  - バージョン履歴は持たない (=平置き)
  - 削除は一切しない (CLAUDE.md §2.1)
  - アップロード保存先は /mnt/uploads/dxf/{job}/{axis}/... のみ (CLAUDE.md §2.2)
  - 排他作成 (open "xb") で既存衝突は 409
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import resolve_under
from app.models.axis import Axis
from app.models.dxf import DxfFile
from app.schemas.dxf import DxfFileCreate, DxfFileRead
from app.services.audit import client_actor, write_action_log
from app.services.link_check import TARGET_DXF_FILE, latest_link_status

router = APIRouter()


# ---- 共通ヘルパ ----------------------------------------------------------------
async def _ensure_axis(db: AsyncSession, job_id: str, axis_id: int) -> Axis:
    axis = await db.get(Axis, axis_id)
    if axis is None or axis.job_id != job_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="軸が見つかりません")
    return axis


def _safe_filename(name: str) -> str:
    """アップロードファイル名から危険な文字を除いた最終ファイル名を返す。"""
    bad = set('<>:"/\\|?*\x00')
    base = Path(name).name
    return "".join("_" if c in bad else c for c in base)[:128] or "drawing.dxf"


def _ensure_dxf_extension(filename: str) -> None:
    """`.dxf` (大文字小文字許容) 以外は 400 で弾く。"""
    if not filename.lower().endswith(".dxf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"DXF以外のファイルは受け付けません: {filename}",
        )


def _to_read(dxf: DxfFile, *, is_link_broken: bool = False) -> DxfFileRead:
    return DxfFileRead.model_validate(
        {
            **{c.name: getattr(dxf, c.name) for c in DxfFile.__table__.columns},
            "is_link_broken": is_link_broken,
        }
    )


# ---- 一覧 ----------------------------------------------------------------------
@router.get("/{job_id}/axes/{axis_id}/dxf-files", response_model=list[DxfFileRead])
async def list_dxf_files(
    job_id: str,
    axis_id: int,
    include_archived: bool = Query(
        default=False,
        description="True で archived_at IS NOT NULL の行も返す (履歴パネル用)",
    ),
    db: AsyncSession = Depends(get_db),
) -> list[DxfFileRead]:
    """登録済み DXF ファイル一覧。created_at DESC 順。

    Phase I: デフォルトは archived 除外。履歴パネルだけ全件取得する。
    """
    await _ensure_axis(db, job_id, axis_id)
    stmt = select(DxfFile).where(DxfFile.axis_id == axis_id).order_by(DxfFile.created_at.desc())
    if not include_archived:
        stmt = stmt.where(DxfFile.archived_at.is_(None))
    rows = (await db.execute(stmt)).scalars().all()
    # Phase D 同様、link_check_results 最新行を JOIN して is_link_broken を付与
    broken_map = await latest_link_status(db, TARGET_DXF_FILE, [d.id for d in rows])
    return [_to_read(d, is_link_broken=broken_map.get(d.id, False)) for d in rows]


# ---- パス参照で登録 (Phase K で復活) ------------------------------------------
# サーバパスを直接指定して 1 ファイル単位で登録するエンドポイント。
# Phase J で一旦 404 化したが、Phase K で再公開 (フォルダ単位と併用する運用に戻す)。
@router.post(
    "/{job_id}/axes/{axis_id}/dxf-files",
    response_model=DxfFileRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_dxf_path(
    job_id: str,
    axis_id: int,
    body: DxfFileCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> DxfFileRead:
    """既にファイルサーバ上にある DXF ファイルへのパス参照を登録する。

    実ファイルの書き込み・コピーは行わない。パスサニタイズ + 拡張子チェックのみ。
    """
    await _ensure_axis(db, job_id, axis_id)

    # 入力サニタイズ: 区切り正規化 + 拡張子チェック (Path Traversal は file 配信側で resolve_under)
    rel = body.file_path.strip().replace("\\", "/").lstrip("/")
    if not rel:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="file_path を指定してください",
        )
    _ensure_dxf_extension(rel)

    dxf = DxfFile(
        axis_id=axis_id,
        file_path=rel,
        label=body.label,
        note=body.note,
        created_by=body.created_by,
    )
    db.add(dxf)
    await db.flush()
    await db.refresh(dxf)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_file.create_path",
        job_id=job_id,
        axis_id=axis_id,
        payload={"job_id": job_id, "axis_id": axis_id, "file_path": rel},
    )
    return _to_read(dxf)


# ---- アップロード (Phase K で復活) ---------------------------------------------
# Phase J で一旦廃止したが、ブラウザの <input type="file"> は絶対パスを返さないため
# 「ファイルを選ぶだけで登録」の UX を成立させる唯一の現実解として Phase K で再公開する。
@router.post(
    "/{job_id}/axes/{axis_id}/dxf-files/upload",
    response_model=DxfFileRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_dxf(
    job_id: str,
    axis_id: int,
    request: Request,
    file: UploadFile = File(..., description="アップロードする DXF"),
    label: str | None = Form(default=None),
    note: str | None = Form(default=None),
    created_by: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> DxfFileRead:
    """DXF をアップロードして `/mnt/uploads/dxf/{job}/{axis}/...` に保存する。

    削除は一切行わない (CLAUDE.md §2.1)。
    既存衝突 (同名ファイル) は 409 で停止し、上書きや連番付与は行わない。
    """
    await _ensure_axis(db, job_id, axis_id)

    raw_name = file.filename or "drawing.dxf"
    _ensure_dxf_extension(raw_name)

    safe = _safe_filename(raw_name)
    # 拡張子を小文字化 (DBに格納する file_path は小文字 .dxf 統一)
    if not safe.lower().endswith(".dxf"):
        safe = f"{safe}.dxf"
    elif safe.endswith(".DXF") or safe.endswith(".Dxf"):
        # 大文字許容だが保存名は小文字に統一
        safe = safe[:-4] + ".dxf"

    settings = get_settings()
    rel = Path("dxf") / job_id / str(axis_id) / safe
    abs_path = resolve_under(settings.upload_dir, str(rel))
    abs_path.parent.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="100MB を超える DXF は受け付けません",
        )
    sha = hashlib.sha256(content).hexdigest()

    # CLAUDE.md §2.2: open(path, "xb") で排他作成 (既存衝突は 409)
    def _exclusive_write(path: Path, data: bytes) -> None:
        with open(path, "xb") as f:
            f.write(data)

    try:
        await asyncio.to_thread(_exclusive_write, abs_path, content)
    except FileExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"同名ファイルが既に存在します: {safe}。"
                "ファイル名を変更して再度アップロードしてください (上書きは行いません)。"
            ),
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ファイル書き込みに失敗しました: {exc}",
        ) from exc

    rel_str = str(rel).replace("\\", "/")
    dxf = DxfFile(
        axis_id=axis_id,
        file_path=rel_str,
        label=label,
        note=note,
        size=len(content),
        sha256=sha,
        created_by=created_by,
    )
    db.add(dxf)
    await db.flush()
    await db.refresh(dxf)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_file.upload",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "file_path": rel_str,
            "created_by": created_by,
        },
    )
    return _to_read(dxf)


# ---- 旧フォルダ一括取込 (@deprecated Phase J) ----------------------------------
# Phase J で `POST .../dxf-folder` に置き換え (常に 404 だった旧経路を撤去)。
# CLAUDE.md §2.1 に従い関数本体は残置するが、ルーター登録を外して 404 化する。
class _ImportFolderBody(BaseModel):
    folder_path: str | None = None


async def import_dxf_folder(
    job_id: str,
    axis_id: int,
    request: Request,
    folder_path: str | None = Query(
        default=None, description="/mnt/fileserver からの相対フォルダパス"
    ),
    body: _ImportFolderBody | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """指定フォルダ配下の `.dxf` を一括で `dxf_files` に登録する。

    既に登録済 (= 同じ file_path が存在する) のものはスキップ。
    実ファイルのコピーや移動は行わない (パス参照として INSERT するのみ)。
    """
    axis = await _ensure_axis(db, job_id, axis_id)

    raw = folder_path or (body.folder_path if body is not None else None)
    rel = (raw or f"設計/{job_id}/{axis.name}").strip().replace("\\", "/").lstrip("/")
    if not rel:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="folder_path を指定してください",
        )

    settings = get_settings()
    abs_dir = resolve_under(settings.fileserver_root, rel)
    if not abs_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"フォルダが見つかりません: {rel}",
        )

    # 既存登録済の file_path を一括取得
    existing_paths = {
        p
        for (p,) in (
            await db.execute(select(DxfFile.file_path).where(DxfFile.axis_id == axis_id))
        ).all()
    }

    found = 0
    imported = 0
    skipped = 0
    for child in sorted(abs_dir.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_file():
            continue
        if child.suffix.lower() != ".dxf":
            continue
        found += 1
        child_rel = f"{rel}/{child.name}"
        if child_rel in existing_paths:
            skipped += 1
            continue
        try:
            stat = child.stat()
            size = stat.st_size
        except OSError:
            size = None
        db.add(
            DxfFile(
                axis_id=axis_id,
                file_path=child_rel,
                size=size,
                created_by="folder_import",
            )
        )
        existing_paths.add(child_rel)
        imported += 1

    if imported:
        await db.flush()

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_file.import_folder",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "folder_path": rel,
            "imported": imported,
            "skipped": skipped,
            "found": found,
        },
    )
    return {"imported": imported, "skipped": skipped, "found": found}


# ---- Phase I: アーカイブ / 復帰 / 過去版を現行に復元 ---------------------------
#
# 仕様は PDF と同様: 実 DXF ファイルは絶対に消さない (CLAUDE.md §2.1)。
# archive は archived_at = now() のみ、unarchive は NULL に戻す。
# restore-as-current は同じ file_path を指す新 DxfFile 行を INSERT する (新規 created_at)。
async def _get_dxf_or_404(db: AsyncSession, axis_id: int, dxf_id: int) -> DxfFile:
    d = await db.get(DxfFile, dxf_id)
    if d is None or d.axis_id != axis_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DXFが見つかりません")
    return d


@router.patch(
    "/{job_id}/axes/{axis_id}/dxf-files/{dxf_id}/archive",
    response_model=DxfFileRead,
)
async def archive_dxf(
    job_id: str,
    axis_id: int,
    dxf_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> DxfFileRead:
    """DXF を論理アーカイブ。実ファイルは削除しない。"""
    await _ensure_axis(db, job_id, axis_id)
    dxf = await _get_dxf_or_404(db, axis_id, dxf_id)
    if dxf.archived_at is None:
        dxf.archived_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(dxf)
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_file.archive",
        job_id=job_id,
        axis_id=axis_id,
        payload={"job_id": job_id, "axis_id": axis_id, "dxf_id": dxf_id},
    )
    return _to_read(dxf)


@router.patch(
    "/{job_id}/axes/{axis_id}/dxf-files/{dxf_id}/unarchive",
    response_model=DxfFileRead,
)
async def unarchive_dxf(
    job_id: str,
    axis_id: int,
    dxf_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> DxfFileRead:
    """DXF をアーカイブから復帰させる。"""
    await _ensure_axis(db, job_id, axis_id)
    dxf = await _get_dxf_or_404(db, axis_id, dxf_id)
    if dxf.archived_at is not None:
        dxf.archived_at = None
        await db.flush()
        await db.refresh(dxf)
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_file.unarchive",
        job_id=job_id,
        axis_id=axis_id,
        payload={"job_id": job_id, "axis_id": axis_id, "dxf_id": dxf_id},
    )
    return _to_read(dxf)


@router.post(
    "/{job_id}/axes/{axis_id}/dxf-files/{dxf_id}/restore-as-current",
    response_model=DxfFileRead,
    status_code=status.HTTP_201_CREATED,
)
async def restore_dxf_as_current(
    job_id: str,
    axis_id: int,
    dxf_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> DxfFileRead:
    """過去の DXF を「現行」として新しい行 (新 created_at) で複製作成する。

    実 DXF はそのまま (= 同じ file_path を指す)。新規 dxf_files 行のみ INSERT。
    """
    await _ensure_axis(db, job_id, axis_id)
    source = await _get_dxf_or_404(db, axis_id, dxf_id)

    auto_label = f"{source.label} (現行に復元)" if source.label else "過去版を現行に復元"
    auto_note = f"dxf_id={source.id} の内容を最新版として復元"

    new_dxf = DxfFile(
        axis_id=axis_id,
        file_path=source.file_path,
        label=auto_label,
        note=auto_note,
        size=source.size,
        sha256=source.sha256,
        created_by=source.created_by,
    )
    db.add(new_dxf)
    await db.flush()
    await db.refresh(new_dxf)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_file.restore_as_current",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "source_dxf_id": dxf_id,
            "new_dxf_id": new_dxf.id,
        },
    )
    return _to_read(new_dxf)


# ---- Phase J: フォルダ単位登録 -------------------------------------------------
#
# DXF はフォルダ単位で扱う (個別ファイル単位は Phase J で廃止)。
# このエンドポイントは指定フォルダ配下の `.dxf` を全て `dxf_files` に登録する。
#   - 既登録 (= file_path 一致) はスキップ
#   - 実ファイルは無変更 (パス参照として INSERT するのみ)
#   - レスポンス: { folder_path, registered, skipped, total_dxf, files }
class _DxfFolderAddBody(BaseModel):
    folder_path: str = Field(min_length=1, max_length=512)
    label: str | None = Field(default=None, max_length=64)
    note: str | None = None
    created_by: str | None = Field(default=None, max_length=64)


class DxfFolderAddResult(BaseModel):
    folder_path: str
    registered: int
    skipped: int
    total_dxf: int
    files: list[DxfFileRead]


@router.post(
    "/{job_id}/axes/{axis_id}/dxf-folder",
    response_model=DxfFolderAddResult,
    status_code=status.HTTP_201_CREATED,
)
async def add_dxf_folder(
    job_id: str,
    axis_id: int,
    body: _DxfFolderAddBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> DxfFolderAddResult:
    """指定フォルダ配下の `.dxf` を一括で `dxf_files` に登録 (Phase J)。

    既登録 (file_path 一致) はスキップ。実ファイルのコピー/移動は行わない。
    label / note は登録した各行に共通で付与される (= フォルダ取込のメタ情報)。
    """
    await _ensure_axis(db, job_id, axis_id)

    rel = body.folder_path.strip().replace("\\", "/").lstrip("/")
    if not rel:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="folder_path を指定してください",
        )

    settings = get_settings()
    abs_dir = resolve_under(settings.fileserver_root, rel)
    if not abs_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"フォルダが見つかりません: {rel}",
        )

    existing_paths = {
        p
        for (p,) in (
            await db.execute(select(DxfFile.file_path).where(DxfFile.axis_id == axis_id))
        ).all()
    }

    registered_rows: list[DxfFile] = []
    skipped = 0
    total_dxf = 0
    for child in sorted(abs_dir.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_file():
            continue
        if child.suffix.lower() != ".dxf":
            continue
        total_dxf += 1
        child_rel = f"{rel}/{child.name}"
        if child_rel in existing_paths:
            skipped += 1
            continue
        try:
            stat = child.stat()
            size = stat.st_size
        except OSError:
            size = None
        new_row = DxfFile(
            axis_id=axis_id,
            file_path=child_rel,
            label=body.label,
            note=body.note,
            size=size,
            created_by=body.created_by or "folder_add",
        )
        db.add(new_row)
        existing_paths.add(child_rel)
        registered_rows.append(new_row)

    if registered_rows:
        await db.flush()
        for r in registered_rows:
            await db.refresh(r)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_folder.add",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "folder_path": rel,
            "registered": len(registered_rows),
            "skipped": skipped,
            "total_dxf": total_dxf,
        },
    )
    return DxfFolderAddResult(
        folder_path=rel,
        registered=len(registered_rows),
        skipped=skipped,
        total_dxf=total_dxf,
        files=[_to_read(r) for r in registered_rows],
    )


# ---- Phase J: フォルダ単位「入れ替え」-----------------------------------------
#
# 現行 (active) の DXF を全てアーカイブし、新フォルダの `.dxf` を登録する。
# 実ファイルは触らない (archived_at を立てる + 新行を INSERT するのみ)。
class _DxfFolderReplaceBody(BaseModel):
    folder_path: str = Field(min_length=1, max_length=512)


class DxfFolderReplaceResult(BaseModel):
    folder_path: str
    archived: int
    registered: int
    total_dxf: int


@router.post(
    "/{job_id}/axes/{axis_id}/dxf-folder/replace",
    response_model=DxfFolderReplaceResult,
    status_code=status.HTTP_201_CREATED,
)
async def replace_dxf_folder(
    job_id: str,
    axis_id: int,
    body: _DxfFolderReplaceBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> DxfFolderReplaceResult:
    """現行 active の DXF を全てアーカイブ → 新フォルダで再登録 (Phase J)。

    既登録 (= 同 file_path) が新フォルダ側にある場合は新規 INSERT せず、archived_at を NULL に戻す。
    実ファイルは無変更 (CLAUDE.md §2.1)。
    """
    await _ensure_axis(db, job_id, axis_id)

    rel = body.folder_path.strip().replace("\\", "/").lstrip("/")
    if not rel:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="folder_path を指定してください",
        )

    settings = get_settings()
    abs_dir = resolve_under(settings.fileserver_root, rel)
    if not abs_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"フォルダが見つかりません: {rel}",
        )

    # 1) 現行 active を一括 archive
    now = datetime.now(UTC)
    actives = (
        (
            await db.execute(
                select(DxfFile).where(DxfFile.axis_id == axis_id, DxfFile.archived_at.is_(None))
            )
        )
        .scalars()
        .all()
    )
    archived_count = 0
    for a in actives:
        a.archived_at = now
        archived_count += 1
    if archived_count:
        await db.flush()

    # 2) 新フォルダの .dxf を登録 (同 file_path 既存行があれば unarchive で再活性化)
    existing_map = {
        row.file_path: row
        for row in (
            (await db.execute(select(DxfFile).where(DxfFile.axis_id == axis_id))).scalars().all()
        )
    }

    registered_count = 0
    total_dxf = 0
    for child in sorted(abs_dir.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_file():
            continue
        if child.suffix.lower() != ".dxf":
            continue
        total_dxf += 1
        child_rel = f"{rel}/{child.name}"
        existing = existing_map.get(child_rel)
        if existing is not None:
            # 同 file_path の DB 行が既にある場合 (1で archive されたものを含む) は unarchive
            if existing.archived_at is not None:
                existing.archived_at = None
            continue
        try:
            stat = child.stat()
            size = stat.st_size
        except OSError:
            size = None
        db.add(
            DxfFile(
                axis_id=axis_id,
                file_path=child_rel,
                size=size,
                created_by="folder_replace",
            )
        )
        registered_count += 1

    if registered_count or archived_count:
        await db.flush()

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_folder.replace",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "folder_path": rel,
            "archived": archived_count,
            "registered": registered_count,
            "total_dxf": total_dxf,
        },
    )
    return DxfFolderReplaceResult(
        folder_path=rel,
        archived=archived_count,
        registered=registered_count,
        total_dxf=total_dxf,
    )


# ---- Phase K: フォルダ単位アップロード -----------------------------------------
#
# ブラウザの <input type="file" webkitdirectory> から複数 File を multipart で受領し、
# /mnt/uploads/dxf/{job}/{axis}/{relative_path} に排他作成で保存して dxf_files に登録する。
# 各ファイルの相対パスは webkitRelativePath を別フォーム値 `relative_paths` で並列受領する
# (UploadFile.filename はブラウザによりベース名のみ入る場合があるため安全側に明示送信)。
class DxfFolderUploadResult(BaseModel):
    uploaded: int
    skipped_non_dxf: int
    registered: int
    files: list[DxfFileRead]


def _safe_relative_dxf_path(rel: str) -> Path:
    """webkitRelativePath を /mnt/uploads 配下に置ける安全な相対パスに変換する。

    - 区切りを `/` に正規化し、先頭の `/` を剥がす
    - 各セグメントから危険な文字を除去 (Path Traversal 防止)
    - `..` や空セグメントはスキップ
    - 拡張子は .dxf 統一 (.DXF / .Dxf は小文字化)
    """
    s = rel.strip().replace("\\", "/").lstrip("/")
    if not s:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="relative_path が空です",
        )
    parts: list[str] = []
    for seg in s.split("/"):
        if not seg or seg in (".", ".."):
            continue
        parts.append(_safe_filename(seg))
    if not parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"無効な relative_path: {rel}",
        )
    # 最終セグメント (ファイル名) は .dxf 拡張子を強制
    last = parts[-1]
    if last.lower().endswith(".dxf"):
        if last.endswith(".DXF") or last.endswith(".Dxf"):
            last = last[:-4] + ".dxf"
    else:
        # 拡張子 .dxf 以外は呼び出し側で skip 判定するので、ここに来ることは想定外
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f".dxf 以外の拡張子: {rel}",
        )
    parts[-1] = last
    return Path(*parts)


@router.post(
    "/{job_id}/axes/{axis_id}/dxf-folder/upload",
    response_model=DxfFolderUploadResult,
    status_code=status.HTTP_201_CREATED,
)
async def upload_dxf_folder(
    job_id: str,
    axis_id: int,
    request: Request,
    files: list[UploadFile] = File(
        ..., description="アップロードする複数 DXF (webkitdirectory 由来想定)"
    ),
    relative_paths: list[str] = Form(
        default=[],
        description="各 files[i] に対する webkitRelativePath (省略時は filename)",
    ),
    label: str | None = Form(default=None),
    note: str | None = Form(default=None),
    created_by: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> DxfFolderUploadResult:
    """フォルダ配下の `.dxf` を一括アップロード → 保存 → DB 登録 (Phase K)。

    - 各ファイルは /mnt/uploads/dxf/{job}/{axis}/{relative_path} に排他作成
    - 既存衝突 (同名) はそのファイルだけ skip し、レスポンスは継続成功
    - 1 ファイル 100MB 上限。超過分はそのファイルだけ skip
    - 拡張子 .dxf 以外は skipped_non_dxf にカウント
    """
    await _ensure_axis(db, job_id, axis_id)

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="files が空です",
        )

    settings = get_settings()
    base_rel = Path("dxf") / job_id / str(axis_id)

    registered_rows: list[DxfFile] = []
    skipped_non_dxf = 0
    uploaded = 0

    for idx, uf in enumerate(files):
        raw_name = uf.filename or f"unknown_{idx}.bin"
        # relative_paths[i] が無い場合は filename を相対パスとして扱う
        raw_rel = (
            relative_paths[idx] if idx < len(relative_paths) and relative_paths[idx] else raw_name
        )

        # 拡張子チェック: .dxf 以外は skip カウントして次へ
        if not raw_rel.lower().endswith(".dxf"):
            skipped_non_dxf += 1
            await uf.close()
            continue

        try:
            rel_path = _safe_relative_dxf_path(raw_rel)
        except HTTPException:
            # 無効パスは skip 扱い (アップロード処理全体を止めない)
            skipped_non_dxf += 1
            await uf.close()
            continue

        save_rel = base_rel / rel_path
        abs_path = resolve_under(settings.upload_dir, str(save_rel))
        abs_path.parent.mkdir(parents=True, exist_ok=True)

        content = await uf.read()
        await uf.close()
        if len(content) > 100 * 1024 * 1024:
            # 100MB 超は当該ファイルのみ skip。ログにも残らないが action_log で全体記録は出る
            skipped_non_dxf += 1
            continue
        sha = hashlib.sha256(content).hexdigest()

        def _exclusive_write(path: Path, data: bytes) -> None:
            with open(path, "xb") as f:
                f.write(data)

        try:
            await asyncio.to_thread(_exclusive_write, abs_path, content)
        except FileExistsError:
            # 同名既存はそのファイルだけ skip (上書きしない)
            skipped_non_dxf += 1
            continue
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"ファイル書き込みに失敗しました: {exc}",
            ) from exc

        rel_str = str(save_rel).replace("\\", "/")
        new_row = DxfFile(
            axis_id=axis_id,
            file_path=rel_str,
            label=label,
            note=note,
            size=len(content),
            sha256=sha,
            created_by=created_by or "folder_upload",
        )
        db.add(new_row)
        registered_rows.append(new_row)
        uploaded += 1

    if registered_rows:
        await db.flush()
        for r in registered_rows:
            await db.refresh(r)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_folder.upload",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "uploaded": uploaded,
            "skipped_non_dxf": skipped_non_dxf,
            "registered": len(registered_rows),
        },
    )
    return DxfFolderUploadResult(
        uploaded=uploaded,
        skipped_non_dxf=skipped_non_dxf,
        registered=len(registered_rows),
        files=[_to_read(r) for r in registered_rows],
    )


# ---- Phase K: フォルダ単位 入れ替え (アップロード版) ---------------------------
#
# 現行 active な dxf_files を全 archive し、新フォルダを一括アップロードして登録する。
# 実ファイルは触らない (archived_at のみ + 新規 INSERT)。
class DxfFolderReplaceUploadResult(BaseModel):
    archived: int
    uploaded: int
    skipped_non_dxf: int
    registered: int
    files: list[DxfFileRead]


@router.post(
    "/{job_id}/axes/{axis_id}/dxf-folder/replace-by-upload",
    response_model=DxfFolderReplaceUploadResult,
    status_code=status.HTTP_201_CREATED,
)
async def replace_dxf_folder_by_upload(
    job_id: str,
    axis_id: int,
    request: Request,
    files: list[UploadFile] = File(..., description="新フォルダの DXF 群"),
    relative_paths: list[str] = Form(
        default=[],
        description="各 files[i] の webkitRelativePath",
    ),
    label: str | None = Form(default=None),
    note: str | None = Form(default=None),
    created_by: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> DxfFolderReplaceUploadResult:
    """現行 active 全 archive + 新フォルダ一括アップロード (Phase K)。

    実ファイルは無変更 (archived_at を立てる + 新 dxf_files 行を INSERT するだけ)。
    """
    await _ensure_axis(db, job_id, axis_id)

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="files が空です",
        )

    # 1) 現行 active を一括 archive
    now = datetime.now(UTC)
    actives = (
        (
            await db.execute(
                select(DxfFile).where(DxfFile.axis_id == axis_id, DxfFile.archived_at.is_(None))
            )
        )
        .scalars()
        .all()
    )
    archived_count = 0
    for a in actives:
        a.archived_at = now
        archived_count += 1
    if archived_count:
        await db.flush()

    # 2) 新フォルダの DXF を一括アップロード保存
    settings = get_settings()
    base_rel = Path("dxf") / job_id / str(axis_id)

    registered_rows: list[DxfFile] = []
    skipped_non_dxf = 0
    uploaded = 0

    for idx, uf in enumerate(files):
        raw_name = uf.filename or f"unknown_{idx}.bin"
        raw_rel = (
            relative_paths[idx] if idx < len(relative_paths) and relative_paths[idx] else raw_name
        )

        if not raw_rel.lower().endswith(".dxf"):
            skipped_non_dxf += 1
            await uf.close()
            continue

        try:
            rel_path = _safe_relative_dxf_path(raw_rel)
        except HTTPException:
            skipped_non_dxf += 1
            await uf.close()
            continue

        save_rel = base_rel / rel_path
        abs_path = resolve_under(settings.upload_dir, str(save_rel))
        abs_path.parent.mkdir(parents=True, exist_ok=True)

        content = await uf.read()
        await uf.close()
        if len(content) > 100 * 1024 * 1024:
            skipped_non_dxf += 1
            continue
        sha = hashlib.sha256(content).hexdigest()

        def _exclusive_write(path: Path, data: bytes) -> None:
            with open(path, "xb") as f:
                f.write(data)

        try:
            await asyncio.to_thread(_exclusive_write, abs_path, content)
        except FileExistsError:
            skipped_non_dxf += 1
            continue
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"ファイル書き込みに失敗しました: {exc}",
            ) from exc

        rel_str = str(save_rel).replace("\\", "/")
        new_row = DxfFile(
            axis_id=axis_id,
            file_path=rel_str,
            label=label,
            note=note,
            size=len(content),
            sha256=sha,
            created_by=created_by or "folder_replace_upload",
        )
        db.add(new_row)
        registered_rows.append(new_row)
        uploaded += 1

    if registered_rows:
        await db.flush()
        for r in registered_rows:
            await db.refresh(r)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="dxf_folder.replace_by_upload",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "archived": archived_count,
            "uploaded": uploaded,
            "skipped_non_dxf": skipped_non_dxf,
            "registered": len(registered_rows),
        },
    )
    return DxfFolderReplaceUploadResult(
        archived=archived_count,
        uploaded=uploaded,
        skipped_non_dxf=skipped_non_dxf,
        registered=len(registered_rows),
        files=[_to_read(r) for r in registered_rows],
    )
