"""工番マスタ Excel インポーター (Stock Management 由来の Phase1/Phase2)。

- Phase 1: 新一覧.xlsm「正」シート → job_master_cache に upsert (is_active=false)
- Phase 2: 日程表A.xlsx の 4 シート (印刷用日程表 A/TS/EM + コマツ金沢受注一覧)
           → is_active=true で更新/追加

呼び出し元: APScheduler (60秒間隔)。
**Excel への書込・削除は一切行わない。** openpyxl は read_only=True で開く。
"""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.excel_reader import cell_date, cell_str, read_workbook

logger = get_logger(__name__)


_PHASE2_SHEETS = ("印刷用日程表　A", "印刷用日程表　TS", "印刷用日程表　EM")
_KOMATSU_SHEET = "コマツ金沢受注一覧"


def _to_json(d: dict | None) -> str | None:
    return json.dumps(d, ensure_ascii=False) if d else None


async def _upsert(
    db: AsyncSession,
    *,
    job_no: str,
    title: str | None,
    customer: str | None,
    delivery_date,
    owner: str | None,
    is_active: bool,
    source: str,
    raw: dict | None,
) -> str:
    """job_master_cache に UPSERT。戻り値: "created" / "updated"。"""
    found = (
        await db.execute(
            text("SELECT job_no FROM job_master_cache WHERE job_no = :j"), {"j": job_no}
        )
    ).fetchone()
    params = {
        "j": job_no,
        "title": title,
        "customer": customer,
        "due": delivery_date,
        "owner": owner,
        "active": is_active,
        "src": source,
        "raw": _to_json(raw),
    }
    if found is None:
        await db.execute(
            text(
                "INSERT INTO job_master_cache"
                " (job_no, title, customer, delivery_date, is_active, owner, source, raw)"
                " VALUES (:j, :title, :customer, :due, :active, :owner, :src,"
                "         CAST(:raw AS JSON))"
            ),
            params,
        )
        return "created"
    await db.execute(
        text(
            "UPDATE job_master_cache SET"
            " title = COALESCE(:title, title),"
            " customer = COALESCE(:customer, customer),"
            " delivery_date = COALESCE(:due, delivery_date),"
            " owner = COALESCE(:owner, owner),"
            " is_active = :active,"
            " source = :src,"
            " raw = COALESCE(CAST(:raw AS JSON), raw),"
            " imported_at = NOW()"
            " WHERE job_no = :j"
        ),
        params,
    )
    return "updated"


async def import_phase1(db: AsyncSession, path: Path) -> dict[str, int]:
    """新一覧.xlsm「正」シート → 全件 is_active=false にリセット後、行ごとに upsert。"""
    stats = {"created": 0, "updated": 0, "rows": 0}
    if not path.is_file():
        logger.warning("phase1_excel_not_found", path=str(path))
        return stats
    wb = read_workbook(path)
    try:
        if "正" not in wb.sheetnames:
            logger.warning("phase1_sheet_not_found", path=str(path), sheets=wb.sheetnames)
            return stats
        ws = wb["正"]

        # シード行を残さないため、まず全件 inactive にする (Phase1 の意味通り)
        await db.execute(text("UPDATE job_master_cache SET is_active = FALSE"))

        for row in ws.iter_rows(min_row=2, values_only=True):
            job_no = cell_str(row[0] if len(row) > 0 else None)
            if not job_no:
                continue
            dealer = cell_str(row[1] if len(row) > 1 else None)
            customer = cell_str(row[2] if len(row) > 2 else None)
            title = cell_str(row[3] if len(row) > 3 else None)
            extra: dict = {}
            if dealer:
                extra["dealer"] = dealer
            action = await _upsert(
                db,
                job_no=job_no,
                title=title,
                customer=customer,
                delivery_date=None,
                owner=None,
                is_active=False,
                source="shin_ichiran/正",
                raw=extra or None,
            )
            stats[action] += 1
            stats["rows"] += 1
    finally:
        wb.close()
    return stats


async def import_phase2(db: AsyncSession, path: Path) -> dict[str, int]:
    """日程表A.xlsx → 4 シートを is_active=true で更新/追加。"""
    stats = {"created": 0, "updated": 0, "rows": 0}
    if not path.is_file():
        logger.warning("phase2_excel_not_found", path=str(path))
        return stats
    wb = read_workbook(path)
    try:
        for canonical in _PHASE2_SHEETS:
            ws = None
            for sn in wb.sheetnames:
                if sn.rstrip() == canonical.rstrip():
                    ws = wb[sn]
                    break
            if ws is None:
                continue
            for row in ws.iter_rows(min_row=2, values_only=True):
                job_no = cell_str(row[0] if len(row) > 0 else None)
                if not job_no:
                    continue
                dealer = cell_str(row[1] if len(row) > 1 else None)
                customer = cell_str(row[2] if len(row) > 2 else None)
                title = cell_str(row[3] if len(row) > 3 else None)
                due = cell_date(row[5] if len(row) > 5 else None)
                owner = cell_str(row[7] if len(row) > 7 else None)
                extra: dict = {}
                if dealer:
                    extra["dealer"] = dealer
                action = await _upsert(
                    db,
                    job_no=job_no,
                    title=title,
                    customer=customer,
                    delivery_date=due,
                    owner=owner,
                    is_active=True,
                    source=f"nittei_a/{canonical.strip()}",
                    raw=extra or None,
                )
                stats[action] += 1
                stats["rows"] += 1

        # コマツ金沢受注一覧
        kws = None
        for sn in wb.sheetnames:
            if sn == _KOMATSU_SHEET:
                kws = wb[sn]
                break
        if kws is not None:
            for row in kws.iter_rows(min_row=2, values_only=True):
                job_no = cell_str(row[0] if len(row) > 0 else None)
                if not job_no:
                    continue
                dealer = cell_str(row[1] if len(row) > 1 else None)
                customer = cell_str(row[2] if len(row) > 2 else None)
                title = cell_str(row[3] if len(row) > 3 else None)
                due = cell_date(row[5] if len(row) > 5 else None)
                project_no = cell_str(row[6] if len(row) > 6 else None)
                delivery_card = cell_str(row[7] if len(row) > 7 else None)
                komatsu_due = cell_date(row[8] if len(row) > 8 else None)
                extra = {}
                if dealer:
                    extra["dealer"] = dealer
                if project_no:
                    extra["project_no"] = project_no
                if delivery_card:
                    extra["delivery_card"] = delivery_card
                if komatsu_due:
                    extra["komatsu_due"] = komatsu_due.isoformat()
                action = await _upsert(
                    db,
                    job_no=job_no,
                    title=title,
                    customer=customer,
                    delivery_date=due,
                    owner=None,
                    is_active=True,
                    source="nittei_a/コマツ金沢受注一覧",
                    raw=extra or None,
                )
                stats[action] += 1
                stats["rows"] += 1
    finally:
        wb.close()
    return stats


async def sync_master_excel(db: AsyncSession) -> dict[str, int]:
    settings = get_settings()
    s1 = await import_phase1(db, Path(settings.master_excel_path_shin_ichiran))
    s2 = await import_phase2(db, Path(settings.master_excel_path_nittei_hyo_a))
    await db.commit()
    summary = {
        "phase1_created": s1["created"],
        "phase1_updated": s1["updated"],
        "phase2_created": s2["created"],
        "phase2_updated": s2["updated"],
        "rows": s1["rows"] + s2["rows"],
    }
    logger.info("master_excel_synced", **summary)
    return summary
