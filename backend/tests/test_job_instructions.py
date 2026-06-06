"""工番別指示書 (Job単位) CRUD + 配信エンドポイントの統合テスト。

検証観点 (DESIGN §6):
  - ソフトデリート後は一覧から消え、配信は 404
  - 配信時 Path Traversal は 400 (resolve_under)
  - 正常系: ファイルサーバ上の PDF を inline 配信できる
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


async def _make_job(client: AsyncClient, job_id: str = "LW25146") -> None:
    r = await client.post("/api/v1/jobs", json={"id": job_id, "title": "テスト機"})
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_instruction_crud_and_soft_delete_404(client: AsyncClient) -> None:
    await _make_job(client)

    # 登録
    r = await client.post(
        "/api/v1/shutsuzu/jobs/LW25146/instructions",
        json={
            "file_path": "部署間共通/工番別指示書/LW25146.pdf",
            "original_name": "LW25146.pdf",
        },
    )
    assert r.status_code == 201, r.text
    instruction_id = r.json()["id"]

    # 一覧に 1 件
    rl = await client.get("/api/v1/shutsuzu/jobs/LW25146/instructions")
    assert rl.status_code == 200
    assert len(rl.json()) == 1

    # ソフトデリート
    rd = await client.delete(f"/api/v1/shutsuzu/jobs/LW25146/instructions/{instruction_id}")
    assert rd.status_code == 204

    # 一覧から消える
    rl2 = await client.get("/api/v1/shutsuzu/jobs/LW25146/instructions")
    assert rl2.json() == []

    # 二重削除は 404
    rd2 = await client.delete(f"/api/v1/shutsuzu/jobs/LW25146/instructions/{instruction_id}")
    assert rd2.status_code == 404

    # 配信は 404 (ソフトデリート済)
    rs = await client.get(f"/api/v1/files/job-instruction/{instruction_id}")
    assert rs.status_code == 404


@pytest.mark.asyncio
async def test_instruction_serve_path_traversal_400(client: AsyncClient) -> None:
    await _make_job(client)
    # file_path は正規化されるが `..` は残るため、配信時 resolve_under が 400 を返す。
    r = await client.post(
        "/api/v1/shutsuzu/jobs/LW25146/instructions",
        json={"file_path": "../../../../etc/passwd.pdf"},
    )
    assert r.status_code == 201, r.text
    instruction_id = r.json()["id"]

    rs = await client.get(f"/api/v1/files/job-instruction/{instruction_id}")
    assert rs.status_code == 400


@pytest.mark.asyncio
async def test_instruction_serve_inline_ok(client: AsyncClient, tmp_path, monkeypatch) -> None:
    from app.core import config as cfg

    cfg.get_settings.cache_clear()
    monkeypatch.setenv("FILESERVER_ROOT", str(tmp_path))
    settings = cfg.get_settings()
    assert settings.fileserver_root == tmp_path

    # ファイルサーバ上に実 PDF を用意 (配信の正常系)
    rel = "部署間共通/工番別指示書/LW25146.pdf"
    abs_path = tmp_path / rel
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(b"%PDF-1.4\n%%EOF\n")

    await _make_job(client)
    r = await client.post(
        "/api/v1/shutsuzu/jobs/LW25146/instructions",
        json={"file_path": rel},
    )
    assert r.status_code == 201, r.text
    instruction_id = r.json()["id"]

    rs = await client.get(f"/api/v1/files/job-instruction/{instruction_id}")
    assert rs.status_code == 200, rs.text
    assert rs.content.startswith(b"%PDF-")
    assert "inline" in rs.headers.get("content-disposition", "")

    cfg.get_settings.cache_clear()


@pytest.mark.asyncio
async def test_instruction_create_requires_existing_job(client: AsyncClient) -> None:
    r = await client.post(
        "/api/v1/shutsuzu/jobs/NOSUCH/instructions",
        json={"file_path": "部署間共通/工番別指示書/x.pdf"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_instruction_rejects_non_pdf(client: AsyncClient) -> None:
    await _make_job(client)
    r = await client.post(
        "/api/v1/shutsuzu/jobs/LW25146/instructions",
        json={"file_path": "部署間共通/工番別指示書/memo.txt"},
    )
    assert r.status_code == 422
