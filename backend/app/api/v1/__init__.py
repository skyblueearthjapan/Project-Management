from fastapi import APIRouter, Depends

from app.api.v1 import (
    admin,
    attachments,
    axes,
    axis_phase_stamps,
    dxf,
    files,
    health,
    job_phase_stamps,
    jobs,
    link_check,
    pdf_rotations,
    progress,
    purchase_requests,
    shutsuzu,
    workers,
)
from app.core.security import enforce_lan_only

# Phase A 刈り込み: Meilisearch (`search`) ルーターは include しない (Round 3 合意)

# C-1: 全 /api/v1/* に LAN 制限を二重防御として配線。
# Firewall 設定漏れ時に WAN から API を叩かれないよう dependency で 403 する。
# `/health` (root: `app.get("/health")`) は Docker healthcheck から叩くため除外
# (`api_router` 配下ではないので自動的に対象外)。
api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(enforce_lan_only)])
api_router.include_router(health.router, tags=["health"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(axes.router, prefix="/jobs", tags=["axes"])
api_router.include_router(attachments.router, prefix="/jobs", tags=["attachments"])
# V2 製造現場 DX: DXF を PDF と同格に扱う (一覧/作成/アップロード/フォルダ取込)
api_router.include_router(dxf.router, prefix="/jobs", tags=["dxf"])
api_router.include_router(progress.router, prefix="/progress", tags=["progress"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
# 出図のお知らせ × DOVE連携: 合成登録 + 工番別指示書 (Job単位) CRUD
api_router.include_router(shutsuzu.router, prefix="/shutsuzu", tags=["shutsuzu"])
# 購入部品追加依頼: 設計部員 → 資材購買 → 設計部員 の往復とステータス管理
api_router.include_router(
    purchase_requests.router, prefix="/purchase-requests", tags=["purchase-requests"]
)
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
# Phase D: 軸限定の即時リンクチェック (フロント「再チェック」ボタン用)
api_router.include_router(link_check.router, prefix="/link-check", tags=["link-check"])
# Phase N: 工程ごとの電子データネーム印 (worker マスタ / 押印・期日)
api_router.include_router(workers.router, prefix="/workers", tags=["workers"])
api_router.include_router(job_phase_stamps.router, prefix="/jobs", tags=["phase-stamps"])
# Phase N-2: 軸単位の電子データネーム印 (UI からはこちらだけを叩く)
api_router.include_router(
    axis_phase_stamps.router, prefix="/axes", tags=["axis-phase-stamps"]
)
# Phase O: PDF ページ回転メタ (実 PDF を書き換えずに表示回転を保持)
api_router.include_router(
    pdf_rotations.router, prefix="/versions", tags=["pdf-rotations"]
)
