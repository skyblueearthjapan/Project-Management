"""127.0.0.1 限定 HTTP サーバ。Outlook COM 経由でメール送信を行う。"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import sys
import time

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from agent.outlook_com import Recipient, send_via_outlook

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("pm-outlook-agent")

PORT = 34782

# H-2: backend と共有する HMAC 鍵 (環境変数経由)。
# 未設定の場合は agent を起動させない (= 認証なしで任意送信されるのを防ぐ)。
_HMAC_KEY = os.environ.get("OUTLOOK_AGENT_HMAC_KEY", "").encode("utf-8")

app = FastAPI(title="PM Outlook Agent", version="0.2.0")


class RecipientIn(BaseModel):
    kind: str = Field(pattern="^(to|cc|bcc)$")
    name: str | None = None
    email: EmailStr


class SendIn(BaseModel):
    subject: str = Field(min_length=1, max_length=256)
    body: str = ""
    recipients: list[RecipientIn] = Field(min_length=1)
    attachments: list[str] = Field(default_factory=list)
    display_only: bool = False
    # H-2: backend が build_agent_payload で発行した署名検証メタ。
    body_hash: str = Field(min_length=64, max_length=64)
    expires_at: int


def _compute_body_hash(subject: str, body: str) -> str:
    h = hashlib.sha256()
    h.update(subject.encode("utf-8"))
    h.update(b"\n\n")
    h.update(body.encode("utf-8"))
    return h.hexdigest()


def _canonical_recipients(recipients: list[RecipientIn]) -> bytes:
    order = {"to": 0, "cc": 1, "bcc": 2}
    items = sorted(
        ((r.kind, r.email, r.name or "") for r in recipients),
        key=lambda t: (order.get(t[0], 9), t[1]),
    )
    return b"\n".join(f"{k}|{e}|{n}".encode("utf-8") for k, e, n in items)


def _compute_token(
    *, body_hash: str, expires_at: int, recipients: list[RecipientIn]
) -> str:
    msg = b"|".join(
        [
            body_hash.encode("ascii"),
            str(expires_at).encode("ascii"),
            _canonical_recipients(recipients),
        ]
    )
    return hmac.new(_HMAC_KEY, msg, hashlib.sha256).hexdigest()


@app.middleware("http")
async def restrict_to_loopback(request: Request, call_next):
    client = request.client.host if request.client else ""
    if client not in {"127.0.0.1", "::1"}:
        return _forbidden()
    return await call_next(request)


def _forbidden():
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={"detail": "loopback only"},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "platform": sys.platform}


@app.post("/send")
async def send(
    payload: SendIn,
    x_agent_token: str | None = Header(default=None, alias="X-Agent-Token"),
) -> dict[str, str]:
    # H-2: HMAC 共有鍵が未設定なら起動運用ミス。403 で止める。
    if not _HMAC_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OUTLOOK_AGENT_HMAC_KEY が未設定です",
        )
    if not x_agent_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Agent-Token ヘッダがありません",
        )

    # 期限チェック (5 分 + ネットワーク許容で軽くゆるめる)
    now = int(time.time())
    if now > payload.expires_at:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="token expired"
        )
    # body 改ざん検出
    expected_hash = _compute_body_hash(payload.subject, payload.body)
    if not hmac.compare_digest(expected_hash, payload.body_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="body hash mismatch",
        )
    # 署名検証 (= recipients も含めて改ざんされていないことを保証)
    expected_token = _compute_token(
        body_hash=payload.body_hash,
        expires_at=payload.expires_at,
        recipients=payload.recipients,
    )
    if not hmac.compare_digest(expected_token, x_agent_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
        )

    try:
        result = send_via_outlook(
            subject=payload.subject,
            body=payload.body,
            recipients=[
                Recipient(kind=r.kind, email=r.email, name=r.name) for r in payload.recipients
            ],
            attachments=payload.attachments,
            display_only=payload.display_only,
        )
        log.info("mail dispatched: %s", result)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(e)) from e
    except Exception as e:  # pragma: no cover - COM 例外
        log.exception("outlook send failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e


def main() -> None:
    if not _HMAC_KEY:
        log.error(
            "OUTLOOK_AGENT_HMAC_KEY が未設定です。backend と同じ HMAC 鍵を環境変数に設定してから起動してください。"
        )
        sys.exit(2)
    log.info("starting on 127.0.0.1:%d", PORT)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")


if __name__ == "__main__":
    main()
