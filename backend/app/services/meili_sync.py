"""Phase A 刈り込み: Meilisearch 同期ジョブは未使用化 (Round 3 合意)。

理由: Meilisearch 自体を廃止したため同期不要。
CLAUDE.md §2.1 (削除関数禁止) のため関数定義自体は残すが、scheduler からは外している。

Phase A 修正 2 巡目: 誤って呼ばれた場合は即時クラッシュさせる (loud failure)。
"""
from __future__ import annotations

# 旧実装で使用していた依存は loud failure 化に伴い未使用。
# CLAUDE.md §2.1 のため import 自体は将来の再有効化を考慮して残置 (noqa)。
import httpx  # noqa: F401
from sqlalchemy import select  # noqa: F401
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload  # noqa: F401

from app.core.config import get_settings  # noqa: F401
from app.core.logging import get_logger
from app.models.axis import Axis  # noqa: F401  - 旧コードのリレーション読込互換のため import 維持
from app.models.job import Job  # noqa: F401

logger = get_logger(__name__)


async def reindex_jobs(db: AsyncSession) -> dict[str, int]:
    """[DEPRECATED — Phase A で未使用化] jobs テーブル → Meilisearch `jobs` index に upsert。

    現在は scheduler からも呼ばれない。Phase A 修正 2 巡目以降は呼ばれた場合に
    RuntimeError で即時クラッシュする。
    """
    # 旧実装は以下のとおり (Phase F で再実装する場合の参考):
    #     settings = get_settings()
    #     stmt = select(Job).options(selectinload(Job.axes))
    #     jobs = (await db.execute(stmt)).scalars().unique().all()
    #     docs = [
    #         {
    #             "id": j.id,
    #             "title": j.title,
    #             "customer": j.customer,
    #             "status": j.status,
    #             "starred": j.starred,
    #             "delivery_date": j.delivery_date.isoformat() if j.delivery_date else None,
    #             "axes": [a.name for a in j.axes],
    #         }
    #         for j in jobs
    #     ]
    #     headers = {"Authorization": f"Bearer {settings.meili_master_key.get_secret_value()}"}
    #     async with httpx.AsyncClient(timeout=10.0) as client:
    #         await client.post(
    #             f"{settings.meili_url}/indexes",
    #             headers=headers,
    #             json={"uid": "jobs", "primaryKey": "id"},
    #         )
    #         if docs:
    #             r = await client.post(
    #                 f"{settings.meili_url}/indexes/jobs/documents",
    #                 headers=headers,
    #                 json=docs,
    #             )
    #             r.raise_for_status()
    #     logger.info("meili_synced", count=len(docs))
    #     return {"count": len(docs)}
    raise RuntimeError("Phase A 刈り込みで未使用化。呼び出さないこと。")
