"""DOVE バックエンド連携クライアント (requests)。

社内 LAN 内の `http://dove/api/v1` を既定とする。タイムアウト必須。
アップロードを伴うため、出図EXE (15 秒) より長めの既定値にする。
"""

from __future__ import annotations

import json
from typing import Any

import requests


class DoveClient:
    """購入部品追加依頼 API の最小クライアント。"""

    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ---- 工番マスタ ----
    def search_master(self, q: str, limit: int = 30) -> list[dict[str, Any]]:
        """日程表マスタを部分一致で検索する。

        `exclude_existing` / `only_active` を明示で false にして、
        **DOVE 未登録の工番も取込済の工番も候補に出す**
        (未登録工番が大多数のため、除外すると実質使えない)。
        """
        resp = requests.get(
            f"{self.base_url}/jobs/master/search",
            params={
                "q": q,
                "exclude_existing": "false",
                "only_active": "false",
                "limit": limit,
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return list(resp.json().get("items", []))

    # ---- 依頼 ----
    def create_request(
        self, fields: dict[str, Any], file_path: str, file_name: str
    ) -> dict[str, Any]:
        """依頼を登録する (multipart・冪等)。

        ファイルは **読み取ってアップロードするだけ**。元ファイルには一切触らない
        (移動・削除・改名をしない = CLAUDE.md §2.1)。
        """
        data = {k: v for k, v in fields.items() if v is not None and v != ""}
        with open(file_path, "rb") as fp:
            resp = requests.post(
                f"{self.base_url}/purchase-requests",
                data=data,
                files={"file": (file_name, fp)},
                timeout=self.timeout,
            )
        return self._json_or_raise(resp, "依頼の登録")

    def list_requests(self, status: str = "open") -> list[dict[str, Any]]:
        """未対応一覧を取得する。**並び順はサーバが決める** (工番未定が先頭)。"""
        resp = requests.get(
            f"{self.base_url}/purchase-requests",
            params={"status": status, "page_size": 200},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return list(resp.json().get("items", []))

    def patch_request(self, request_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        resp = requests.patch(
            f"{self.base_url}/purchase-requests/{request_id}",
            json=payload,
            timeout=self.timeout,
        )
        return self._json_or_raise(resp, "依頼の更新")

    def add_reply(
        self, request_id: int, fields: dict[str, Any], file_path: str, file_name: str
    ) -> dict[str, Any]:
        data = {k: v for k, v in fields.items() if v is not None and v != ""}
        with open(file_path, "rb") as fp:
            resp = requests.post(
                f"{self.base_url}/purchase-requests/{request_id}/replies",
                data=data,
                files={"file": (file_name, fp)},
                timeout=self.timeout,
            )
        return self._json_or_raise(resp, "回答の登録")

    def download_request_file(self, request_id: int, save_path: str) -> None:
        """部品リスト Excel を取得して保存する (新規作成のみ)。"""
        resp = requests.get(
            f"{self.base_url}/purchase-requests/{request_id}/file", timeout=self.timeout
        )
        resp.raise_for_status()
        # 既存ファイルがあれば上書きせず失敗させる (CLAUDE.md §2.2)。
        with open(save_path, "xb") as f:
            f.write(resp.content)

    @staticmethod
    def _json_or_raise(resp: requests.Response, what: str) -> dict[str, Any]:
        if resp.status_code >= 400:
            detail = resp.text[:500]
            try:
                payload = resp.json()
                if isinstance(payload, dict) and "detail" in payload:
                    detail = json.dumps(payload["detail"], ensure_ascii=False)[:500]
            except ValueError:
                pass
            raise RuntimeError(f"{what}に失敗しました (HTTP {resp.status_code})\n{detail}")
        return dict(resp.json())
