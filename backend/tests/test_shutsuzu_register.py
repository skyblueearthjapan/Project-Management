"""出図のお知らせ × DOVE連携: 合成登録 `/shutsuzu/register` の統合テスト。

DB は in-memory SQLite。Base.metadata.create_all で全テーブルを作る。
検証観点 (DESIGN §6):
  - 冪等再送で重複 0 (Job/Axis/Version/指示書/送信ログ)
  - 既存 Job への軸追加 (upsert)
  - DXF フォルダ未存在 → 当該 axis のみ warning、全体は継続
  - 不正パス (非 .pdf) は 422
"""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DEV_MODE", "true")
os.environ.setdefault("ENABLE_SCHEDULER", "false")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.core.db as db_module
from app.core.db import Base
from app.models import ProgressStep  # noqa: F401 - ensure metadata
from app.models.axis import Axis
from app.models.job import Job
from app.models.job_instruction import JobInstruction
from app.models.mail import MailLog, MailLogRecipient
from app.models.version import Version


async def _count(model: type) -> int:
    """テスト用エンジン (fixture が monkeypatch 済み) で行数を数える。"""
    async with db_module.SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(model))).scalar_one()


@pytest_asyncio.fixture
async def client(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", SessionLocal)

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


def _payload(**overrides) -> dict:
    base = {
        "job_id": "LW25146",
        "kubun": "LW",
        "title": "○○製品",
        "customer": "△△様",
        "axes": [
            {
                "name": "昇降軸",
                "drawing_pdf_path": "設計/LW25146/昇降軸/LW25146-1.pdf",
                "drawing_label": "初版",
            }
        ],
        "instruction_pdf_path": "部署間共通/工番別指示書/LW25146.pdf",
        "instruction_original_name": "LW25146.pdf",
        "mail": {
            "subject": "【出図のお知らせ】工番LW25146",
            "sent_at": "2026-06-06T10:00:00+09:00",
            "to": [{"name": "山田", "email": "y@example.co.jp"}],
            "cc": [{"name": "佐藤", "email": "s@example.co.jp"}],
        },
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_register_creates_full_graph(client: AsyncClient) -> None:
    r = await client.post("/api/v1/shutsuzu/register", json=_payload())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_id"] == "LW25146"
    assert body["job_created"] is True
    assert len(body["axes"]) == 1
    axis = body["axes"][0]
    assert axis["name"] == "昇降軸"
    assert axis["axis_created"] is True
    assert axis["version_created"] is True
    assert body["instruction_created"] is True
    assert body["instruction_id"] is not None
    assert body["mail_log_id"] is not None

    # Job 詳細に軸 + 出図 PDF が反映されている
    rj = await client.get("/api/v1/jobs/LW25146")
    assert rj.status_code == 200
    job = rj.json()
    assert len(job["axes"]) == 1
    assert job["title"] == "○○製品"

    # 指示書一覧に 1 件
    ri = await client.get("/api/v1/shutsuzu/jobs/LW25146/instructions")
    assert ri.status_code == 200
    assert len(ri.json()) == 1


@pytest.mark.asyncio
async def test_register_idempotent_resend_no_duplicates(client: AsyncClient) -> None:
    # 1 回目
    r1 = await client.post("/api/v1/shutsuzu/register", json=_payload())
    assert r1.status_code == 200, r1.text
    axis_id = r1.json()["axes"][0]["axis_id"]

    # 2 回目 (完全に同じ payload) → 重複作成されない
    r2 = await client.post("/api/v1/shutsuzu/register", json=_payload())
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["job_created"] is False
    assert b2["axes"][0]["axis_created"] is False
    assert b2["axes"][0]["version_created"] is False
    assert b2["instruction_created"] is False
    # 同じ Job/Axis/指示書/送信ログを指す
    assert b2["axes"][0]["axis_id"] == axis_id
    assert b2["instruction_id"] == r1.json()["instruction_id"]
    assert b2["mail_log_id"] == r1.json()["mail_log_id"]

    # 出図 PDF (version) が重複していない (1 本のまま)
    rv = await client.get(f"/api/v1/jobs/LW25146/axes/{axis_id}/versions")
    assert rv.status_code == 200
    assert len(rv.json()) == 1

    # 指示書も 1 件のまま
    ri = await client.get("/api/v1/shutsuzu/jobs/LW25146/instructions")
    assert len(ri.json()) == 1


@pytest.mark.asyncio
async def test_register_adds_axis_to_existing_job(client: AsyncClient) -> None:
    r1 = await client.post("/api/v1/shutsuzu/register", json=_payload())
    assert r1.status_code == 200

    # 同一工番に別軸を追加 (後日運用)
    payload2 = _payload(
        axes=[
            {
                "name": "旋回軸",
                "drawing_pdf_path": "設計/LW25146/旋回軸/LW25146-2.pdf",
            }
        ]
    )
    r2 = await client.post("/api/v1/shutsuzu/register", json=payload2)
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["job_created"] is False
    assert b2["axes"][0]["name"] == "旋回軸"
    assert b2["axes"][0]["axis_created"] is True

    rj = await client.get("/api/v1/jobs/LW25146")
    assert len(rj.json()["axes"]) == 2


@pytest.mark.asyncio
async def test_register_mail_log_idempotent(client: AsyncClient) -> None:
    # 同一 sent_at で再 register → 同じ mail_log を指し、行数も増えない。
    r1 = await client.post("/api/v1/shutsuzu/register", json=_payload())
    r2 = await client.post("/api/v1/shutsuzu/register", json=_payload())
    assert r1.json()["mail_log_id"] == r2.json()["mail_log_id"]
    assert await _count(MailLog) == 1
    assert await _count(MailLogRecipient) == 2  # to 1 + cc 1


@pytest.mark.asyncio
async def test_register_resend_no_row_growth(client: AsyncClient) -> None:
    """実運用の再試行 = 同一 payload (同一 sent_at) での再 register。

    mail_logs / recipients / job / axis / version / instruction が
    一切重複・増加しないことを行数で明示検証する (DESIGN §6-1)。
    """
    payload = _payload()
    r1 = await client.post("/api/v1/shutsuzu/register", json=payload)
    assert r1.status_code == 200, r1.text

    async def _snapshot() -> dict[str, int]:
        return {
            "job": await _count(Job),
            "axis": await _count(Axis),
            "version": await _count(Version),
            "instruction": await _count(JobInstruction),
            "mail_log": await _count(MailLog),
            "recipient": await _count(MailLogRecipient),
        }

    before = await _snapshot()
    assert before == {
        "job": 1,
        "axis": 1,
        "version": 1,
        "instruction": 1,
        "mail_log": 1,
        "recipient": 2,
    }

    # 「DOVE登録のみ再試行」に相当する同一 payload 再送を 2 回繰り返す。
    for _ in range(2):
        rr = await client.post("/api/v1/shutsuzu/register", json=payload)
        assert rr.status_code == 200, rr.text

    assert await _snapshot() == before


@pytest.mark.asyncio
async def test_register_revision_same_axis_increments_version(client: AsyncClient) -> None:
    """同一 axis に異なる drawing_pdf_path で再 register → version_no=2 (改版)。

    1軸=1枚の冪等 (同一パスは skip) とは別に、別パスは新バージョンとして採番される。
    """
    r1 = await client.post("/api/v1/shutsuzu/register", json=_payload())
    assert r1.status_code == 200, r1.text
    axis_id = r1.json()["axes"][0]["axis_id"]

    payload2 = _payload(
        axes=[
            {
                "name": "昇降軸",  # 同一軸名
                "drawing_pdf_path": "設計/LW25146/昇降軸/LW25146-1_rev2.pdf",  # 別PDF
            }
        ]
    )
    r2 = await client.post("/api/v1/shutsuzu/register", json=payload2)
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["axes"][0]["axis_id"] == axis_id
    assert b2["axes"][0]["axis_created"] is False
    assert b2["axes"][0]["version_created"] is True

    rv = await client.get(f"/api/v1/jobs/LW25146/axes/{axis_id}/versions")
    assert rv.status_code == 200
    versions = rv.json()
    assert len(versions) == 2
    assert max(v["version_no"] for v in versions) == 2


@pytest.mark.asyncio
async def test_register_dxf_folder_missing_is_warning(client: AsyncClient) -> None:
    payload = _payload(
        axes=[
            {
                "name": "昇降軸",
                "drawing_pdf_path": "設計/LW25146/昇降軸/LW25146-1.pdf",
                "dxf_folder_path": "設計/LW25146/昇降軸/dxf-存在しない",
            }
        ]
    )
    r = await client.post("/api/v1/shutsuzu/register", json=payload)
    # 全体は 200 で継続。当該 axis に warning が立つ。
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["axes"][0]["dxf_warning"] is not None
    assert body["axes"][0]["dxf_registered"] == 0
    assert len(body["warnings"]) >= 1


@pytest.mark.asyncio
async def test_register_rejects_non_pdf_drawing(client: AsyncClient) -> None:
    payload = _payload(
        axes=[{"name": "昇降軸", "drawing_pdf_path": "設計/LW25146/昇降軸/notpdf.txt"}]
    )
    r = await client.post("/api/v1/shutsuzu/register", json=payload)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_register_title_fallbacks_to_job_id(client: AsyncClient) -> None:
    # master 無し + title/customer 未指定 → title は job_id にフォールバック
    payload = {
        "job_id": "LW99999",
        "kubun": "LW",
        "axes": [{"name": "走行軸", "drawing_pdf_path": "設計/LW99999/走行軸/a.pdf"}],
    }
    r = await client.post("/api/v1/shutsuzu/register", json=payload)
    assert r.status_code == 200, r.text
    rj = await client.get("/api/v1/jobs/LW99999")
    assert rj.json()["title"] == "LW99999"
