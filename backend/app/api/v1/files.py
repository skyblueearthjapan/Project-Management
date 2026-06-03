from __future__ import annotations

import logging
import math
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import resolve_under
from app.models.dxf import DxfFile
from app.models.version import Version
from app.services.audit import client_actor, write_action_log

log = logging.getLogger(__name__)

router = APIRouter()


def _inline_disposition(file_path: Path) -> dict[str, str]:
    """`Content-Disposition: inline` ヘッダを組み立てる。

    FastAPI の `FileResponse` はデフォルトで `attachment` を付与してしまうため、
    新規タブで開いた際にブラウザがダウンロードを始めてしまう。inline で返すこと
    でブラウザ側 viewer (PDF など) や DXF の生表示が機能するようにする。
    日本語ファイル名にも対応するため RFC 5987 形式 (`filename*=UTF-8''...`) を併用。
    """
    encoded = quote(file_path.name, safe="")
    return {"Content-Disposition": f"inline; filename*=UTF-8''{encoded}"}


# H-3 / H-4: 任意フォルダ列挙・任意 PDF DL を抑止するため、
# /v1/files/fileserver と /v1/files/browse は `job_id` を必須化。
# path には必ず `{job_id}` がパス要素として含まれていなければならない
# (= 当該工番に属する資材のみ参照可能、別工番フォルダの覗き見禁止)。
# /v1/files/uploads は `releases/{job}/{axis}/` などのパターンのみ許可。
#
# 「Drawings/{job_id}/」固定にすると業務上の各種フォルダ
# (例: `設計/{job_id}/{axis}/`, `部品/{job_id}/...`) で運用に支障が出るため、
# 「path に job_id が含まれていること」を最低条件とした
# (見直しは後段の別エンドポイントで広げる方針 — 詳細はタスク仕様参照)。

# 工番文字列のフォーマット制約 (Path Traversal 防止)。
# Job.id は String(32) のため最大長 32 を超えるものは弾く。
# 許可文字は ASCII 英数 + `-` + `_` + ASCII `.`。
# 区切り (/ \\) を含むものは別パス要素を巻き込むため不可。
_JOB_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,32}$")


def _validate_job_id(job_id: str) -> str:
    if not _JOB_ID_RE.match(job_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="job_id の書式が不正です",
        )
    return job_id


def _scoped_to_job(job_id: str, rel: str, *, allow_empty: bool) -> PurePosixPath:
    """`rel` パスに `job_id` がパス要素として含まれているかを保証する。

    `rel` が空文字なら `Drawings/{job_id}` を返す (フロントの初期表示用デフォルト)。
    `..` や絶対パスは弾く。`job_id` がどこのコンポーネントにも現れない場合は 400。
    """
    rel_norm = rel.replace("\\", "/").lstrip("/")
    if not rel_norm:
        if not allow_empty:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="path を指定してください",
            )
        return PurePosixPath("Drawings") / job_id

    target = PurePosixPath(rel_norm)
    if ".." in target.parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="許可されないパス要素 (..) が含まれます",
        )
    if job_id not in target.parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("path は対象工番 (job_id) を含むディレクトリ配下を指す必要があります"),
        )
    return target


@router.get("/fileserver")
async def serve_fileserver(
    path: str = Query(min_length=1, description="/mnt/fileserver からの相対パス"),
    job_id: str = Query(
        ...,
        min_length=1,
        max_length=32,
        description="対象工番 (= path にこの job_id が含まれていなければならない)",
    ),
) -> FileResponse:
    """ファイルサーバ上のファイルを読み取り専用で返す。

    H-3: path には対象工番 (job_id) がパス要素として含まれていなければならない
    (= 別工番フォルダの直接 DL を遮断)。
    """
    _validate_job_id(job_id)
    target_rel = _scoped_to_job(job_id, path, allow_empty=False)

    settings = get_settings()
    full = resolve_under(settings.fileserver_root, str(target_rel))
    if not full.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ファイルが見つかりません"
        )
    mime, _ = mimetypes.guess_type(str(full))
    return FileResponse(
        full,
        media_type=mime or "application/octet-stream",
        headers=_inline_disposition(full),
    )


# /mnt/uploads 配下で許可するパターン (releases/{job}/{axis}/... or replacements/{job}/{axis}/...)
_UPLOADS_PATTERN = re.compile(r"^(releases|replacements)/[A-Za-z0-9._-]{1,32}/[0-9]+/.+$")
# Phase C で導入された /mnt/uploads/scans/{job}/ と /mnt/uploads/mail/ も参照可能にする
# (T4 受領フロー + EML 履歴ダウンロード)。
_UPLOADS_PATTERN_SCAN = re.compile(r"^scans/[A-Za-z0-9._-]{1,64}/.+$")
_UPLOADS_PATTERN_MAIL = re.compile(r"^mail/.+$")
# V2: DXF アップロード `/mnt/uploads/dxf/{job}/{axis}/...`
_UPLOADS_PATTERN_DXF = re.compile(r"^dxf/[A-Za-z0-9._-]{1,32}/[0-9]+/.+$")
# LinkModal: PC からの関連資料 / 部品リストアップロード
_UPLOADS_PATTERN_RELATED = re.compile(r"^related-docs/[A-Za-z0-9._-]{1,32}/[0-9]+/.+$")
_UPLOADS_PATTERN_PARTS = re.compile(r"^parts-lists/[A-Za-z0-9._-]{1,32}/[0-9]+/.+$")


@router.get("/uploads")
async def serve_uploads(path: str = Query(min_length=1)) -> FileResponse:
    """`/mnt/uploads` 配下を返す。

    H-4: 許可パターンに合致しないパスは 400 で弾く。
    - releases/{job}/{axis}/...
    - replacements/{job}/{axis}/...
    - scans/{job}/... (T4 受領)
    - mail/... (EML)
    - related-docs/{job}/{axis}/... (LinkModal PC アップロード)
    - parts-lists/{job}/{axis}/...   (LinkModal PC アップロード)
    """
    settings = get_settings()
    rel = path.replace("\\", "/").lstrip("/")
    if not (
        _UPLOADS_PATTERN.match(rel)
        or _UPLOADS_PATTERN_SCAN.match(rel)
        or _UPLOADS_PATTERN_MAIL.match(rel)
        or _UPLOADS_PATTERN_DXF.match(rel)
        or _UPLOADS_PATTERN_RELATED.match(rel)
        or _UPLOADS_PATTERN_PARTS.match(rel)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "uploads パスは releases/{job}/{axis}/... / "
                "replacements/{job}/{axis}/... / scans/{job}/... / "
                "mail/... / dxf/{job}/{axis}/... / "
                "related-docs/{job}/{axis}/... / "
                "parts-lists/{job}/{axis}/... 形式のみ許可されています"
            ),
        )
    full = resolve_under(settings.upload_dir, rel)
    if not full.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ファイルが見つかりません"
        )
    mime, _ = mimetypes.guess_type(str(full))
    return FileResponse(
        full,
        media_type=mime or "application/octet-stream",
        headers=_inline_disposition(full),
    )


# =============================================================================
# PDF サムネイル: 1ページ目を PNG で返す (工番一覧の左端表紙表示用)
# =============================================================================
# 同じファイル (path + mtime + size + 幅) なら再レンダ不要なのでメモリ LRU で
# キャッシュ。CLAUDE.md §2.1 によりディスクへの永続キャッシュは行わない
# (ファイル削除/上書きを伴う運用は禁止のため、メモリ完結で十分)。

_THUMB_CACHE: dict[tuple[str, int, int, int], bytes] = {}
_THUMB_CACHE_MAX = 256


def _render_pdf_thumbnail(full_path: Path, width_px: int) -> bytes:
    """PDF の 1 ページ目を PNG バイト列で返す。"""
    try:
        import pymupdf  # type: ignore[import-untyped]
    except ImportError as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"pymupdf (PyMuPDF) が未インストールです: {exc}",
        ) from exc

    st = full_path.stat()
    key = (str(full_path), st.st_mtime_ns, st.st_size, width_px)
    cached = _THUMB_CACHE.get(key)
    if cached is not None:
        return cached

    doc = pymupdf.open(str(full_path))
    try:
        if doc.page_count <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="PDF にページがありません",
            )
        page = doc[0]
        # ページ幅 (pt) → 指定 px 幅へのスケール
        page_w_pt = float(page.rect.width) or 612.0
        scale = max(width_px / page_w_pt, 0.05)
        mat = pymupdf.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png = bytes(pix.tobytes("png"))
    finally:
        doc.close()

    _THUMB_CACHE[key] = png
    # 古いエントリから FIFO で破棄 (insertion order)
    while len(_THUMB_CACHE) > _THUMB_CACHE_MAX:
        _THUMB_CACHE.pop(next(iter(_THUMB_CACHE)))
    return png


@router.get("/version/{version_id}/thumbnail")
async def serve_version_thumbnail(
    version_id: int,
    w: int = Query(160, ge=40, le=400, description="サムネイル幅 (px)"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """`versions.id` の PDF の 1 ページ目を PNG で返す。

    工番一覧の左端に表紙を出すための画像エンドポイント。
    キャッシュキーには mtime + size を含むので、PDF が差し替わると自動的に
    新しいサムネイルが返る。
    """
    settings = get_settings()
    v = await db.get(Version, version_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="バージョンが見つかりません"
        )
    rel = v.pdf_path.lstrip("/")
    if rel.startswith("releases/") or rel.startswith("replacements/"):
        full = resolve_under(settings.upload_dir, rel)
    else:
        full = resolve_under(settings.fileserver_root, rel)
    if not full.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PDFファイルが見つかりません"
        )

    png = _render_pdf_thumbnail(full, w)
    return Response(
        content=png,
        media_type="image/png",
        # 1 時間ブラウザキャッシュ。差替後は version_id が変わるか mtime 差で
        # サーバ側キャッシュも自動再生成されるため安全。
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/version/{version_id}")
async def serve_version_pdf(version_id: int, db: AsyncSession = Depends(get_db)) -> FileResponse:
    """versions テーブルの id から PDF を返す。

    DB 経由で pdf_path を取得するため任意指定不可。既存挙動を維持。
    """
    settings = get_settings()
    v = await db.get(Version, version_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="バージョンが見つかりません"
        )
    rel = v.pdf_path.lstrip("/")
    if rel.startswith("releases/") or rel.startswith("replacements/"):
        full = resolve_under(settings.upload_dir, rel)
    else:
        full = resolve_under(settings.fileserver_root, rel)
    if not full.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PDFファイルが見つかりません"
        )
    mime, _ = mimetypes.guess_type(str(full))
    return FileResponse(
        full,
        media_type=mime or "application/pdf",
        headers=_inline_disposition(full),
    )


@router.get("/dxf/{dxf_id}")
async def serve_dxf_file(dxf_id: int, db: AsyncSession = Depends(get_db)) -> FileResponse:
    """dxf_files テーブルの id から DXF を返す。

    file_path が `dxf/` で始まる場合は `/mnt/uploads` 配下、
    それ以外は `/mnt/fileserver` 配下を読む (PDF の serve_version_pdf と同パターン)。
    """
    settings = get_settings()
    d = await db.get(DxfFile, dxf_id)
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DXFが見つかりません")
    rel = d.file_path.lstrip("/")
    if rel.startswith("dxf/"):
        full = resolve_under(settings.upload_dir, rel)
    else:
        full = resolve_under(settings.fileserver_root, rel)
    if not full.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="DXFファイルが見つかりません"
        )
    mime, _ = mimetypes.guess_type(str(full))
    # DXF は ASCII / Binary 両方あるため明示せず octet-stream にフォールバック
    return FileResponse(
        full,
        media_type=mime or "application/octet-stream",
        headers=_inline_disposition(full),
    )


@router.get("/pdf")
async def serve_pdf(
    path: str = Query(min_length=1, description="versions.pdf_path の値"),
) -> FileResponse:
    """`versions.pdf_path` の値から PDF を返す。

    - `releases/...` で始まれば `/mnt/uploads` 配下を読む (アップロード経路)
    - それ以外は `/mnt/fileserver` 配下 (ファイルサーバ参照)
    既存挙動を維持 (DB 経由のパスを使う前提)。
    """
    settings = get_settings()
    rel = path.lstrip("/")
    if rel.startswith("releases/") or rel.startswith("replacements/"):
        full = resolve_under(settings.upload_dir, rel)
    else:
        full = resolve_under(settings.fileserver_root, rel)
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDFが見つかりません")
    mime, _ = mimetypes.guess_type(str(full))
    return FileResponse(
        full,
        media_type=mime or "application/pdf",
        headers=_inline_disposition(full),
    )


# =============================================================================
# Phase M: DXF パース API (ezdxf による server-side パース → SVG 用 JSON)
# =============================================================================
# 参考実装: 材料取りCADソフト/api/services/dxf_parser.py
# フロント側 (dxf-viewer + Three.js) が描画失敗する問題があり、サーバで
# ezdxf でパースして JSON 化し、フロントは SVG で直描画する方式に転換。

_DXF_SUPPORTED_TYPES = {
    "LINE", "CIRCLE", "ARC", "LWPOLYLINE", "POLYLINE", "ELLIPSE", "SPLINE",
    "TEXT", "MTEXT", "INSERT", "DIMENSION", "LEADER", "POINT", "SOLID",
}


def _dxf_geom_for(e: Any) -> dict[str, Any]:
    """ezdxf entity → JSON-serialisable geometry dict (DXF 座標 / Y-up)。

    対応していないタイプ・読めない属性は空 dict を返す (描画はスキップ)。
    """
    t = e.dxftype()
    try:
        if t == "LINE":
            s, ed = e.dxf.start, e.dxf.end
            return {"x1": float(s.x), "y1": float(s.y), "x2": float(ed.x), "y2": float(ed.y)}
        if t == "CIRCLE":
            c = e.dxf.center
            return {"cx": float(c.x), "cy": float(c.y), "r": float(e.dxf.radius)}
        if t == "ARC":
            c = e.dxf.center
            return {
                "cx": float(c.x),
                "cy": float(c.y),
                "r": float(e.dxf.radius),
                "start_angle": float(e.dxf.start_angle),
                "end_angle": float(e.dxf.end_angle),
            }
        if t == "LWPOLYLINE":
            pts: list[list[float]] = []
            try:
                for p in e.get_points("xyb"):
                    pts.append([float(p[0]), float(p[1]), float(p[2])])
            except Exception:  # noqa: BLE001
                pts = [[float(p[0]), float(p[1]), 0.0] for p in e.get_points("xy")]
            return {"vertices": pts, "closed": bool(e.closed)}
        if t == "POLYLINE":
            verts: list[list[float]] = []
            for v in e.vertices:
                loc = v.dxf.location
                bulge = float(getattr(v.dxf, "bulge", 0.0) or 0.0)
                verts.append([float(loc.x), float(loc.y), bulge])
            return {"vertices": verts, "closed": bool(e.is_closed)}
        if t == "ELLIPSE":
            c, ma = e.dxf.center, e.dxf.major_axis
            return {
                "cx": float(c.x),
                "cy": float(c.y),
                "major_x": float(ma.x),
                "major_y": float(ma.y),
                "ratio": float(e.dxf.ratio),
            }
        if t == "SPLINE":
            ctrl = [[float(p.x), float(p.y)] for p in e.control_points]
            return {"control_points": ctrl, "degree": int(e.dxf.degree)}
        if t == "TEXT":
            ip = e.dxf.insert
            return {
                "x": float(ip.x),
                "y": float(ip.y),
                "text": str(e.dxf.text),
                "height": float(getattr(e.dxf, "height", 0.0)),
                "rotation": float(getattr(e.dxf, "rotation", 0.0)),
            }
        if t == "MTEXT":
            ip = e.dxf.insert
            try:
                txt = e.plain_text()
            except Exception:  # noqa: BLE001
                txt = str(getattr(e, "text", ""))
            return {
                "x": float(ip.x),
                "y": float(ip.y),
                "text": txt,
                "height": float(getattr(e.dxf, "char_height", 0.0)),
                "rotation": float(getattr(e.dxf, "rotation", 0.0)),
            }
        if t == "INSERT":
            ip = e.dxf.insert
            return {
                "x": float(ip.x),
                "y": float(ip.y),
                "name": str(e.dxf.name),
                "rotation": float(getattr(e.dxf, "rotation", 0.0)),
            }
        if t == "DIMENSION":
            anchors: list[list[float]] = []
            for a in ("defpoint", "defpoint2", "defpoint3", "defpoint4", "defpoint5", "text_midpoint"):
                pt = getattr(e.dxf, a, None)
                if pt is not None:
                    anchors.append([float(pt.x), float(pt.y)])
            text = str(getattr(e.dxf, "text", "") or "")
            if not text or text == "<>":
                try:
                    meas = e.get_measurement()  # type: ignore[attr-defined]
                except Exception:  # noqa: BLE001
                    meas = None
                if isinstance(meas, (int, float)):
                    text = f"{float(meas):.1f}"
                else:
                    text = "(寸法)"
            return {"anchors": anchors, "text": text}
        if t == "LEADER":
            verts = [[float(v.x), float(v.y)] for v in e.vertices]
            return {"vertices": verts}
        if t == "POINT":
            p = e.dxf.location
            return {"x": float(p.x), "y": float(p.y)}
        if t == "SOLID":
            return {
                "vertices": [
                    [float(getattr(e.dxf, f"vtx{i}").x), float(getattr(e.dxf, f"vtx{i}").y)]
                    for i in range(4)
                    if getattr(e.dxf, f"vtx{i}", None) is not None
                ]
            }
    except Exception as exc:  # noqa: BLE001
        log.debug("dxf geom extraction failed for %s: %s", t, exc)
    return {}


def _dxf_parse_to_json(full_path: Path) -> dict[str, Any]:
    """DXF を ezdxf でパースして JSON 化。

    - 戻り値: { bounding_box, entities[], layers[], stats, units, name }
    - DIMENSION / INSERT / LEADER は virtual_entities() で展開して
      フラットなエンティティ列にする (フロント描画簡素化のため)。
    """
    import ezdxf
    from ezdxf import bbox as ezdxf_bbox
    from ezdxf import recover

    try:
        doc, _auditor = recover.readfile(str(full_path))
    except Exception as exc:  # noqa: BLE001
        log.warning("DXF parse failed: %s (%s)", full_path, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"DXF のパースに失敗しました: {exc}",
        ) from exc

    msp = doc.modelspace()
    entities: list[dict[str, Any]] = []
    virt_counter = 0

    # 「アノテーション」= 寸法線 / 引出線 / 注釈テキスト 等の "図形以外"。
    # フロントでスナップ対象外 + 視覚的に淡色で区別するため、各エンティティに
    # is_annotation フラグを付ける。
    #   - 原始エンティティ: TEXT / MTEXT / DIMENSION / LEADER は注釈
    #   - 仮想子: 親が DIMENSION / LEADER なら注釈 (INSERT の中身は実部品ありうるので非注釈)
    _ANNO_BASE = {"TEXT", "MTEXT", "DIMENSION", "LEADER"}
    for idx, e in enumerate(msp):
        eid = f"e{idx:05d}"
        geom = _dxf_geom_for(e)
        is_anno = e.dxftype() in _ANNO_BASE
        if geom or e.dxftype() in ("DIMENSION", "INSERT", "LEADER"):
            entities.append({
                "id": eid,
                "type": e.dxftype(),
                "color": int(getattr(e.dxf, "color", 256) or 256),
                "layer": str(getattr(e.dxf, "layer", "0")),
                "geom": geom,
                "is_annotation": is_anno,
            })
        if e.dxftype() in ("DIMENSION", "INSERT", "LEADER"):
            # 仮想子が注釈か否か。DIMENSION/LEADER 由来は寸法/引出の構成要素 = 注釈。
            # INSERT 由来は実部品 (ボルト / 穴ブロック等) を含み得るので非注釈扱い。
            children_are_anno = e.dxftype() in ("DIMENSION", "LEADER")
            try:
                for ve in e.virtual_entities():
                    vt = ve.dxftype()
                    if vt in ("DIMENSION", "INSERT"):
                        continue
                    vgeom = _dxf_geom_for(ve)
                    if not vgeom:
                        continue
                    veid = f"v{virt_counter:05d}_{eid}"
                    virt_counter += 1
                    entities.append({
                        "id": veid,
                        "type": vt,
                        "color": int(getattr(ve.dxf, "color", 256) or 256),
                        "layer": str(getattr(ve.dxf, "layer", "0")),
                        "geom": vgeom,
                        "is_annotation": children_are_anno,
                    })
            except Exception as exc:  # noqa: BLE001
                log.debug("virtual_entities expansion failed: %s", exc)

    # bounding box (失敗時は entities から算出)
    bb = {"min_x": 0.0, "min_y": 0.0, "max_x": 1.0, "max_y": 1.0}
    try:
        ext = ezdxf_bbox.extents(msp)
        if ext.has_data:
            bb = {
                "min_x": float(ext.extmin.x),
                "min_y": float(ext.extmin.y),
                "max_x": float(ext.extmax.x),
                "max_y": float(ext.extmax.y),
            }
    except Exception:  # noqa: BLE001
        # 退避: entities の座標から推定
        xs, ys = [], []
        for ent in entities:
            g = ent["geom"]
            if not g:
                continue
            if "x1" in g and "y1" in g:
                xs += [g["x1"], g.get("x2", g["x1"])]
                ys += [g["y1"], g.get("y2", g["y1"])]
            elif "cx" in g and "cy" in g:
                r = g.get("r", 0.0) or 0.0
                xs += [g["cx"] - r, g["cx"] + r]
                ys += [g["cy"] - r, g["cy"] + r]
            elif "vertices" in g:
                for v in g["vertices"]:
                    xs.append(v[0])
                    ys.append(v[1])
            elif "x" in g and "y" in g:
                xs.append(g["x"])
                ys.append(g["y"])
        if xs and ys:
            bb = {"min_x": min(xs), "min_y": min(ys), "max_x": max(xs), "max_y": max(ys)}

    # bbox が縮退 (0px) なら最低限の幅を持たせる
    if math.isclose(bb["max_x"], bb["min_x"]):
        bb["max_x"] = bb["min_x"] + 1.0
    if math.isclose(bb["max_y"], bb["min_y"]):
        bb["max_y"] = bb["min_y"] + 1.0

    # レイヤー一覧 + ACI → RGB マッピング
    layers: list[dict[str, Any]] = []
    try:
        from ezdxf.colors import aci2rgb  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        aci2rgb = None  # type: ignore[assignment]

    for layer in doc.layers:
        aci = int(getattr(layer.dxf, "color", 7) or 7)
        rgb = None
        if aci2rgb is not None:
            try:
                r, g, b = aci2rgb(aci)
                rgb = f"#{r:02x}{g:02x}{b:02x}"
            except Exception:  # noqa: BLE001
                rgb = None
        layers.append({
            "name": str(layer.dxf.name),
            "color": aci,
            "rgb": rgb,
            "visible": not bool(getattr(layer.dxf, "off", False)),
        })

    # ユニット。日本の機械業界では $INSUNITS=0 (未指定) も実体は mm なので、
    # 産業上の常識として mm をデフォルトにする (誤表示防止)。
    units_code = int(doc.header.get("$INSUNITS", 4))
    units = {1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m"}.get(units_code, "mm")

    # 統計
    counts: dict[str, int] = {}
    for ent in entities:
        counts[ent["type"]] = counts.get(ent["type"], 0) + 1

    return {
        "name": full_path.name,
        "bounding_box": bb,
        "entities": entities,
        "layers": layers,
        "units": units,
        "stats": {"total": len(entities), "by_type": counts},
    }


def _resolve_dxf_path_by_id(d: DxfFile) -> Path:
    settings = get_settings()
    rel = d.file_path.lstrip("/")
    if rel.startswith("dxf/"):
        return resolve_under(settings.upload_dir, rel)
    return resolve_under(settings.fileserver_root, rel)


@router.get("/dxf/{dxf_id}/parsed")
async def serve_dxf_parsed(dxf_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """dxf_files の id から DXF を ezdxf でパースして JSON で返す。

    フロントの SVG ビューアはこのレスポンスから `<line>` `<circle>` `<path>` を
    直接生成する。Three.js / dxf-viewer を介さないのでブラウザ環境差に強い。
    """
    d = await db.get(DxfFile, dxf_id)
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DXFが見つかりません")
    full = _resolve_dxf_path_by_id(d)
    if not full.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="DXFファイルが見つかりません"
        )
    return _dxf_parse_to_json(full)


@router.get("/dxf/parsed")
async def serve_dxf_parsed_by_path(
    path: str = Query(min_length=1, description="/mnt/fileserver からの相対パス"),
    job_id: str = Query(..., min_length=1, max_length=32),
) -> dict[str, Any]:
    """path 経路 (?path=...) で DXF をパースして返す。後方互換用。"""
    _validate_job_id(job_id)
    target_rel = _scoped_to_job(job_id, path, allow_empty=False)
    settings = get_settings()
    full = resolve_under(settings.fileserver_root, str(target_rel))
    if not full.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="DXFファイルが見つかりません"
        )
    return _dxf_parse_to_json(full)


@router.get("/browse")
async def browse(
    job_id: str = Query(
        ...,
        min_length=1,
        max_length=32,
        description="対象工番 (= path にこの job_id が含まれているフォルダのみ列挙可能)",
    ),
    path: str = Query(
        default="",
        description=("/mnt/fileserver からの相対パス。空文字なら Drawings/{job_id}/ 直下を返す。"),
    ),
) -> dict:
    """ディレクトリ一覧。表示用。書き込みは行わない。

    H-3: path には対象工番 (job_id) がパス要素として含まれていなければならない
    (= 任意フォルダ列挙を遮断)。空 path のときだけ Drawings/{job_id}/ 直下にデフォルト。
    """
    _validate_job_id(job_id)
    target_rel = _scoped_to_job(job_id, path, allow_empty=True)

    settings = get_settings()
    full = resolve_under(settings.fileserver_root, str(target_rel))
    if not full.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="ディレクトリではありません"
        )
    entries = []
    rel_base = str(target_rel)
    for child in sorted(full.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        stat = child.stat()
        # フロントはこの relpath を後続の `path=` クエリにそのまま渡せる。
        entries.append(
            {
                "name": child.name,
                "is_dir": child.is_dir(),
                "size": stat.st_size if child.is_file() else None,
                "modified": stat.st_mtime,
                "relpath": f"{rel_base}/{child.name}",
            }
        )
    return {"path": rel_base, "job_id": job_id, "entries": entries}


# =============================================================================
# 済受領スキャン (旧 T4 メールフロー由来。メール廃止後も資料機能として存続)
# 旧 /api/v1/mail/scan-receipts から移設 (REFACTOR_REMOVE_MAIL.md)。
# =============================================================================


class ScanReceiptOut(BaseModel):
    """受領 PDF アップロード結果。保存先の相対パスを返す。"""

    path: str
    size: int


@router.post(
    "/scan-receipts",
    response_model=ScanReceiptOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_scan_receipt(
    request: Request,
    job_id: str = Form(..., description="関連工番"),
    file: UploadFile = File(..., description="済受領 PDF スキャン"),
    db: AsyncSession = Depends(get_db),
) -> ScanReceiptOut:
    """「済」スキャン PDF を `/mnt/uploads/scans/{job_id}/` に保存する。

    削除関数は呼ばない (CLAUDE.md §2.1 厳守) — 過去スキャンは全て残す。
    保存先は `/mnt/uploads` 配下のみ (resolve_under でガード)。
    """
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PDF以外のファイルは受け付けません: {file.content_type}",
        )
    # ファイル名サニタイズ (Path Traversal 防止)
    raw_name = (file.filename or "scan.pdf").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    bad = set('<>:"/\\|?*\x00')
    safe = "".join("_" if c in bad else c for c in raw_name)[:128] or "scan.pdf"
    if not safe.lower().endswith(".pdf"):
        safe = f"{safe}.pdf"
    stem = Path(safe).stem

    # job_id もパス要素に使うのでサニタイズ
    safe_job = "".join("_" if c in bad else c for c in job_id)[:64] or "_"

    settings = get_settings()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    rel_path = Path("scans") / safe_job / f"{stem}-{ts}.pdf"
    abs_path = resolve_under(settings.upload_dir, str(rel_path))
    abs_path.parent.mkdir(parents=True, exist_ok=True)

    # Content-Length による事前チェック (DoS 緩和)
    max_size = 50 * 1024 * 1024
    if file.size is not None and file.size > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="50MB を超える PDF は受け付けません",
        )

    content = await file.read()
    # 念のため実バイト数で再検証 (Content-Length 偽装対策)
    if len(content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="50MB を超える PDF は受け付けません",
        )

    # PDF magic bytes 検証 (content_type 偽装対策)
    if not content.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ファイルが PDF 形式ではありません (magic bytes 不一致)",
        )

    abs_path.write_bytes(content)

    rel_str = str(rel_path).replace("\\", "/")
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="scan_receipt.upload",
        job_id=job_id,
        payload={"job_id": job_id, "path": rel_str},
    )
    return ScanReceiptOut(path=rel_str, size=len(content))


class ScanReceiptByPathIn(BaseModel):
    """LinkModal A/P モード用: 既存ファイルへのパス参照だけを返す軽量経路。"""

    job_id: str
    file_path: str
    note: str | None = None


@router.post(
    "/scan-receipts/by-path",
    response_model=ScanReceiptOut,
    status_code=status.HTTP_201_CREATED,
)
async def register_scan_receipt_by_path(
    body: ScanReceiptByPathIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ScanReceiptOut:
    """既存ファイル (サーバ上 or アップロード済み) を「済受領」として確認するだけの endpoint。

    scan-receipt は DB 行を持たない一過性データなので、パス存在確認 + 監査ログのみ。
    ファイル実体は触らない (CLAUDE.md §2.1 / §2.2)。
    """
    settings = get_settings()
    # path traversal 防止: fileserver_root か upload_dir のどちらか配下を許可
    candidate_bases = [settings.fileserver_root, settings.upload_dir]
    size = 0
    found = False
    for base in candidate_bases:
        try:
            abs_path = resolve_under(base, body.file_path)
        except HTTPException:
            continue
        if abs_path.is_file():
            try:
                size = abs_path.stat().st_size
            except OSError:
                size = 0
            found = True
            break
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ファイルが見つかりません (fileserver/uploads いずれの配下にもありません)",
        )

    rel_str = body.file_path.replace("\\", "/")
    await write_action_log(
        db,
        actor=client_actor(request),
        action_type="scan_receipt.register_by_path",
        job_id=body.job_id,
        payload={"job_id": body.job_id, "path": rel_str},
    )
    return ScanReceiptOut(path=rel_str, size=size)
