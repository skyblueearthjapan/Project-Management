"""DOVE バックエンド連携クライアント（requests）。

- master 照会: ``GET /jobs/master/search?q={job_id}&exclude_existing=false``
  （既定 exclude_existing=true だと取込済工番が返らないため明示で false）。
- 登録:       ``POST /shutsuzu/register``（設計書 §2.1 のスキーマ）。

すべて社内LAN内の ``http://dove/api/v1`` を既定とする。タイムアウト必須。
"""

from __future__ import annotations

from typing import Any

import requests


class DoveClient:
    """DOVE バックエンドへの最小クライアント。"""

    def __init__(self, base_url: str, timeout: float = 15.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def search_master(self, job_id: str) -> dict[str, Any] | None:
        """工番マスタを照会し、job_no が完全一致する 1 件を返す。無ければ None。

        ネットワーク/照会失敗は呼び出し側でフォールバック（request→job_id）するため、
        ここでは例外を握りつぶさず送出する。
        """
        url = f"{self.base_url}/jobs/master/search"
        # exclude_existing/only_active はいずれも既定 True。取込済・非アクティブな工番でも
        # フォールバック照会（および再送時）に拾えるよう、両方を明示で false にする。
        params = {
            "q": job_id,
            "exclude_existing": "false",
            "only_active": "false",
            "limit": 20,
        }
        resp = requests.get(url, params=params, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        key = job_id.strip().lower()
        for item in data.get("items", []):
            if str(item.get("job_no", "")).strip().lower() == key:
                return item
        return None

    def register(self, payload: dict[str, Any]) -> dict[str, Any]:
        """出図登録（合成エンドポイント）。冪等のため再送しても安全。

        Raises:
            RuntimeError: HTTP 4xx/5xx（本文先頭を添えて中断）。
        """
        url = f"{self.base_url}/shutsuzu/register"
        resp = requests.post(url, json=payload, timeout=self.timeout)
        if resp.status_code >= 400:
            raise RuntimeError(
                f"DOVE登録に失敗しました (HTTP {resp.status_code})\n{resp.text[:500]}"
            )
        return resp.json()
