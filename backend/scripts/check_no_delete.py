"""削除系関数の使用を機械的に検出する pre-commit 用スクリプト。

CLAUDE.md §2.1 で定義された禁止 API を grep ベースで検出する。
ruff のカスタムルールが安定するまではこのスクリプトを CI で叩く。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# 検出する正規表現 (Python)
PY_PATTERNS = [
    re.compile(r"\bos\.remove\("),
    re.compile(r"\bos\.unlink\("),
    re.compile(r"\bos\.rmdir\("),
    re.compile(r"\bos\.removedirs\("),
    re.compile(r"\bshutil\.rmtree\("),
    re.compile(r"\.unlink\("),
    re.compile(r"\.rmdir\("),
    # Path.rename / os.rename は強い副作用を持つため禁止
    re.compile(r"\bos\.rename\("),
    re.compile(r"\bos\.replace\("),
    re.compile(r"\.rename\("),
]

# 検出する正規表現 (Node/TS)
JS_PATTERNS = [
    re.compile(r"\bfs\.unlink\b"),
    re.compile(r"\bfs\.unlinkSync\b"),
    re.compile(r"\bfs\.rmdir\b"),
    re.compile(r"\bfs\.rm\b"),
    re.compile(r"\bfsPromises\.unlink\b"),
    re.compile(r"\bfsPromises\.rm\b"),
    re.compile(r"\bfs\.rename\b"),
]

ALLOWED_PATHS = {
    # このチェッカー自身、テスト、Alembic 自動生成のフィクスチャ
    "backend/scripts/check_no_delete.py",
    "backend/tests/test_no_delete_check.py",
}


def scan_file(path: Path) -> list[tuple[int, str]]:
    rel = path.as_posix()
    if any(rel.endswith(p) for p in ALLOWED_PATHS):
        return []
    patterns = PY_PATTERNS if path.suffix == ".py" else JS_PATTERNS
    issues: list[tuple[int, str]] = []
    try:
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            # コメント行は無視
            stripped = line.lstrip()
            if stripped.startswith(("#", "//", "/*", "*")):
                continue
            for pat in patterns:
                if pat.search(line):
                    issues.append((lineno, line.strip()))
                    break
    except OSError:
        return []
    return issues


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv[1:]] or [Path("backend"), Path("frontend/src")]
    files: list[Path] = []
    for t in targets:
        if t.is_file() and t.suffix in {".py", ".ts", ".tsx", ".js"}:
            files.append(t)
        elif t.is_dir():
            files.extend(p for p in t.rglob("*.py"))
            files.extend(p for p in t.rglob("*.ts"))
            files.extend(p for p in t.rglob("*.tsx"))
    bad = 0
    for f in files:
        issues = scan_file(f)
        for lineno, line in issues:
            sys.stderr.write(f"{f}:{lineno}: 削除系関数が検出されました: {line}\n")
            bad += 1
    if bad:
        sys.stderr.write(f"\n合計 {bad} 件の違反。CLAUDE.md §2.1 を参照してください。\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
