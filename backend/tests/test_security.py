from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.core.security import is_lan_address, resolve_under


def test_is_lan_address_lan_range() -> None:
    assert is_lan_address("192.168.0.10", "192.168.0.0/16")
    assert is_lan_address("192.168.7.250", "192.168.0.0/16")


def test_is_lan_address_outside() -> None:
    assert not is_lan_address("8.8.8.8", "192.168.0.0/16")
    assert not is_lan_address("", "192.168.0.0/16")
    assert not is_lan_address("not-an-ip", "192.168.0.0/16")


def test_resolve_under_inside(tmp_path: Path) -> None:
    base = tmp_path
    target = base / "sub" / "a.txt"
    target.parent.mkdir(parents=True)
    target.write_text("x")
    resolved = resolve_under(base, "sub/a.txt")
    assert resolved == target.resolve()


def test_resolve_under_rejects_traversal(tmp_path: Path) -> None:
    base = tmp_path / "uploads"
    base.mkdir()
    with pytest.raises(HTTPException) as exc:
        resolve_under(base, "../etc/passwd")
    assert exc.value.status_code == 400
