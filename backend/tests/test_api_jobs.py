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


@pytest.mark.asyncio
async def test_job_archive_and_unarchive(client: AsyncClient) -> None:
    """工番の削除 (論理アーカイブ) → 一覧から消える → 復元で戻る。"""
    await client.post("/api/v1/jobs", json={"id": "NK24-201", "title": "アーカイブ対象"})

    # archive → 通常一覧から消え、archived フィルタに現れる
    r = await client.patch("/api/v1/jobs/NK24-201/archive")
    assert r.status_code == 200, r.text
    assert r.json()["archived_at"] is not None

    r = await client.get("/api/v1/jobs")
    assert all(j["id"] != "NK24-201" for j in r.json()["items"])
    r = await client.get("/api/v1/jobs?filter=archived")
    assert any(j["id"] == "NK24-201" for j in r.json()["items"])

    # counts にも archived が含まれる
    r = await client.get("/api/v1/jobs/counts")
    assert r.json()["archived"] >= 1

    # unarchive → 通常一覧に復帰
    r = await client.patch("/api/v1/jobs/NK24-201/unarchive")
    assert r.status_code == 200
    assert r.json()["archived_at"] is None
    r = await client.get("/api/v1/jobs")
    assert any(j["id"] == "NK24-201" for j in r.json()["items"])


@pytest.mark.asyncio
async def test_job_recreate_revives_archived(client: AsyncClient) -> None:
    """アーカイブ済み工番の再登録は 409 ではなく自動復活。"""
    await client.post("/api/v1/jobs", json={"id": "NK24-202", "title": "復活テスト"})

    # アクティブなまま再登録 → 従来通り 409
    r = await client.post("/api/v1/jobs", json={"id": "NK24-202", "title": "重複"})
    assert r.status_code == 409

    await client.patch("/api/v1/jobs/NK24-202/archive")
    r = await client.post("/api/v1/jobs", json={"id": "NK24-202", "title": "再登録"})
    assert r.status_code == 201, r.text
    assert r.json()["archived_at"] is None
    # 既存行の温存 (title は上書きされない)
    assert r.json()["title"] == "復活テスト"


@pytest.mark.asyncio
async def test_axis_archive_unarchive_and_revive(client: AsyncClient) -> None:
    """軸の削除 (論理アーカイブ) / 復元 / 同名再作成での自動復活。"""
    await client.post("/api/v1/jobs", json={"id": "NK24-203", "title": "軸テスト"})
    r = await client.post(
        "/api/v1/jobs/NK24-203/axes", json={"name": "昇降軸", "sort_order": 1}
    )
    axis_id = r.json()["id"]

    # 同名軸の再作成 (アクティブ) → 409
    r = await client.post("/api/v1/jobs/NK24-203/axes", json={"name": "昇降軸"})
    assert r.status_code == 409

    # archive → 詳細から消える。include_archived_axes=true では見える
    r = await client.patch(f"/api/v1/jobs/NK24-203/axes/{axis_id}/archive")
    assert r.status_code == 200
    assert r.json()["archived_at"] is not None
    r = await client.get("/api/v1/jobs/NK24-203")
    assert len(r.json()["axes"]) == 0
    r = await client.get("/api/v1/jobs/NK24-203?include_archived_axes=true")
    assert len(r.json()["axes"]) == 1
    assert r.json()["axes"][0]["archived_at"] is not None

    # 同名軸の再作成 → 既存行が自動復活 (同じ id が返る)
    r = await client.post("/api/v1/jobs/NK24-203/axes", json={"name": "昇降軸"})
    assert r.status_code == 201
    assert r.json()["id"] == axis_id
    r = await client.get("/api/v1/jobs/NK24-203")
    assert len(r.json()["axes"]) == 1

    # unarchive は冪等
    r = await client.patch(f"/api/v1/jobs/NK24-203/axes/{axis_id}/unarchive")
    assert r.status_code == 200
    assert r.json()["archived_at"] is None
