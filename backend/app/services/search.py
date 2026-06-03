"""Phase A 刈り込み: Meilisearch 検索サービスは未使用化 (Round 3 合意)。

理由: 日程表 + 工番一覧の DB 部分一致で十分。Meili サービス自体を docker-compose から外したため、
本関数を呼び出してもネットワーク到達不能で失敗する。
CLAUDE.md §2.1 (削除関数禁止) のため関数定義自体は残すが、呼出元 (api/v1/search.py) からは外している。

Phase A 修正 2 巡目: 誤って呼ばれた場合は即時クラッシュさせる (loud failure)。
"""
from __future__ import annotations

from typing import Any

# httpx / get_settings は元実装で使用していたが、loud failure 化に伴い未使用。
# CLAUDE.md §2.1 のため import 自体は将来の再有効化を考慮して残置 (noqa)。
import httpx  # noqa: F401

from app.core.config import get_settings  # noqa: F401


async def meili_search(q: str, limit: int = 20) -> dict[str, Any]:
    """[DEPRECATED — Phase A で未使用化] Meilisearch jobs index への検索。

    現在はどこからも呼ばれない。Meili サービス自体が docker-compose から削除されているため、
    Phase A 修正 2 巡目以降は呼ばれた場合に RuntimeError で即時クラッシュする。
    """
    # 旧実装は以下のとおり (Phase F で再実装する場合の参考):
    #     settings = get_settings()
    #     headers = {"Authorization": f"Bearer {settings.meili_master_key.get_secret_value()}"}
    #     try:
    #         async with httpx.AsyncClient(timeout=2.0) as client:
    #             r = await client.post(
    #                 f"{settings.meili_url}/indexes/jobs/search",
    #                 headers=headers,
    #                 json={"q": q, "limit": limit},
    #             )
    #             if r.status_code == 404:
    #                 return {"hits": [], "query": q, "estimatedTotalHits": 0}
    #             r.raise_for_status()
    #             data: dict[str, Any] = r.json()
    #             return data
    #     except httpx.HTTPError:
    #         return {"hits": [], "query": q, "estimatedTotalHits": 0, "error": "meili_unavailable"}
    raise RuntimeError("Phase A 刈り込みで未使用化。呼び出さないこと。")
