"""工番一覧の表示除外を固定するリグレッションテスト (DESIGN_購入部品追加依頼.md §3.4)。

「記録は最大限・表示は最小限」という方針の要:
購入部品依頼だけで発生した工番 (origin="purchase") は DB には残すが、
工番一覧・件数・検索のいずれにも出さない。この除外は放置すると漏れるため、
除外条件を `jobs.py` の `_filtered()` 1 箇所に集約したうえで本テストで固定する。

併せて「出図されたら一覧に出る」(origin 昇格) も固定する。ここが壊れると
「出図したのに工番一覧に出ない」という極めて分かりにくい事故になる。
"""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DEV_MODE", "true")
os.environ.setdefault("ENABLE_SCHEDULER", "false")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.core.db as db_module
from app.core.db import Base
from app.models import ProgressStep  # noqa: F401 - ensure metadata

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PURCHASE_ONLY_JOB = "LW29001"


@pytest_asyncio.fixture
async def client(monkeypatch, tmp_path):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", SessionLocal)

    from app.core import config as cfg

    cfg.get_settings.cache_clear()
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as s:
        await s.execute(
            insert(ProgressStep.__table__),
            [
                {
                    "code": f"step{i}",
                    "name": f"工程{i}",
                    "short_label": f"S{i}",
                    "sort_order": i * 10,
                    "is_active": True,
                }
                for i in range(1, 11)
            ],
        )
        await s.commit()

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    cfg.get_settings.cache_clear()


async def _create_purchase_only_job(client: AsyncClient) -> None:
    """購入依頼だけで工番を発生させる (DOVE 未登録の工番を指定する)。"""
    r = await client.post(
        "/api/v1/purchase-requests",
        data={
            "client_request_id": "vis-1",
            "requester_account": "tanaka",
            "requester_name": "田中",
            "requester_email": "tanaka@example.co.jp",
            "job_id": PURCHASE_ONLY_JOB,
            "title": "購入依頼だけで発生した工番",
        },
        files={"file": ("部品リスト.xlsx", b"dummy", XLSX)},
    )
    assert r.status_code == 201, r.text
    assert r.json()["job_created"] is True


@pytest.mark.asyncio
async def test_purchase_only_job_hidden_from_list(client: AsyncClient) -> None:
    """1) 工番一覧に出ない。"""
    await _create_purchase_only_job(client)
    r = await client.get("/api/v1/jobs")
    assert r.status_code == 200
    assert all(j["id"] != PURCHASE_ONLY_JOB for j in r.json()["items"])


@pytest.mark.asyncio
async def test_purchase_only_job_not_counted(client: AsyncClient) -> None:
    """2) 件数 (フィルタタブのバッジ) を増やさない。"""
    before = (await client.get("/api/v1/jobs/counts")).json()
    await _create_purchase_only_job(client)
    after = (await client.get("/api/v1/jobs/counts")).json()
    assert after["all"] == before["all"]
    assert after["inprog"] == before["inprog"]


def test_search_query_also_excludes_purchase_origin() -> None:
    """3) 検索経路にも除外条件が乗っている。

    検索は PostgreSQL の `translate()` に依存しており in-memory SQLite では実行できない
    (`no such function: translate`)。そこで **生成される SQL** に origin 条件と検索条件の
    両方が含まれることをコンパイル結果で固定する。
    除外は `_filtered()` の 1 箇所で行っているため、これで一覧・件数・検索の 3 経路すべてに
    効いていることが担保できる。
    """
    from datetime import date

    from sqlalchemy import select
    from sqlalchemy.dialects import postgresql

    from app.api.v1.jobs import _filtered
    from app.models.job import Job

    sql = str(
        _filtered(select(Job), PURCHASE_ONLY_JOB, "all", date(2026, 7, 27)).compile(
            dialect=postgresql.dialect()
        )
    )
    assert "jobs.origin !=" in sql, sql
    # 検索条件 (NFKC 正規化 + ilike) も同じクエリに乗っていること
    assert "translate" in sql, sql


@pytest.mark.asyncio
async def test_purchase_only_job_detail_is_reachable(client: AsyncClient) -> None:
    """4) 工番詳細は **意図的に除外しない** (購入依頼から工番を辿れる必要がある)。"""
    await _create_purchase_only_job(client)
    r = await client.get(f"/api/v1/jobs/{PURCHASE_ONLY_JOB}")
    assert r.status_code == 200, r.text
    assert r.json()["origin"] == "purchase"


@pytest.mark.asyncio
async def test_purchase_only_job_visible_via_hidden_filter(client: AsyncClient) -> None:
    """保守用の逃げ道: filter=purchase では取得できる (UI のタブには出さない)。"""
    await _create_purchase_only_job(client)
    r = await client.get("/api/v1/jobs?filter=purchase")
    assert r.status_code == 200
    assert any(j["id"] == PURCHASE_ONLY_JOB for j in r.json()["items"])


@pytest.mark.asyncio
async def test_origin_promoted_when_released(client: AsyncClient) -> None:
    """5) 出図されたら origin が昇格し、工番一覧に現れる。

    ここが壊れると「出図したのに一覧に出ない」という分かりにくい事故になる。
    """
    await _create_purchase_only_job(client)

    r = await client.post(
        "/api/v1/shutsuzu/register",
        json={
            "job_id": PURCHASE_ONLY_JOB,
            "kubun": "LW",
            "axes": [
                {
                    "name": "昇降軸",
                    "drawing_pdf_path": f"設計/{PURCHASE_ONLY_JOB}/昇降軸/図面.pdf",
                }
            ],
        },
    )
    assert r.status_code == 200, r.text

    lst = await client.get("/api/v1/jobs")
    assert any(j["id"] == PURCHASE_ONLY_JOB for j in lst.json()["items"])
    detail = await client.get(f"/api/v1/jobs/{PURCHASE_ONLY_JOB}")
    assert detail.json()["origin"] == "shutsuzu"


@pytest.mark.asyncio
async def test_unassigned_request_pinned_to_top(client: AsyncClient) -> None:
    """6) 工番未定の依頼は購買側の一覧で先頭に固定される (手配漏れ防止)。"""
    await _create_purchase_only_job(client)
    r = await client.post(
        "/api/v1/purchase-requests",
        data={
            "client_request_id": "vis-2",
            "requester_account": "sato",
            "requester_name": "佐藤",
            "requester_email": "sato@example.co.jp",
        },
        files={"file": ("先行手配.xlsx", b"dummy", XLSX)},
    )
    assert r.status_code == 201, r.text

    lst = await client.get("/api/v1/purchase-requests")
    items = lst.json()["items"]
    assert len(items) == 2
    assert items[0]["job_id"] is None


@pytest.mark.asyncio
async def test_manual_job_creation_is_visible(client: AsyncClient) -> None:
    """画面から追加した工番 (origin="manual") は従来どおり一覧に出る。"""
    r = await client.post("/api/v1/jobs", json={"id": "LW29002", "title": "画面から追加"})
    assert r.status_code == 201, r.text
    assert r.json()["origin"] == "manual"
    lst = await client.get("/api/v1/jobs")
    assert any(j["id"] == "LW29002" for j in lst.json()["items"])
