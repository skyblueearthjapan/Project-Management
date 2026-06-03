from __future__ import annotations

import ipaddress
from pathlib import Path

from fastapi import HTTPException, Request, status

from app.core.config import get_settings


def is_lan_address(client_ip: str, allow_cidr: str) -> bool:
    """LAN許可CIDRに含まれるか判定。"""
    try:
        return ipaddress.ip_address(client_ip) in ipaddress.ip_network(allow_cidr, strict=False)
    except (ValueError, TypeError):
        return False


async def enforce_lan_only(request: Request) -> None:
    """FastAPI dependency: LAN外からのアクセスを403で遮断。Firewall併用前提だが二重防御。"""
    settings = get_settings()
    if settings.dev_mode:
        return
    client_host = request.client.host if request.client else ""
    if client_host in {"127.0.0.1", "::1"}:
        return
    if not is_lan_address(client_host, settings.lan_allow_cidr):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このサービスは社内LANからのみアクセス可能です。",
        )


def resolve_under(base: Path, untrusted: str | Path) -> Path:
    """untrusted パスを resolve し、base 配下であることを保証する。

    Path Traversal 防止: `../../etc/passwd` 等を弾く。
    """
    base_resolved = base.resolve()
    candidate = (base / Path(untrusted)).resolve()
    if not candidate.is_relative_to(base_resolved):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="許可されたディレクトリ外のパスです。",
        )
    return candidate
