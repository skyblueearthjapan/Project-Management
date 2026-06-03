from __future__ import annotations

import asyncio
import hashlib
import re
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
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import resolve_under
from app.models.axis import Axis
from app.models.job import Job
from app.models.progress import AxisProgress, ProgressStep
from app.models.version import Version
from app.schemas.axis import (
    AxisCreate,
    AxisUpdate,
    VersionCreate,
    VersionRead,
)
from app.services.audit import client_actor, write_action_log
from app.services.link_check import TARGET_VERSION, latest_link_status

router = APIRouter()


async def _ensure_job(db: AsyncSession, job_id: str) -> Job:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工番が見つかりません")
    return job


async def _ensure_axis(db: AsyncSession, job_id: str, axis_id: int) -> Axis:
    axis = await db.get(Axis, axis_id)
    if axis is None or axis.job_id != job_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="軸が見つかりません")
    return axis


@router.post("/{job_id}/axes", status_code=status.HTTP_201_CREATED)
async def create_axis(
    job_id: str,
    body: AxisCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _ensure_job(db, job_id)
    axis = Axis(job_id=job_id, **body.model_dump())
    db.add(axis)
    await db.flush()

    # 進捗工程 10 件を notstarted で初期化
    steps = (await db.execute(select(ProgressStep))).scalars().all()
    db.add_all(
        AxisProgress(axis_id=axis.id, step_id=s.id, state="notstarted") for s in steps
    )
    await db.flush()

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="axis.create",
        job_id=job_id,
        axis_id=axis.id,
        payload={"job_id": job_id, "axis_name": axis.name},
    )
    return {"id": axis.id, "name": axis.name}


@router.patch("/{job_id}/axes/{axis_id}")
async def update_axis(
    job_id: str, axis_id: int, body: AxisUpdate, db: AsyncSession = Depends(get_db)
) -> dict:
    axis = await _ensure_axis(db, job_id, axis_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(axis, k, v)
    await db.flush()
    return {"id": axis.id}


@router.get("/{job_id}/axes/{axis_id}/versions", response_model=list[VersionRead])
async def list_versions(
    job_id: str,
    axis_id: int,
    include_archived: bool = Query(
        default=False,
        description="True で archived_at IS NOT NULL の行も返す (履歴パネル用)",
    ),
    db: AsyncSession = Depends(get_db),
) -> list[VersionRead]:
    await _ensure_axis(db, job_id, axis_id)
    stmt = (
        select(Version)
        .where(Version.axis_id == axis_id)
        .order_by(Version.version_no.desc())
    )
    # Phase I: デフォルトは archived 除外。履歴パネルだけ全件取得する。
    if not include_archived:
        stmt = stmt.where(Version.archived_at.is_(None))
    rows = (await db.execute(stmt)).scalars().all()
    # Phase D: link_check_results 最新行を JOIN して is_link_broken を付与
    broken_map = await latest_link_status(db, TARGET_VERSION, [v.id for v in rows])
    return [
        VersionRead.model_validate(
            {
                **{c.name: getattr(v, c.name) for c in Version.__table__.columns},
                "is_link_broken": broken_map.get(v.id, False),
            }
        )
        for v in rows
    ]


@router.post(
    "/{job_id}/axes/{axis_id}/versions",
    response_model=VersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_version(
    job_id: str,
    axis_id: int,
    body: VersionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> VersionRead:
    await _ensure_axis(db, job_id, axis_id)
    last = (
        await db.execute(
            select(Version.version_no)
            .where(Version.axis_id == axis_id)
            .order_by(Version.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    next_no = (last or 0) + 1

    version = Version(
        axis_id=axis_id,
        version_no=next_no,
        label=body.label,
        pdf_path=body.pdf_path,
        note=body.note,
        released_at=body.released_at or datetime.now(),
        released_by=body.released_by,
    )
    db.add(version)
    await db.flush()
    await db.refresh(version)

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="version.create",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "version_no": next_no,
            "pdf_path": body.pdf_path,
            "released_by": body.released_by,
        },
    )
    return VersionRead.model_validate(version)


def _safe_filename(name: str) -> str:
    bad = set('<>:"/\\|?*\x00')
    base = Path(name).name
    return "".join("_" if c in bad else c for c in base)[:128] or "file.bin"


# ---- Phase F: 命名規約自動推定 ---------------------------------------------
# REQUIREMENTS_v2.md §6.4 の規約:
#   - rev_01.pdf → rev_02.pdf (ゼロパディング維持)
#   - v_001.pdf  → v_002.pdf
#   - Rev.A.pdf  → Rev.B.pdf  (アルファベット採番)
#   - 推定不能なら {stem}_v{N+1}.{ext} (例: drawing_v2.pdf)
# どのパターンを使うかは「元バージョンのファイル名 + 同フォルダの兄弟ファイル群」から判定。

_RE_REV_DIGITS = re.compile(
    r"^(?P<stem>.*?)(?P<sep>[_\-]?)(?P<prefix>rev|v)(?P<sep2>[_\-]?)(?P<num>\d+)$",
    re.IGNORECASE,
)
_RE_REV_ALPHA = re.compile(
    r"^(?P<stem>.*?)(?P<sep>[_\-\.]?)Rev[\.\-_]?(?P<alpha>[A-Z])$",
)


def _infer_next_filename(
    source_name: str,
    siblings: list[str],
    fallback_version_no: int,
) -> str:
    """元 PDF のファイル名と同フォルダの兄弟から、次のバージョンのファイル名を推定する。

    siblings は ".pdf" 付きの拡張子付きベース名のみのリスト。
    推定不能の場合は ``{stem}_v{fallback_version_no}.pdf`` を返す。
    """
    src = Path(source_name)
    stem = src.stem
    ext = src.suffix or ".pdf"

    # --- 数字採番 (rev_NN / v_NN) -----------------------------------------
    m = _RE_REV_DIGITS.match(stem)
    if m:
        digits = m.group("num")
        next_n = int(digits) + 1
        width = len(digits)
        # 既存兄弟から最大採番を取って +1 する (rev_03 が既にあれば rev_04 に飛ばす)
        prefix = m.group("prefix")
        sep = m.group("sep")
        sep2 = m.group("sep2")
        base_stem = m.group("stem")
        for sib in siblings:
            sibstem = Path(sib).stem
            sm = _RE_REV_DIGITS.match(sibstem)
            if not sm:
                continue
            if (
                sm.group("stem") == base_stem
                and sm.group("prefix").lower() == prefix.lower()
            ):
                try:
                    sn = int(sm.group("num"))
                except ValueError:
                    continue
                if sn + 1 > next_n:
                    next_n = sn + 1
                    width = max(width, len(sm.group("num")))
        return f"{base_stem}{sep}{prefix}{sep2}{str(next_n).zfill(width)}{ext}"

    # --- アルファベット採番 (Rev.A) ----------------------------------------
    am = _RE_REV_ALPHA.match(stem)
    if am:
        ch = am.group("alpha")
        nxt_ord = ord(ch) + 1
        # 兄弟をスキャンして最大の英字 +1
        base_stem = am.group("stem")
        sep = am.group("sep") or ""
        for sib in siblings:
            sibstem = Path(sib).stem
            asm = _RE_REV_ALPHA.match(sibstem)
            if not asm:
                continue
            if asm.group("stem") == base_stem:
                so = ord(asm.group("alpha"))
                if so + 1 > nxt_ord:
                    nxt_ord = so + 1
        if nxt_ord > ord("Z"):
            # Rev.Z 越え。fallback に倒す。
            return f"{stem}_v{fallback_version_no}{ext}"
        return f"{base_stem}{sep}Rev.{chr(nxt_ord)}{ext}"

    # --- 推定不能: stem_v{N}.pdf ------------------------------------------
    return f"{stem}_v{fallback_version_no}{ext}"


@router.post(
    "/{job_id}/axes/{axis_id}/versions/upload",
    response_model=VersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_version(
    job_id: str,
    axis_id: int,
    request: Request,
    file: UploadFile = File(..., description="アップロードする PDF"),
    label: str | None = Form(default=None),
    note: str | None = Form(default=None),
    released_by: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> VersionRead:
    """PDF をアップロードして新バージョンとして登録する。

    保存先: /mnt/uploads/releases/{job_id}/{axis_id}/v{n}_{safe_name}.pdf
    削除は一切行わない (CLAUDE.md §2.1)。
    """
    await _ensure_axis(db, job_id, axis_id)
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PDF以外のファイルは受け付けません: {file.content_type}",
        )

    settings = get_settings()
    last = (
        await db.execute(
            select(Version.version_no)
            .where(Version.axis_id == axis_id)
            .order_by(Version.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    next_no = (last or 0) + 1

    safe = _safe_filename(file.filename or "drawing.pdf")
    if not safe.lower().endswith(".pdf"):
        safe = f"{safe}.pdf"
    rel = Path("releases") / job_id / str(axis_id) / f"v{next_no:02d}_{safe}"
    abs_path = resolve_under(settings.upload_dir, str(rel))
    abs_path.parent.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    if len(content) > 200 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="200MB を超えるPDFは受け付けません",
        )
    abs_path.write_bytes(content)
    sha = hashlib.sha256(content).hexdigest()

    version = Version(
        axis_id=axis_id,
        version_no=next_no,
        label=label,
        pdf_path=str(rel).replace("\\", "/"),
        pdf_size=len(content),
        pdf_sha256=sha,
        note=note,
        released_at=datetime.now(),
        released_by=released_by,
    )
    db.add(version)
    await db.flush()
    await db.refresh(version)

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="version.upload",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "version_no": next_no,
            "pdf_path": str(rel).replace("\\", "/"),
            "released_by": released_by,
        },
    )
    return VersionRead.model_validate(version)


# ---- Phase F: 編集後 PDF を新バージョンとしてファイルサーバに保存 -------------
#
# Marin-PDF 移植版 PdfViewer で差替を行った結果をサーバ側に保存するための新規エンドポイント。
# 元 PDF と同じフォルダに「新ファイルとして」書き込む (=旧版は無傷で残す)。
#
# 重要な不変条件 (CLAUDE.md §2.1 / §2.2 改訂版):
#   1. 削除関数を一切使わない (os.remove / unlink / rmdir / shutil.rmtree / rename 等)
#   2. open(path, "xb") の排他作成で書き込む。既存ファイルがあれば FileExistsError →
#      409 Conflict で停止。リネーム / 連番付与 / 上書きは行わない (ユーザーに報告)
#   3. 保存先パスは resolve_under(fileserver_root, ...) で `/mnt/fileserver` 配下強制
#   4. 200MB 上限
#
@router.post(
    "/{job_id}/axes/{axis_id}/versions/save-edited",
    response_model=VersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def save_edited_version(
    job_id: str,
    axis_id: int,
    request: Request,
    file: UploadFile = File(..., description="編集後の PDF bytes"),
    source_version_id: int | None = Form(default=None),
    filename: str | None = Form(default=None),
    label: str | None = Form(default=None),
    note: str | None = Form(default=None),
    released_by: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> VersionRead:
    """Marin-PDF 編集の結果を「ファイルサーバ上の元と同じフォルダ」に新バージョンとして保存する。

    元バージョンは ``source_version_id`` (指定なければ最新の version) を採用。
    そのバージョンの ``pdf_path`` から保存先ディレクトリを決め、命名規約を推定して
    新ファイル名を作る (ユーザーが ``filename`` を指定した場合はそちらを優先)。

    既存ファイルがあれば 409 で停止し、上書きや連番付与は行わない。
    """
    await _ensure_axis(db, job_id, axis_id)

    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PDF以外のファイルは受け付けません: {file.content_type}",
        )

    settings = get_settings()

    # ---- 1) 元バージョンを特定 ------------------------------------------
    stmt = select(Version).where(Version.axis_id == axis_id)
    if source_version_id is not None:
        stmt = stmt.where(Version.id == source_version_id)
    else:
        stmt = stmt.order_by(Version.version_no.desc())
    source_version = (await db.execute(stmt.limit(1))).scalar_one_or_none()
    if source_version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="元バージョンが見つかりません",
        )

    # 元 PDF が /mnt/fileserver 配下にあることを前提とする (アップロード経由のものは保存先が異なる)
    src_rel = source_version.pdf_path.lstrip("/")
    if src_rel.startswith("releases/") or src_rel.startswith("replacements/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "元バージョンが /mnt/uploads 経由で登録されているため、"
                "ファイルサーバの元フォルダへの保存対象として扱えません。"
            ),
        )

    # ---- 2) 同フォルダの兄弟ファイル名を取得して命名規約を推定 ---------------
    src_abs = resolve_under(settings.fileserver_root, src_rel)
    src_dir = src_abs.parent
    if not src_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"元 PDF のフォルダが存在しません: {src_dir}",
        )

    # 兄弟一覧 (PDF のみ。ディレクトリは除外)
    siblings: list[str] = []
    for child in src_dir.iterdir():
        if child.is_file() and child.suffix.lower() == ".pdf":
            siblings.append(child.name)

    # ---- 3) 内容を読み込み (上限チェック) -----------------------------------
    # B-1 修正方針: 「DB 先 → ファイル後」順序を厳守するため、ここでバイト列を確定
    # させてから DB 行 INSERT に進む。ファイル名は version_no に依存する場合があるため、
    # M-3 の retry ループ内で都度算出する。
    content = await file.read()
    if len(content) > 200 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="200MB を超えるPDFは受け付けません",
        )
    sha = hashlib.sha256(content).hexdigest()

    # ---- 4) version_no 採番 + DB 行確保 (M-3: 衝突時 1 回リトライ) ----------
    # 並行リクエストで同じ next_no を取得すると uq_versions_axis_versionno に違反する。
    # IntegrityError を 1 回リトライしてから 409 に倒す。
    max_retry = 2
    version: Version | None = None
    new_rel: str = ""
    abs_path: Path | None = None
    target_name: str = ""

    for attempt in range(max_retry + 1):
        last_no = (
            await db.execute(
                select(Version.version_no)
                .where(Version.axis_id == axis_id)
                .order_by(Version.version_no.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        next_no = (last_no or 0) + 1

        if filename:
            # ユーザー指定。Path Traversal 防止のためベース名のみに丸める。
            target_name = _safe_filename(filename)
            if not target_name.lower().endswith(".pdf"):
                target_name = f"{target_name}.pdf"
        else:
            target_name = _infer_next_filename(
                source_name=src_abs.name,
                siblings=siblings,
                fallback_version_no=next_no,
            )
            # 推定結果も念のためサニタイズ
            target_name = _safe_filename(target_name)
            if not target_name.lower().endswith(".pdf"):
                target_name = f"{target_name}.pdf"

        new_rel = (Path(src_rel).parent / target_name).as_posix()
        abs_path = resolve_under(settings.fileserver_root, new_rel)

        version = Version(
            axis_id=axis_id,
            version_no=next_no,
            label=label,
            pdf_path=new_rel,
            pdf_size=len(content),
            pdf_sha256=sha,
            note=note,
            released_at=datetime.now(),
            released_by=released_by,
        )
        db.add(version)
        try:
            await db.flush()
            break
        except IntegrityError:
            # version_no 競合。rollback して再度 SELECT MAX → +1 から retry。
            await db.rollback()
            if attempt >= max_retry:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="バージョン番号が衝突しました。再試行してください。",
                ) from None
            version = None
            continue

    # 念のための型ガード (理論上ここに到達した時点で version / abs_path は確定済み)
    if version is None or abs_path is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="バージョン採番に失敗しました",
        )

    # ---- 5) SMB に排他作成で書き込む (上書き禁止) ---------------------------
    # open(path, "xb") は既存ファイルがあれば FileExistsError を投げる。
    # CLAUDE.md §2.1 / §2.2: 既存があってもリネームせず、削除もせず、409 で止める。
    # 同期 open を使う理由: "xb" モード (exclusive-create) は aiofiles 等で安定して
    # サポートされていないため、event loop をブロックしないよう to_thread で逃がす。
    #
    # B-1: ファイル書込が失敗した場合、上記で flush 済みの DB 行は orphan になる。
    # 削除関数は禁止 (CLAUDE.md §2.1) のため、明示的に db.rollback() を呼んで
    # uncommitted な version 行を破棄してから HTTPException を投げる。
    # FastAPI の get_db dependency は exception 経由でも rollback するので二重 OK。
    def _exclusive_write(path: Path, data: bytes) -> None:
        with open(path, "xb") as f:
            f.write(data)

    try:
        await asyncio.to_thread(_exclusive_write, abs_path, content)
    except FileExistsError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"同名ファイルが既に存在します: {target_name}。"
                "ファイル名を変更して再度保存してください (上書きは行いません)。"
            ),
        ) from exc
    except OSError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ファイル書き込みに失敗しました: {exc}",
        ) from exc

    # ---- 6) ここまで来れば DB / ファイル共に整合。get_db dependency の自動 commit に任せる。
    await db.refresh(version)

    # H-1: 監査ログ (編集後 PDF を新バージョンとして保存)
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="version.save_edited",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "version_no": version.version_no,
            "pdf_path": version.pdf_path,
            "released_by": released_by,
            "source_version_id": source_version_id,
        },
    )
    return VersionRead.model_validate(version)


# ---- Phase I: アーカイブ / 復帰 / 過去版を現行に復元 ---------------------------
#
# 仕様:
#   - archive   : archived_at = now()。実 PDF ファイルは絶対に消さない (CLAUDE.md §2.1)
#   - unarchive : archived_at = NULL
#   - restore-as-current : 過去版を「最新 version_no + 1」として複製作成 (新規 INSERT)
#
# いずれのエンドポイントも DB 行を立てる/書き換えるだけで、ファイル本体は touch しない。
async def _get_version_or_404(
    db: AsyncSession, axis_id: int, version_id: int
) -> Version:
    v = await db.get(Version, version_id)
    if v is None or v.axis_id != axis_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="バージョンが見つかりません"
        )
    return v


@router.patch(
    "/{job_id}/axes/{axis_id}/versions/{version_id}/archive",
    response_model=VersionRead,
)
async def archive_version(
    job_id: str,
    axis_id: int,
    version_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> VersionRead:
    """バージョンを論理アーカイブ (取消相当)。PDF 本体は削除しない。"""
    await _ensure_axis(db, job_id, axis_id)
    version = await _get_version_or_404(db, axis_id, version_id)
    if version.archived_at is None:
        version.archived_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(version)
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="version.archive",
        job_id=job_id,
        axis_id=axis_id,
        payload={"job_id": job_id, "axis_id": axis_id, "version_id": version_id},
    )
    return VersionRead.model_validate(version)


@router.patch(
    "/{job_id}/axes/{axis_id}/versions/{version_id}/unarchive",
    response_model=VersionRead,
)
async def unarchive_version(
    job_id: str,
    axis_id: int,
    version_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> VersionRead:
    """バージョンをアーカイブから復帰させる。"""
    await _ensure_axis(db, job_id, axis_id)
    version = await _get_version_or_404(db, axis_id, version_id)
    if version.archived_at is not None:
        version.archived_at = None
        await db.flush()
        await db.refresh(version)
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="version.unarchive",
        job_id=job_id,
        axis_id=axis_id,
        payload={"job_id": job_id, "axis_id": axis_id, "version_id": version_id},
    )
    return VersionRead.model_validate(version)


# ---- Phase J: 現行を「入れ替え」 (アーカイブ + 新バージョン作成を 1 操作で) -----
#
# 編集 UI 「⚙ PDF を編集」 → 「入れ替え」 から呼ばれる。
# multipart (アップロード) と JSON (パス参照) の両対応をひとつのエンドポイントに集約する:
#   - file 指定あり: アップロード → /mnt/uploads/releases/{job}/{axis}/v{N}_{safe}.pdf に保存
#   - pdf_path 指定あり: パス参照のみ登録
# どちらかは必須。両方あり → file を優先。
# 現行 (active 最大 version_no) があれば archived_at = NOW() で 1 件アーカイブしてから
# 新 version_no を採番して INSERT する。
@router.post(
    "/{job_id}/axes/{axis_id}/versions/replace-current",
    status_code=status.HTTP_201_CREATED,
)
async def replace_current_version(
    job_id: str,
    axis_id: int,
    request: Request,
    file: UploadFile | None = File(default=None, description="新 PDF をアップロード"),
    pdf_path: str | None = Form(default=None, description="新 PDF のサーバパス (file 省略時)"),
    label: str | None = Form(default=None),
    note: str | None = Form(default=None),
    released_by: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """現行 PDF をアーカイブ + 新 PDF を新バージョンとして登録 (Phase J)。

    実 PDF は触らない (CLAUDE.md §2.1)。
    """
    await _ensure_axis(db, job_id, axis_id)

    has_upload = file is not None and (file.filename or "").strip() != ""
    has_path = pdf_path is not None and pdf_path.strip() != ""
    if not has_upload and not has_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="file または pdf_path のいずれかを指定してください",
        )

    # 1) 現行 (active 最大 version_no) を取得 → archive
    current = (
        await db.execute(
            select(Version)
            .where(Version.axis_id == axis_id, Version.archived_at.is_(None))
            .order_by(Version.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    old_version_id = current.id if current is not None else None
    if current is not None and current.archived_at is None:
        current.archived_at = datetime.now(UTC)
        await db.flush()

    # 2) 新 version_no 採番
    last_no = (
        await db.execute(
            select(Version.version_no)
            .where(Version.axis_id == axis_id)
            .order_by(Version.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    next_no = (last_no or 0) + 1

    settings = get_settings()
    new_version: Version
    if has_upload:
        # アップロード経路 (upload_version とほぼ同じだが version_no 採番済み前提)
        if file is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="アップロードファイルが取得できませんでした",
            )
        if file.content_type not in {"application/pdf", "application/octet-stream"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"PDF以外のファイルは受け付けません: {file.content_type}",
            )
        safe = _safe_filename(file.filename or "drawing.pdf")
        if not safe.lower().endswith(".pdf"):
            safe = f"{safe}.pdf"
        rel = Path("releases") / job_id / str(axis_id) / f"v{next_no:02d}_{safe}"
        abs_path = resolve_under(settings.upload_dir, str(rel))
        abs_path.parent.mkdir(parents=True, exist_ok=True)

        content = await file.read()
        if len(content) > 200 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="200MB を超えるPDFは受け付けません",
            )
        abs_path.write_bytes(content)
        sha = hashlib.sha256(content).hexdigest()

        new_version = Version(
            axis_id=axis_id,
            version_no=next_no,
            label=label,
            pdf_path=str(rel).replace("\\", "/"),
            pdf_size=len(content),
            pdf_sha256=sha,
            note=note,
            released_at=datetime.now(UTC),
            released_by=released_by,
        )
    else:
        # パス参照経路
        if pdf_path is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="pdf_path が空です",
            )
        rel_str = pdf_path.strip().replace("\\", "/").lstrip("/")
        if not rel_str.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="pdf_path は拡張子 .pdf を指定してください",
            )
        new_version = Version(
            axis_id=axis_id,
            version_no=next_no,
            label=label,
            pdf_path=rel_str,
            note=note,
            released_at=datetime.now(UTC),
            released_by=released_by,
        )

    db.add(new_version)
    await db.flush()
    await db.refresh(new_version)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="version.replace_current",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "old_version_id": old_version_id,
            "new_version_id": new_version.id,
            "new_version_no": next_no,
        },
    )
    return {
        "archived_version_id": old_version_id,
        "new_version": VersionRead.model_validate(new_version).model_dump(mode="json"),
    }


@router.post(
    "/{job_id}/axes/{axis_id}/versions/{version_id}/restore-as-current",
    response_model=VersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def restore_version_as_current(
    job_id: str,
    axis_id: int,
    version_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> VersionRead:
    """過去のバージョンを「現行」として新しい version_no で複製作成する。

    実 PDF はそのまま (= 同じ pdf_path を指す)。新規 version 行のみを INSERT し、
    自動でラベル / メモを補う。元バージョンは無変更 (archived ならそのまま archived)。
    """
    await _ensure_axis(db, job_id, axis_id)
    source = await _get_version_or_404(db, axis_id, version_id)

    last_no = (
        await db.execute(
            select(Version.version_no)
            .where(Version.axis_id == axis_id)
            .order_by(Version.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    next_no = (last_no or 0) + 1

    auto_label = f"rev_{next_no:02d} (v{source.version_no} を現行に復元)"
    auto_note = f"v{source.version_no} の内容を最新版として復元"

    new_version = Version(
        axis_id=axis_id,
        version_no=next_no,
        label=auto_label,
        pdf_path=source.pdf_path,
        pdf_size=source.pdf_size,
        pdf_sha256=source.pdf_sha256,
        note=auto_note,
        released_at=datetime.now(UTC),
        released_by=source.released_by,
    )
    db.add(new_version)
    await db.flush()
    await db.refresh(new_version)

    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="version.restore_as_current",
        job_id=job_id,
        axis_id=axis_id,
        payload={
            "job_id": job_id,
            "axis_id": axis_id,
            "source_version_id": version_id,
            "new_version_id": new_version.id,
            "new_version_no": next_no,
        },
    )
    return VersionRead.model_validate(new_version)
