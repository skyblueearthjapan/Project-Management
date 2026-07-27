"""アップロード共通処理 (`/mnt/uploads` 配下への排他作成)。

CLAUDE.md §2.1 / §2.2 の中核を担うモジュール:
  - **新規作成のみ**。`open(path, "xb")` で既存ファイルがあれば `FileExistsError` を投げ、
    上書きを拒否する。
  - 削除・改名関数 (`os.remove` / `Path.unlink` / `Path.rename` 等) を一切登場させない。
  - 保存先は `resolve_under()` で `/mnt/uploads` 配下に強制する (Path Traversal 防止)。

`api/v1/attachments.py` に実装されていたものを、購入部品追加依頼など他ルーターからも
使えるようにサービス層へ移動した (挙動は変えていない)。
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings
from app.core.security import resolve_under

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def safe_filename(name: str) -> str:
    """アップロードファイル名から危険な文字を除いた最終ファイル名を返す。"""
    # path separator や `..` を除去 (Path Traversal 防止)
    p = Path(name)
    base = p.name
    # 制御文字や Windows 予約文字を「_」に
    bad = set('<>:"/\\|?*\x00')
    return "".join("_" if c in bad else c for c in base)[:128] or "file.bin"


def exclusive_write_bytes(path: Path, data: bytes) -> None:
    """`open(path, "xb")` で排他作成。

    CLAUDE.md §2.1 / §2.2: 既存ファイルがあれば `FileExistsError` を投げて
    上書きを拒否する。呼び出し側は 409 に変換する。
    aiofiles は "xb" を安定サポートしていないため同期 open + `to_thread` で
    event loop をブロックしないようにする。
    """
    with open(path, "xb") as f:
        f.write(data)


async def save_uploaded_file(
    upload: UploadFile, *, sub_dir: Path, allowed_ext: set[str] | None = None
) -> tuple[Path, str, int]:
    """`/mnt/uploads/{sub_dir}/` 配下に排他作成で保存し (rel_path, rel_str, size) を返す。

    保存ファイル名: `{stem}__{yyyymmddHHMMSS}{ext}` で衝突時のリトライ余地を確保。
    """
    settings = get_settings()
    safe = safe_filename(upload.filename or "upload.bin")
    ext = Path(safe).suffix.lower()
    if allowed_ext is not None and ext not in allowed_ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"許可されていない拡張子です: {ext or '(無拡張子)'}",
        )
    content = await upload.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="50MB を超えるファイルは受け付けません",
        )

    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    stem = Path(safe).stem
    out_name = f"{stem}__{ts}{ext}"
    rel_path = sub_dir / out_name
    abs_path = resolve_under(settings.upload_dir, str(rel_path))
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        await asyncio.to_thread(exclusive_write_bytes, abs_path, content)
    except FileExistsError as exc:
        # 1 秒以内の同名連打のみ起こり得る。タイムスタンプ + サフィックスで再試行。
        for attempt in range(1, 6):
            out_name = f"{stem}__{ts}-{attempt}{ext}"
            rel_path = sub_dir / out_name
            abs_path = resolve_under(settings.upload_dir, str(rel_path))
            try:
                await asyncio.to_thread(exclusive_write_bytes, abs_path, content)
                break
            except FileExistsError:
                continue
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="同名ファイルが連続衝突しました。しばらく待って再試行してください。",
            ) from exc
    return rel_path, str(rel_path).replace("\\", "/"), len(content)
