from __future__ import annotations

import unicodedata
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.db import get_db
from app.models.axis import Axis
from app.models.axis_phase_stamp import AxisPhaseStamp
from app.models.job import Job
from app.models.job_master import JobMasterCache
from app.models.job_phase_stamp import JobPhaseStamp
from app.models.progress import AxisProgress, ProgressStep
from app.models.version import Version
from app.models.worker import Worker
from app.schemas.axis_phase_stamp import AxisPhaseStampRead
from app.schemas.common import Page
from app.schemas.job import (
    AxisProgressRead,
    AxisRead,
    JobCreate,
    JobRead,
    JobUpdate,
)
from app.schemas.job_phase_stamp import PhaseStampRead
from app.services.audit import client_actor, write_action_log
from app.services.link_check import TARGET_VERSION, latest_link_status


def _normalize(s: str) -> str:
    """NFKC + lowercase。全角/半角・大文字小文字を吸収する。"""
    return unicodedata.normalize("NFKC", s or "").strip().lower()


# SQL 側で全角/半角・大小を吸収するための写像。
# PostgreSQL の translate(col, FROM, TO) で 1 文字単位の対応置換 → 最後に lower()。
# Python の NFKC とは別実装だが、よく使われる文字 (英数 / 記号 / スペース)
# については等価な結果を返す。FROM と TO の文字数は厳密に一致させること。
_SQL_FW_CHARS = (
    # 全角英大
    "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ"
    # 全角英小
    "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ"
    # 全角数字
    "0123456789".translate(str.maketrans("0123456789", "０１２３４５６７８９"))
    # 全角記号
    + "－＿．，：；！？／＠＃＄％＾＆＊（）［］｛｝＋＝"
    # 全角スペース
    + "　"
)
_SQL_HW_CHARS = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "0123456789"
    "-_.,:;!?/@#$%^&*()[]{}+="
    " "
)
assert len(_SQL_FW_CHARS) == len(_SQL_HW_CHARS), (
    "translate の FROM / TO は同数文字でなければならない: "
    f"{len(_SQL_FW_CHARS)} vs {len(_SQL_HW_CHARS)}"
)


def _sql_normalize(col):
    """SQL 式: 列を 全角→半角 + lower で正規化。translate() は 1 文字単位の写像。

    クエリ側も Python で同様の正規化をかけることで、ユーザーが全角で入力しても
    半角でも、大文字でも小文字でもヒットするようになる。
    """
    return func.lower(func.translate(col, _SQL_FW_CHARS, _SQL_HW_CHARS))


router = APIRouter()


def _serialize_phase_stamps(
    stamps: list[JobPhaseStamp], worker_map: dict[int, Worker]
) -> list[PhaseStampRead]:
    out: list[PhaseStampRead] = []
    for s in stamps:
        w = worker_map.get(s.worker_id) if s.worker_id is not None else None
        out.append(
            PhaseStampRead(
                step_id=s.step_id,
                worker_id=s.worker_id,
                worker_name=w.name if w else None,
                worker_department=w.department if w else None,
                stamp_color=w.stamp_color if w else None,
                stamped_at=s.stamped_at,
                due_date=s.due_date,
            )
        )
    out.sort(key=lambda p: p.step_id)
    return out


def _serialize_axis_phase_stamps(
    stamps: list[AxisPhaseStamp], worker_map: dict[int, Worker]
) -> list[AxisPhaseStampRead]:
    """軸ごとの phase_stamps を Worker JOIN 込みでシリアライズ。"""
    out: list[AxisPhaseStampRead] = []
    for s in stamps:
        w = worker_map.get(s.worker_id) if s.worker_id is not None else None
        out.append(
            AxisPhaseStampRead(
                step_id=s.step_id,
                worker_id=s.worker_id,
                worker_name=w.name if w else None,
                worker_department=w.department if w else None,
                stamp_color=w.stamp_color if w else None,
                stamped_at=s.stamped_at,
                due_date=s.due_date,
            )
        )
    out.sort(key=lambda p: p.step_id)
    return out


def _serialize_axis(
    axis: Axis,
    step_map: dict[int, ProgressStep],
    version_broken_map: dict[int, bool] | None = None,
    worker_map: dict[int, Worker] | None = None,
) -> AxisRead:
    progress = [
        AxisProgressRead(
            step_id=p.step_id,
            code=step_map[p.step_id].code if p.step_id in step_map else None,
            short_label=step_map[p.step_id].short_label if p.step_id in step_map else None,
            state=p.state,
            sort_order=step_map[p.step_id].sort_order if p.step_id in step_map else None,
        )
        for p in axis.progress
    ]
    progress.sort(key=lambda x: x.sort_order or 0)

    # Phase I: archived バージョンを除外したうえで「version_no が最大」のものを現行とする。
    # Axis.versions の relationship は created_at.desc() ソートだが、ユーザーが過去版を
    # 「現行に戻す」=「新 version_no として複製」した場合に created_at が逆転する可能性は
    # 無いものの (新行が常に新 created_at)、要件上 version_no で決めるのが意味論的に正しい。
    active_versions = [v for v in axis.versions if v.archived_at is None]
    latest_version = (
        max(active_versions, key=lambda v: v.version_no) if active_versions else None
    )
    # Phase D: 最新バージョンのリンク切れ判定 (link_check_results 最新行が "missing")
    current_broken = (
        bool(version_broken_map.get(latest_version.id, False))
        if (version_broken_map is not None and latest_version is not None)
        else False
    )
    # Phase N-2: 軸ごとの電子データネーム印
    phase_stamps = (
        _serialize_axis_phase_stamps(list(axis.phase_stamps), worker_map)
        if worker_map is not None
        else []
    )
    return AxisRead.model_validate(
        {
            "id": axis.id,
            "name": axis.name,
            "sort_order": axis.sort_order,
            "third_party_required": axis.third_party_required,
            "progress": progress,
            "current_version_id": latest_version.id if latest_version else None,
            "current_version_no": latest_version.version_no if latest_version else None,
            "latest_release_at": latest_version.released_at if latest_version else None,
            "current_version_link_broken": current_broken,
            "phase_stamps": phase_stamps,
            "archived_at": axis.archived_at,
        }
    )


def _filtered(stmt, q: str | None, filt: str, today):
    # 論理アーカイブ: "archived" フィルタのみアーカイブ済を返し、
    # それ以外のフィルタは常にアクティブ (archived_at IS NULL) に限定する。
    if filt == "archived":
        stmt = stmt.where(Job.archived_at.is_not(None))
    else:
        stmt = stmt.where(Job.archived_at.is_(None))
    if q:
        # クエリ側を Python で NFKC + lower、DB 側を SQL の translate + lower で
        # 揃えてから ilike。これで全角/半角・大文字小文字・全角記号の差異を吸収して
        # 1 つの検索ボックスから幅広くマッチさせる。
        q_norm = _normalize(q)
        if q_norm:
            like = f"%{q_norm}%"
            stmt = stmt.where(
                or_(
                    _sql_normalize(Job.id).ilike(like),
                    _sql_normalize(Job.title).ilike(like),
                    _sql_normalize(Job.customer).ilike(like),
                )
            )
    # Phase A 刈り込み: "starred" 分岐は削除 (★ お気に入り機能廃止 — Round 3 合意)
    if filt == "over":
        stmt = stmt.where(
            and_(Job.status == "open", Job.delivery_date.is_not(None), Job.delivery_date < today)
        )
    elif filt == "thisweek":
        end = today + timedelta(days=7)
        stmt = stmt.where(
            and_(
                Job.status == "open",
                Job.delivery_date.is_not(None),
                Job.delivery_date >= today,
                Job.delivery_date <= end,
            )
        )
    elif filt == "inprog":
        stmt = stmt.where(Job.status == "open")
    return stmt


@router.get("/master/search")
async def search_master(
    q: str = Query(default="", description="工番 / 件名 / 客先 の部分一致"),
    only_active: bool = Query(default=True),
    exclude_existing: bool = Query(default=True, description="既に jobs に取込済の工番を除く"),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """日程表キャッシュからの工番オートコンプリート検索。

    並び順: アクティブ優先 → 前方一致した工番優先 → 工番降順
    """
    q_norm = _normalize(q)

    stmt = select(JobMasterCache)
    if only_active:
        stmt = stmt.where(JobMasterCache.is_active.is_(True))
    if exclude_existing:
        # サブクエリで jobs.id に既に登録済のものを除外。
        # アーカイブ済み工番は候補に残す (再登録 = 自動復活の入口にする)。
        stmt = stmt.where(
            ~JobMasterCache.job_no.in_(select(Job.id).where(Job.archived_at.is_(None)))
        )
    if q_norm:
        like = f"%{q_norm}%"
        # SQL 側でも lower() を使って大文字小文字を吸収。日本語は NFKC を保証できないが、
        # 半角英数+ASCII の検索には十分。完全 NFKC は Python 側で後置フィルタする。
        stmt = stmt.where(
            or_(
                func.lower(JobMasterCache.job_no).like(like),
                func.lower(JobMasterCache.title).like(like),
                func.lower(JobMasterCache.customer).like(like),
            )
        )
    stmt = stmt.order_by(
        JobMasterCache.is_active.desc(),
        JobMasterCache.job_no.desc(),
    ).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()

    # NFKC マッチで再ランク (前方一致を先頭に)
    def _score(row: JobMasterCache) -> tuple[int, str]:
        nj = _normalize(row.job_no)
        nt = _normalize(row.title or "")
        nc = _normalize(row.customer or "")
        if q_norm and (nj.startswith(q_norm) or nt.startswith(q_norm) or nc.startswith(q_norm)):
            return (0, row.job_no)
        return (1, row.job_no)

    items = sorted(rows, key=_score)
    return {
        "q": q,
        "count": len(items),
        "items": [
            {
                "job_no": r.job_no,
                "title": r.title,
                "customer": r.customer,
                "delivery_date": r.delivery_date.isoformat() if r.delivery_date else None,
                "is_active": r.is_active,
                "owner": r.owner,
                "source": r.source,
            }
            for r in items
        ],
    }


@router.get("/counts")
async def list_counts(
    q: str | None = Query(default=None), db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    today = datetime.now().date()
    out: dict[str, int] = {}
    # Phase A 刈り込み: "starred" は除外 (★ お気に入り機能廃止 — Round 3 合意)
    for f in ("all", "inprog", "over", "thisweek", "archived"):
        stmt = _filtered(select(func.count(Job.id)), q, f, today)
        out[f] = (await db.execute(stmt)).scalar_one()
    return out


@router.get("", response_model=Page[JobRead])
async def list_jobs(
    q: str | None = Query(default=None, description="フリーテキスト検索"),
    # Phase A 刈り込み: "starred" は pattern から除外 (★ お気に入り機能廃止 — Round 3 合意)
    filter: str = Query(default="all", pattern="^(all|inprog|over|thisweek|archived)$"),
    sort: str = Query(default="due", pattern="^(due|id|progress)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> Page[JobRead]:
    today = datetime.now().date()
    base_stmt = _filtered(select(Job), q, filter, today)
    total = (await db.execute(select(func.count()).select_from(base_stmt.subquery()))).scalar_one()

    # Phase A 刈り込み: Job.starred.desc() の先頭ソートは削除 (★ お気に入り機能廃止 — Round 3 合意)
    if sort == "id":
        order = (Job.id.asc(),)
    else:
        # 進捗ソートは Python 側でやる方が現状のスキーマでは楽なので、
        # SQL では納期昇順で取り、必要なら後段で並び替える。
        order = (Job.delivery_date.asc().nullslast(), Job.id.asc())

    stmt = (
        base_stmt.order_by(*order)
        .options(selectinload(Job.axes).selectinload(Axis.progress))
        .options(selectinload(Job.axes).selectinload(Axis.versions))
        .options(selectinload(Job.axes).selectinload(Axis.phase_stamps))
        .options(selectinload(Job.phase_stamps))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await db.execute(stmt)).scalars().unique().all()
    steps = (await db.execute(select(ProgressStep))).scalars().all()
    step_map = {s.id: s for s in steps}

    # Phase N + N-2: 工番単位 + 軸単位の両方の押印 worker をまとめて取得 (N+1 回避)
    worker_ids: set[int] = set()
    for j in rows:
        worker_ids.update(s.worker_id for s in j.phase_stamps if s.worker_id is not None)
        for a in j.axes:
            worker_ids.update(
                s.worker_id for s in a.phase_stamps if s.worker_id is not None
            )
    worker_map: dict[int, Worker] = {}
    if worker_ids:
        wrows = (
            await db.execute(select(Worker).where(Worker.id.in_(worker_ids)))
        ).scalars().all()
        worker_map = {w.id: w for w in wrows}

    # Phase D + Phase I: 各 axis の「アクティブな最大 version_no」を集めて一括検査
    def _active_current(axis: Axis) -> Version | None:
        active = [v for v in axis.versions if v.archived_at is None]
        return max(active, key=lambda v: v.version_no) if active else None

    current_version_ids = [
        cur.id
        for j in rows
        for a in j.axes
        if a.archived_at is None and (cur := _active_current(a)) is not None
    ]
    version_broken_map = await latest_link_status(
        db, TARGET_VERSION, current_version_ids
    )

    # 一覧はアーカイブ済み軸を常に除外 (復元 UI は詳細画面側に持つ)。
    items = [
        JobRead.model_validate(
            {
                **{c.name: getattr(j, c.name) for c in Job.__table__.columns},
                "axes": [
                    _serialize_axis(a, step_map, version_broken_map, worker_map)
                    for a in j.axes
                    if a.archived_at is None
                ],
                "phase_stamps": _serialize_phase_stamps(j.phase_stamps, worker_map),
            }
        )
        for j in rows
    ]

    if sort == "progress":
        def _pct(j: JobRead) -> float:
            done = 0
            total_steps = 0
            for a in j.axes:
                for p in a.progress:
                    total_steps += 1
                    if p.state == "done":
                        done += 1
            return (done / total_steps) if total_steps else 0.0

        # Phase A 刈り込み: starred 優先ソートは削除 (★ お気に入り機能廃止 — Round 3 合意)
        items.sort(key=lambda j: (-_pct(j), j.id))

    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/{job_id}", response_model=JobRead)
async def get_job(
    job_id: str,
    include_archived_axes: bool = Query(
        default=False,
        description="True でアーカイブ済みの軸も返す (復元パネル用)",
    ),
    db: AsyncSession = Depends(get_db),
) -> JobRead:
    stmt = (
        select(Job)
        .where(Job.id == job_id)
        .options(selectinload(Job.axes).selectinload(Axis.progress))
        .options(selectinload(Job.axes).selectinload(Axis.versions))
        .options(selectinload(Job.axes).selectinload(Axis.phase_stamps))
        .options(selectinload(Job.phase_stamps))
    )
    job = (await db.execute(stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工番が見つかりません")
    steps = (await db.execute(select(ProgressStep))).scalars().all()
    step_map = {s.id: s for s in steps}

    # Phase N + N-2: 工番単位 + 軸単位の両方の押印 worker をまとめて取得
    worker_ids: set[int] = {
        s.worker_id for s in job.phase_stamps if s.worker_id is not None
    }
    for a in job.axes:
        worker_ids.update(
            s.worker_id for s in a.phase_stamps if s.worker_id is not None
        )
    worker_map: dict[int, Worker] = {}
    if worker_ids:
        wrows = (
            await db.execute(select(Worker).where(Worker.id.in_(worker_ids)))
        ).scalars().all()
        worker_map = {w.id: w for w in wrows}
    # Phase D + Phase I: アクティブな最大 version_no のみリンク切れ判定対象に含める
    def _active_current(axis: Axis) -> Version | None:
        active = [v for v in axis.versions if v.archived_at is None]
        return max(active, key=lambda v: v.version_no) if active else None

    current_version_ids = [
        cur.id
        for a in job.axes
        if a.archived_at is None and (cur := _active_current(a)) is not None
    ]
    version_broken_map = await latest_link_status(
        db, TARGET_VERSION, current_version_ids
    )
    # 既定はアクティブ軸のみ。復元パネルからは include_archived_axes=true で全件取得。
    axes = [
        a for a in job.axes if include_archived_axes or a.archived_at is None
    ]
    return JobRead.model_validate(
        {
            **{c.name: getattr(job, c.name) for c in Job.__table__.columns},
            "axes": [
                _serialize_axis(a, step_map, version_broken_map, worker_map)
                for a in axes
            ],
            "phase_stamps": _serialize_phase_stamps(job.phase_stamps, worker_map),
        }
    )


@router.post("", response_model=JobRead, status_code=status.HTTP_201_CREATED)
async def create_job(
    body: JobCreate, request: Request, db: AsyncSession = Depends(get_db)
) -> JobRead:
    existing = await db.get(Job, body.id)
    if existing is not None:
        if existing.archived_at is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="同じ工番が既に存在します"
            )
        # アーカイブ済み工番の再登録 → 自動復活 (行は温存、archived_at のみ解除)
        existing.archived_at = None
        await db.flush()
        await write_action_log(
            db,
            actor=client_actor(request),
            action_type="job.unarchive",
            job_id=existing.id,
            payload={"job_id": existing.id, "reason": "re-register"},
        )
        return await get_job(existing.id, False, db)
    job = Job(**body.model_dump())
    db.add(job)
    await db.flush()

    # 進捗 10 工程を一括初期化
    steps = (await db.execute(select(ProgressStep))).scalars().all()
    # 軸はこの時点で 0 件なので、軸 POST 時にプログレスを生成する設計。

    # H-1: 監査ログ
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="job.create",
        job_id=job.id,
        payload={"job_id": job.id, "title": job.title, "customer": job.customer},
    )

    await db.refresh(job)
    return JobRead.model_validate(
        {
            **{c.name: getattr(job, c.name) for c in Job.__table__.columns},
            "axes": [],
            "phase_stamps": [],
        }
    )


@router.patch("/{job_id}", response_model=JobRead)
async def update_job(
    job_id: str, body: JobUpdate, db: AsyncSession = Depends(get_db)
) -> JobRead:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工番が見つかりません")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(job, k, v)
    await db.flush()
    return await get_job(job_id, False, db)


# ─────────────────────────────────────────────────────────────
# 工番の論理アーカイブ (削除ボタン):
#   - archive   : archived_at = now()。実ファイル・DB 行は絶対に消さない (CLAUDE.md §2.1)
#   - unarchive : archived_at = NULL (復元)
# ─────────────────────────────────────────────────────────────


@router.patch("/{job_id}/archive", response_model=JobRead)
async def archive_job(
    job_id: str, request: Request, db: AsyncSession = Depends(get_db)
) -> JobRead:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工番が見つかりません")
    if job.archived_at is None:
        job.archived_at = datetime.now(UTC)
        await db.flush()
        await write_action_log(
            db,
            actor=client_actor(request),
            action_type="job.archive",
            job_id=job.id,
            payload={"job_id": job.id},
        )
    return await get_job(job_id, False, db)


@router.patch("/{job_id}/unarchive", response_model=JobRead)
async def unarchive_job(
    job_id: str, request: Request, db: AsyncSession = Depends(get_db)
) -> JobRead:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工番が見つかりません")
    if job.archived_at is not None:
        job.archived_at = None
        await db.flush()
        await write_action_log(
            db,
            actor=client_actor(request),
            action_type="job.unarchive",
            job_id=job.id,
            payload={"job_id": job.id},
        )
    return await get_job(job_id, False, db)
