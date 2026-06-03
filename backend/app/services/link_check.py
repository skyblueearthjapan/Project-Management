from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.attachment import PartsListVersion, PdfReplacement, RelatedDoc
from app.models.dxf import DxfFile
from app.models.system import LinkCheckResult
from app.models.version import Version

logger = get_logger(__name__)


# Phase D: target_type の正規値 (link_check_results.target_type)
TARGET_VERSION = "version"
TARGET_RELATED_DOC = "related_doc"
TARGET_PARTS_LIST_VERSION = "parts_list_version"
TARGET_PDF_REPLACEMENT = "pdf_replacement"
# V2 製造現場 DX: DXF ファイル参照
TARGET_DXF_FILE = "dxf_file"


async def latest_link_status(
    db: AsyncSession, target_type: str, target_ids: list[int]
) -> dict[int, bool]:
    """各 target_id について 最新行が 'missing' なら True を返す。

    'ok' / 'error' / 結果なし は False (= リンク健全 / 未検査)。
    Phase D: 一覧 API で `is_link_broken` を埋めるためのヘルパ。

    Phase D Major-2 修正: PostgreSQL の DISTINCT ON で target_id ごとの最新行を
    1 ステップで取得する。これにより同一 microsec で異 target_type が衝突する
    edge case (subquery で max(checked_at) を取ると target_type を一意に区別できない)
    を排除する。実運用 DB は PostgreSQL のみなので PG パスのみ実装する。
    """
    if not target_ids:
        return {}

    # PostgreSQL の DISTINCT ON: target_id でグループ化、ORDER BY の先頭で 1 行に絞る。
    # WHERE で target_type を限定しているため、edge case の取り違えは原理的に発生しない。
    stmt = (
        select(LinkCheckResult)
        .where(
            LinkCheckResult.target_type == target_type,
            LinkCheckResult.target_id.in_(target_ids),
        )
        .order_by(
            LinkCheckResult.target_id,
            LinkCheckResult.checked_at.desc(),
        )
        .distinct(LinkCheckResult.target_id)
    )
    rows = (await db.execute(stmt)).scalars().all()
    out: dict[int, bool] = dict.fromkeys(target_ids, False)
    for r in rows:
        out[r.target_id] = r.status == "missing"
    return out


async def _check_one(
    db: AsyncSession, target_type: str, target_id: int, rel_path: str, base: Path
) -> str:
    """1 ファイルを即時チェックして link_check_results に追記、status を返す。"""
    try:
        full = (base / rel_path).resolve()
        base_resolved = base.resolve()
        if not full.is_relative_to(base_resolved):
            status = "error"
            err: str | None = "out_of_base"
        elif full.is_file():
            status = "ok"
            err = None
        else:
            status = "missing"
            err = None
    except OSError as e:
        status = "error"
        err = str(e)
    db.add(
        LinkCheckResult(
            target_type=target_type,
            target_id=target_id,
            file_path=rel_path,
            status=status,
            error=err,
        )
    )
    return status


async def run_link_check_for_axis(db: AsyncSession, axis_id: int) -> dict[str, int]:
    """軸限定の即時リンクチェック (Phase D の「再チェック」ボタン用)。

    対象: 当該軸の versions / related_docs / parts_list_versions / pdf_replacements
    削除はしない (履歴を残す)。
    """
    settings = get_settings()
    # versions / related_docs は fileserver_root 配下、
    # pdf_replacements は upload_dir 配下にあるため、別々の base を使う。
    fs_base = settings.fileserver_root
    up_base = settings.upload_dir

    checked = 0
    ok = 0
    missing = 0

    def _bump(status: str) -> None:
        nonlocal checked, ok, missing
        checked += 1
        if status == "ok":
            ok += 1
        elif status == "missing":
            missing += 1

    # versions
    for v in (await db.execute(select(Version).where(Version.axis_id == axis_id))).scalars().all():
        # versions.pdf_path は releases/... なら uploads 配下、それ以外は fileserver
        rel = v.pdf_path.lstrip("/")
        base = up_base if rel.startswith(("releases/", "replacements/")) else fs_base
        _bump(await _check_one(db, TARGET_VERSION, v.id, rel, base))

    # related_docs (ソフトデリート行は対象外)
    for d in (
        (
            await db.execute(
                select(RelatedDoc)
                .where(RelatedDoc.axis_id == axis_id)
                .where(RelatedDoc.deleted_at.is_(None))
            )
        )
        .scalars()
        .all()
    ):
        _bump(await _check_one(db, TARGET_RELATED_DOC, d.id, d.file_path, fs_base))

    # parts_list_versions: parts_lists.axis_id 経由なので join (ソフトデリート除外)
    plv_stmt = (
        select(PartsListVersion)
        .join(PartsListVersion.parts_list)
        .where(PartsListVersion.parts_list.has(axis_id=axis_id))
        .where(PartsListVersion.deleted_at.is_(None))
    )
    for plv in (await db.execute(plv_stmt)).scalars().all():
        _bump(await _check_one(db, TARGET_PARTS_LIST_VERSION, plv.id, plv.file_path, fs_base))

    # pdf_replacements (常に uploads 配下、ソフトデリート除外)
    for rep in (
        (
            await db.execute(
                select(PdfReplacement)
                .where(PdfReplacement.axis_id == axis_id)
                .where(PdfReplacement.deleted_at.is_(None))
            )
        )
        .scalars()
        .all()
    ):
        _bump(await _check_one(db, TARGET_PDF_REPLACEMENT, rep.id, rep.replaced_pdf_path, up_base))

    # dxf_files: パス参照は fileserver 配下、アップロードは uploads 配下 (`dxf/` 先頭)
    for dxf in (
        (await db.execute(select(DxfFile).where(DxfFile.axis_id == axis_id))).scalars().all()
    ):
        rel = dxf.file_path.lstrip("/")
        base = up_base if rel.startswith("dxf/") else fs_base
        _bump(await _check_one(db, TARGET_DXF_FILE, dxf.id, rel, base))

    await db.flush()
    logger.info(
        "link_check_for_axis_done",
        axis_id=axis_id,
        checked=checked,
        ok=ok,
        missing=missing,
    )
    return {"checked": checked, "ok": ok, "missing": missing}


async def run_link_check(db: AsyncSession) -> dict[str, int]:
    """SMB上の参照先ファイルが残っているか確認し、結果を `link_check_results` に追記する。

    Phase D 改修: pdf_replacements も対象に追加。
    versions.pdf_path が `releases/`/`replacements/` で始まる場合は upload_dir 配下を参照。
    削除はしない (履歴として残す)。
    """
    settings = get_settings()
    fs_base = settings.fileserver_root
    up_base = settings.upload_dir
    ok = 0
    missing = 0

    async def _track(status: str) -> None:
        nonlocal ok, missing
        if status == "ok":
            ok += 1
        elif status == "missing":
            missing += 1

    for v in (await db.execute(select(Version))).scalars().all():
        rel = v.pdf_path.lstrip("/")
        base = up_base if rel.startswith(("releases/", "replacements/")) else fs_base
        await _track(await _check_one(db, TARGET_VERSION, v.id, rel, base))
    # ソフトデリート行はチェック対象外 (一覧から非表示なので link_broken 判定不要)
    for d in (
        await db.execute(select(RelatedDoc).where(RelatedDoc.deleted_at.is_(None)))
    ).scalars().all():
        await _track(await _check_one(db, TARGET_RELATED_DOC, d.id, d.file_path, fs_base))
    for plv in (
        await db.execute(
            select(PartsListVersion).where(PartsListVersion.deleted_at.is_(None))
        )
    ).scalars().all():
        await _track(
            await _check_one(db, TARGET_PARTS_LIST_VERSION, plv.id, plv.file_path, fs_base)
        )
    for rep in (
        await db.execute(
            select(PdfReplacement).where(PdfReplacement.deleted_at.is_(None))
        )
    ).scalars().all():
        await _track(
            await _check_one(db, TARGET_PDF_REPLACEMENT, rep.id, rep.replaced_pdf_path, up_base)
        )
    for dxf in (await db.execute(select(DxfFile))).scalars().all():
        rel = dxf.file_path.lstrip("/")
        base = up_base if rel.startswith("dxf/") else fs_base
        await _track(await _check_one(db, TARGET_DXF_FILE, dxf.id, rel, base))

    await db.flush()
    logger.info("link_check_done", ok=ok, missing=missing)
    return {"ok": ok, "missing": missing}
