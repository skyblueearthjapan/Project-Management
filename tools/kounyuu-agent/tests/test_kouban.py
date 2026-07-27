"""工番の正規化テスト。

このアプリで最も間違えやすいのが **ID 体系のズレ**:
  - 日程表マスタ: `25146-1` (枝番あり・LW なし)
  - DOVE の工番 : `LW25146` (親工番・LW あり)
`to_job_id` と `master_key` が取り違えられていないことを固定する。
"""

from __future__ import annotations

import pytest

from kounyuu_agent import kouban


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("LW25146", "LW25146"),
        ("25146", "LW25146"),
        # 枝番付きでも DOVE へ送るのは親工番
        ("LW25146-1", "LW25146"),
        ("25146-2", "LW25146"),
        ("TS26007", "TS26007"),
        ("TS26007-1", "TS26007"),
        # 全角 / 「工番」表記つきでも読める
        ("工番ＬＷ２５１４６", "LW25146"),
        ("工番 25146-1", "LW25146"),
        ("EM26001", "EM26001"),
    ],
)
def test_to_job_id(raw: str, expected: str) -> None:
    assert kouban.to_job_id(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # マスタ照合は枝番付きキー (親工番では引けない)
        ("LW25146-1", "25146-1"),
        ("25146-2", "25146-2"),
        ("LW25146", "25146"),
        ("TS26007", "TS26007"),
        ("工番ＬＷ２５１４６－１", "25146-1"),
    ],
)
def test_master_key(raw: str, expected: str) -> None:
    assert kouban.master_key(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("LW25146-1", "25146-1"),
        ("LW25146", None),
        ("TS26007-2", "TS26007-2"),
        ("TS26007", None),
    ],
)
def test_branch_no(raw: str, expected: str | None) -> None:
    assert kouban.branch_no(raw) == expected


@pytest.mark.parametrize("raw", ["", "abc", "工番", "LW1"])
def test_unreadable_returns_none(raw: str) -> None:
    assert kouban.to_job_id(raw) is None
