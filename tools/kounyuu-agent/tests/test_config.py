"""config.toml 読込のテスト。

BOM 付き UTF-8 は Windows のメモ帳で編集すると実際に発生する。
`tomllib.load()` (バイナリ読み) では落ちるため、ここで固定しておく。
"""

from __future__ import annotations

from pathlib import Path

from kounyuu_agent.main import DEFAULT_CONFIG, load_config

SAMPLE = 'dove_base_url = "http://example/api/v1"\nrequest_timeout_sec = 45\n'


def test_load_config_without_file_uses_defaults(tmp_path: Path) -> None:
    cfg = load_config(str(tmp_path))
    assert cfg["dove_base_url"] == DEFAULT_CONFIG["dove_base_url"]


def test_load_config_plain_utf8(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text(SAMPLE, encoding="utf-8")
    cfg = load_config(str(tmp_path))
    assert cfg["dove_base_url"] == "http://example/api/v1"
    assert cfg["request_timeout_sec"] == 45
    # 未指定キーは既定値で補完される
    assert cfg["master_nittei_path"] == DEFAULT_CONFIG["master_nittei_path"]


def test_load_config_accepts_utf8_bom(tmp_path: Path) -> None:
    """メモ帳等で保存された BOM 付き UTF-8 でも読めること。"""
    (tmp_path / "config.toml").write_text(SAMPLE, encoding="utf-8-sig")
    cfg = load_config(str(tmp_path))
    assert cfg["dove_base_url"] == "http://example/api/v1"


def test_load_config_accepts_japanese_comment(tmp_path: Path) -> None:
    body = "# 日本語コメント\n" + SAMPLE
    (tmp_path / "config.toml").write_text(body, encoding="utf-8-sig")
    cfg = load_config(str(tmp_path))
    assert cfg["request_timeout_sec"] == 45
