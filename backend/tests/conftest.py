from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# テスト時のデフォルト環境変数 (実 DB を引かないように)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
# Phase A で未使用 (Meilisearch 廃止)。テスト時に環境変数を期待しないよう残置のみ。
os.environ.setdefault("MEILI_URL", "http://localhost:7700")
os.environ.setdefault("DEV_MODE", "true")
os.environ.setdefault("ENABLE_SCHEDULER", "false")
