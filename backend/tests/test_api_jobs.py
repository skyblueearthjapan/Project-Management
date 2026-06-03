"""Job/Axis/Progress/Mail エンドポイントの統合テスト。

DB は SQLite (aiosqlite) を一時的に使い、Alembic 相当の `Base.metadata.create_all`
で全テーブルを作る。実本番は PostgreSQL だが、API の振る舞いはここで担保する。
"""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DEV_MODE", "true")
os.environ.setdefault("ENABLE_SCHEDULER", "false")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.core.db as db_module
from app.core.db import Base
from app.models import ProgressStep  # noqa: F401 - ensure metadata


@pytest_asyncio.fixture
async def client(monkeypatch):
    # in-memory SQLite を使うため、engine を差し替える
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", SessionLocal)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 進捗工程 seed
    from sqlalchemy import insert

    async with SessionLocal() as s:
        await s.execute(
            insert(ProgressStep.__table__),
            [
                {"code": f"step{i}", "name": f"工程{i}", "short_label": f"S{i}", "sort_order": i * 10, "is_active": True}
                for i in range(1, 11)
            ],
        )
        await s.commit()

    # アプリは engine 差し替えの後に import する
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_create_job_and_axis_and_progress(client: AsyncClient) -> None:
    # 工番作成
    r = await client.post("/api/v1/jobs", json={"id": "NK24-051", "title": "テスト機"})
    assert r.status_code == 201, r.text

    # 軸を 2 本追加
    r = await client.post(
        "/api/v1/jobs/NK24-051/axes",
        json={"name": "昇降軸", "sort_order": 1},
    )
    assert r.status_code == 201
    axis_id = r.json()["id"]
    r = await client.post(
        "/api/v1/jobs/NK24-051/axes",
        json={"name": "旋回軸", "sort_order": 2},
    )
    assert r.status_code == 201

    # 工番取得 → 軸が 2 本 + 工程 10 件初期化済み
    r = await client.get("/api/v1/jobs/NK24-051")
    assert r.status_code == 200
    body = r.json()
    assert len(body["axes"]) == 2
    assert len(body["axes"][0]["progress"]) == 10

    # 進捗を inprogress に
    r = await client.patch(
        f"/api/v1/progress/{axis_id}/step1",
        json={"state": "inprogress", "updated_by": "yamada"},
    )
    assert r.status_code == 200

    # 一覧 filter=inprog
    r = await client.get("/api/v1/jobs?filter=inprog")
    assert r.status_code == 200
    assert any(j["id"] == "NK24-051" for j in r.json()["items"])


@pytest.mark.asyncio
async def test_mail_compose_eml(client: AsyncClient, tmp_path, monkeypatch) -> None:
    # uploads を tmp に切替
    from app.core import config as cfg

    cfg.get_settings.cache_clear()
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    settings = cfg.get_settings()
    assert settings.upload_dir == tmp_path

    # 工番を 1 件 (FK 検証のため)
    await client.post("/api/v1/jobs", json={"id": "NK24-099", "title": "メールテスト"})

    r = await client.post(
        "/api/v1/mail/compose",
        json={
            "job_id": "NK24-099",
            "subject": "テスト件名",
            "body": "本文",
            "method": "eml",
            "recipients": [{"kind": "to", "email": "yamada@example.com"}],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "sent"
    assert body["eml_path"] is not None
    from pathlib import Path

    assert Path(body["eml_path"]).is_file()


@pytest.mark.asyncio
async def test_files_path_traversal_blocked(client: AsyncClient) -> None:
    # H-3: job_id 必須化された。`..` を含む path は 400 (Drawings 配下外 / 不正パス要素)。
    r = await client.get(
        "/api/v1/files/fileserver?job_id=NK24-051&path=../etc/passwd"
    )
    assert r.status_code in (400, 404)


@pytest.mark.asyncio
async def test_files_browse_requires_job_id(client: AsyncClient) -> None:
    # H-3: job_id 無し → 422 (FastAPI Query 必須違反)
    r = await client.get("/api/v1/files/browse")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_files_uploads_pattern_enforced(client: AsyncClient) -> None:
    # H-4: 許可パターン (releases/replacements/scans/mail) 外は 400
    r = await client.get("/api/v1/files/uploads?path=../etc/passwd")
    assert r.status_code == 400
    r = await client.get("/api/v1/files/uploads?path=arbitrary/leak.pdf")
    assert r.status_code == 400
