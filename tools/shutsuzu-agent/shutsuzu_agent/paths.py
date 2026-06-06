"""UNC ⇄ fileserver 相対パス 変換（★契約点 設計書 §4.1 paths.py）。

EXE のファイル選択は Windows UNC（例 ``\\\\lineworks-sv\\Data\\設計\\...``）。
- メール本文のリンクは UNC のまま使う。
- DOVE API へ送るパスは **fileserver 相対 posix**（先頭 ``/`` なし）。

変換規則:
  1. config ``fileserver_unc_root`` プレフィックスを除去
  2. ``\\`` を ``/`` へ
  3. 先頭 ``/`` を除去

ルート不一致は ValueError を送出し、呼び出し側（gui.py）が **DOVE 登録前に中断** する。
本モジュールはファイルシステムを一切操作しない（read/write/copy/move/delete なし）。
"""

from __future__ import annotations


def normalize_unc(path: str) -> str:
    """選択パスを ``\\\\server\\share\\...`` 形式の UNC に正規化する。

    参照EXE :567-582 と同等の正規化（区切りを ``\\`` に統一し先頭 ``\\\\`` を保証）。
    """
    unc = path.replace("/", "\\")
    if not unc.startswith("\\\\") and unc.startswith("\\"):
        unc = "\\" + unc
    return unc


def to_fileserver_relative(
    unc_path: str, fileserver_unc_root: str, *, require_pdf: bool = False
) -> str:
    """Windows UNC パスを fileserver 相対 posix パスへ変換する。

    Args:
        unc_path: EXE で選択した UNC パス。
        fileserver_unc_root: config の UNC ルート（例 ``\\\\lineworks-sv\\Data``）。
        require_pdf: True の場合、末尾が ``.pdf`` でなければ ValueError。

    Raises:
        ValueError: ルート配下でない / 相対部が空 / PDF 必須なのに非PDF。
    """
    norm = normalize_unc(unc_path)
    root = normalize_unc(fileserver_unc_root).rstrip("\\")

    # Windows の UNC は大文字小文字を区別しないため case-insensitive で前方一致判定。
    if not norm.lower().startswith(root.lower()):
        raise ValueError(
            f"ファイルサーバルート配下のパスではありません。\nルート: {root}\nパス: {unc_path}"
        )

    rest = norm[len(root) :]
    rel = rest.replace("\\", "/").lstrip("/")
    if not rel:
        raise ValueError(f"相対パスを取得できません: {unc_path}")
    if require_pdf and not rel.lower().endswith(".pdf"):
        raise ValueError(f"PDF ファイルではありません: {unc_path}")
    return rel
