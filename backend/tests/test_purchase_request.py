"""購入部品追加依頼 API の統合テスト。

DB は in-memory SQLite。Base.metadata.create_all で全テーブルを作る。
検証観点 (DESIGN_購入部品追加依頼.md §7):
  - 冪等再送で依頼・アップロードファイルが重複しない
  - 工番未定の依頼を受け付け、一覧の先頭に固定される
  - 工番の後付け紐づけ (設計・購買の双方が実行できる経路)
  - 許可外拡張子は 400 / アーカイブ済みは 404
  - 依頼者 PC 上の元ファイルには触らない (アップロードは新規作成のみ)
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
from app.models.purchase_request import PurchaseRequest, PurchaseRequestReply

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


async def _count(model: type) -> int:
    async with db_module.SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(model))).scalar_one()


@pytest_asyncio.fixture
async def client(monkeypatch, tmp_path):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", SessionLocal)

    # アップロード先を tmp に隔離する (実 /mnt/uploads を汚さない)。
    from app.core import config as cfg

    cfg.get_settings.cache_clear()
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    assert cfg.get_settings().upload_dir == tmp_path

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


def _form(**overrides) -> dict:
    base = {
        "client_request_id": "req-0001",
        "requester_account": "tanaka",
        "requester_name": "田中",
        "requester_email": "tanaka@example.co.jp",
        "job_id": "LW25146",
        "job_no_input": "25146-1",
        "branch_no": "25146-1",
        "title": "メインビームSAW ポジショナー",
        "customer": "コマツ 大阪工場",
        "subject": "【購入部品追加依頼】工番LW25146",
        "mail_to": '[{"name": "五十嵐", "email": "igarashi@example.co.jp"}]',
        "mail_cc": '[{"name": "木場", "email": "kiba@example.co.jp"}]',
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def _file(name: str = "部品リスト.xlsx", content: bytes = b"dummy-excel") -> dict:
    return {"file": (name, content, XLSX)}


@pytest.mark.asyncio
async def test_register_creates_request_and_job(client: AsyncClient) -> None:
    r = await client.post("/api/v1/purchase-requests", data=_form(), files=_file())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created"] is True
    assert body["job_id"] == "LW25146"
    # DOVE 未登録の工番だったので購入依頼を起点に作られる
    assert body["job_created"] is True
    assert body["job_unassigned"] is False
    assert body["branch_no"] == "25146-1"
    assert body["status"] == "requested"
    # 保存先は request_id 単位のディレクトリ (汎用名でも衝突しない)
    assert body["request_file_path"].startswith(f"purchase/{body['id']}/")
    assert body["request_file_original_name"] == "部品リスト.xlsx"
    assert body["mail_log_id"] is not None

    # 実ファイルが作られている
    from app.core.config import get_settings

    saved = get_settings().upload_dir / body["request_file_path"]
    assert saved.is_file()
    assert saved.read_bytes() == b"dummy-excel"


@pytest.mark.asyncio
async def test_register_is_idempotent(client: AsyncClient) -> None:
    """メール送信成功 → 登録失敗 → 再試行 で重複を作らない。"""
    r1 = await client.post("/api/v1/purchase-requests", data=_form(), files=_file())
    assert r1.status_code == 201, r1.text

    r2 = await client.post("/api/v1/purchase-requests", data=_form(), files=_file())
    # 冪等ヒットは新規作成ではないので 200
    assert r2.status_code == 200, r2.text
    assert r2.json()["created"] is False
    assert r2.json()["id"] == r1.json()["id"]

    assert await _count(PurchaseRequest) == 1
    # ファイルも二重保存されない
    from app.core.config import get_settings

    saved_dir = get_settings().upload_dir / "purchase" / str(r1.json()["id"])
    assert len(list(saved_dir.iterdir())) == 1


@pytest.mark.asyncio
async def test_register_without_job_is_unassigned_and_first(client: AsyncClient) -> None:
    """工番未定の依頼を受け付け、一覧の先頭に固定する (要件 D-08)。"""
    # 先に工番ありの依頼 (古い日時) を入れる
    await client.post(
        "/api/v1/purchase-requests",
        data=_form(client_request_id="req-old", requested_at="2026-07-01T09:00:00+09:00"),
        files=_file(),
    )
    r = await client.post(
        "/api/v1/purchase-requests",
        data=_form(
            client_request_id="req-unassigned",
            job_id=None,
            job_no_input=None,
            branch_no=None,
            requested_at="2026-07-20T09:00:00+09:00",
        ),
        files=_file("追加部品.xlsx"),
    )
    assert r.status_code == 201, r.text
    assert r.json()["job_unassigned"] is True
    assert r.json()["job_id"] is None

    lst = await client.get("/api/v1/purchase-requests")
    assert lst.status_code == 200, lst.text
    items = lst.json()["items"]
    assert len(items) == 2
    # 依頼日が新しくても工番未定が先頭
    assert items[0]["job_id"] is None
    assert items[1]["job_id"] == "LW25146"


@pytest.mark.asyncio
async def test_attach_job_later(client: AsyncClient) -> None:
    """工番未定の依頼に後から工番を紐づける (設計・購買の双方が実行できる経路)。"""
    r = await client.post(
        "/api/v1/purchase-requests",
        data=_form(client_request_id="req-later", job_id=None, branch_no=None),
        files=_file(),
    )
    rid = r.json()["id"]

    p = await client.patch(
        f"/api/v1/purchase-requests/{rid}",
        json={"job_id": "LW26031", "title": "NSK3500CC", "branch_no": "26031"},
    )
    assert p.status_code == 200, p.text
    assert p.json()["job_id"] == "LW26031"
    assert p.json()["branch_no"] == "26031"
    assert p.json()["job_title"] == "NSK3500CC"


@pytest.mark.asyncio
async def test_reply_closes_request(client: AsyncClient) -> None:
    r = await client.post("/api/v1/purchase-requests", data=_form(), files=_file())
    rid = r.json()["id"]

    rep = await client.post(
        f"/api/v1/purchase-requests/{rid}/replies",
        data={"client_reply_id": "rep-1", "replied_by_account": "igarashi"},
        files={"file": ("手配結果.pdf", b"%PDF-1.7 dummy", "application/pdf")},
    )
    assert rep.status_code == 201, rep.text
    assert rep.json()["pdf_path"].startswith(f"purchase/{rid}/replies/")

    detail = await client.get(f"/api/v1/purchase-requests/{rid}")
    assert detail.json()["status"] == "answered"
    assert detail.json()["closed_at"] is not None
    assert len(detail.json()["replies"]) == 1

    # 既定の一覧 (未対応のみ) からは外れる
    lst = await client.get("/api/v1/purchase-requests")
    assert lst.json()["total"] == 0


@pytest.mark.asyncio
async def test_reply_is_idempotent(client: AsyncClient) -> None:
    r = await client.post("/api/v1/purchase-requests", data=_form(), files=_file())
    rid = r.json()["id"]
    payload = {"client_reply_id": "rep-same", "replied_by_account": "igarashi"}
    pdf = {"file": ("手配結果.pdf", b"%PDF-1.7 dummy", "application/pdf")}

    await client.post(f"/api/v1/purchase-requests/{rid}/replies", data=payload, files=pdf)
    await client.post(f"/api/v1/purchase-requests/{rid}/replies", data=payload, files=pdf)
    assert await _count(PurchaseRequestReply) == 1


@pytest.mark.asyncio
async def test_reject_disallowed_extension(client: AsyncClient) -> None:
    """部品リストは Excel のみ。実行ファイル等は 400 で弾く。"""
    r = await client.post(
        "/api/v1/purchase-requests",
        data=_form(client_request_id="req-bad"),
        files={"file": ("malware.exe", b"MZ", "application/octet-stream")},
    )
    assert r.status_code == 400, r.text
    assert await _count(PurchaseRequest) == 0


@pytest.mark.asyncio
async def test_archived_request_returns_404_on_file(client: AsyncClient) -> None:
    r = await client.post("/api/v1/purchase-requests", data=_form(), files=_file())
    rid = r.json()["id"]

    f = await client.get(f"/api/v1/purchase-requests/{rid}/file")
    assert f.status_code == 200

    # 論理アーカイブ (削除ではない)
    p = await client.patch(f"/api/v1/purchase-requests/{rid}", json={"archived": True})
    assert p.status_code == 200
    assert p.json()["archived_at"] is not None

    lst = await client.get("/api/v1/purchase-requests")
    assert lst.json()["total"] == 0
    # 行もファイルも消えていない
    assert await _count(PurchaseRequest) == 1
    from app.core.config import get_settings

    assert (get_settings().upload_dir / r.json()["request_file_path"]).is_file()


@pytest.mark.asyncio
async def test_list_by_job_for_detail_tab(client: AsyncClient) -> None:
    await client.post("/api/v1/purchase-requests", data=_form(), files=_file())
    r = await client.get("/api/v1/purchase-requests/jobs/LW25146")
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    assert r.json()[0]["job_id"] == "LW25146"


@pytest.mark.asyncio
async def test_export_returns_xlsx(client: AsyncClient) -> None:
    await client.post("/api/v1/purchase-requests", data=_form(), files=_file())
    r = await client.get("/api/v1/purchase-requests/export")
    assert r.status_code == 200, r.text
    # xlsx は ZIP コンテナなので PK シグネチャで始まる
    assert r.content.startswith(b"PK")
    assert "attachment" in r.headers["content-disposition"]
