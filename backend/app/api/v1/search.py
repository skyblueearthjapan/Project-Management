"""Phase A 刈り込み: Meilisearch 全文検索 (`/v1/search`) は廃止 (Round 3 合意)。

理由: 日程表 + 工番一覧の DB 部分一致で十分。
ファイル本体は CLAUDE.md §2.1 (削除関数禁止) のため残すが、ルーターは空にして
`app/api/v1/__init__.py` 側からも include を外している。
"""
from __future__ import annotations

from fastapi import APIRouter

# 空のルーター (互換のため属性だけ残す。include されなくなったため到達しない)
router = APIRouter()
