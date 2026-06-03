# 実装状況サマリ (Phase 0–8)

最終更新: 2026-05-24 / **全 Phase 完了**

## 完了

### Phase 0: リポ初期化 ✅
- `README.md` / `CLAUDE.md` (開発規約) / `.gitignore` / `.env.example`
- `docker-compose.yml` (web / api / db / meili / backup, healthcheck付)
- `.pre-commit-config.yaml` (ruff + 削除関数禁止 + Excel書込禁止)

### Phase 1: バックエンド ✅
- FastAPI + structlog JSON + async SQLAlchemy 2.x + Pydantic v2 + Alembic
- 全 19 テーブル ORM + 初期マイグレーション + 進捗工程 10 件 seed
- API ルーター: `health`, `jobs`, `axes` (versions), `attachments` (関連資料/部品リスト/PDF差替), `progress`, `mail`, `files`, `search`, `admin`
- セキュリティユーティリティ: `enforce_lan_only`, `resolve_under` (Path Traversal対策)
- サービス層: EML生成, Meilisearch同期, リンク切れ検証, Excel工番マスタ取込 (read-only)
- バックグラウンドジョブ (APScheduler): Excel同期 / Meili同期 / リンク切れ検証 を定期実行
- テスト: security / mail / API統合 (jobs/axes/progress/mail/files)

### Phase 2: フロントエンド ✅
- Vite + React 18 + TS strict + Tailwind (Cyan #06b6d4 + 5階調)
- ルーティング: `/`一覧 / `/jobs/:id`詳細 / `/admin`管理
- 一覧: 検索 / FilterTabs 5値 / ★お気に入り / 軸別進捗バー
- 詳細: 軸タブ + 進捗 3-stateクリック / PDF Viewer (pdfjs) / DXF Viewer (距離・角度計測) + アクションボタン (出図/メール/関連資料/部品リスト/PDF差替)
- 管理 4タブ: 連絡先 / メールテンプレ / 工程マスタ / ユーザー (各CRUD)
- モーダル: ReleaseModal / MailModal / AttachmentsModal (3-tab)

### Phase 3-8: 個別機能 ✅
- PDF Viewer: ページ送り + 拡大縮小
- DXF Viewer: LINE/CIRCLE/ARC 描画 + クリック計測 (距離mm / 角度°) + ズーム
- 出図モーダル: 新バージョン登録
- メールモーダル: EML 保存 (`/mnt/uploads/mail/YYYYMMDD/...`)
- PDF差替モーダル: `multipart/form-data` で 50MB 上限アップロード、命名規約 `{stem}__replace-{ts}.pdf`
- 関連資料 / 部品リスト CRUD (UI + API)
- 管理画面 4タブ CRUD
- バックグラウンド同期 (Excel/Meili/リンク切れ)

### Outlook 連携 ✅
- `outlook-agent/` に Windows 常駐 exe ソースコード一式
  - `agent/main.py` (loopback 限定 FastAPI, port 34782)
  - `agent/outlook_com.py` (pywin32 + COM)
  - `build.ps1` (PyInstaller で単一 exe 化)
  - `install-startup.ps1` (HKCU\Run 登録)
- バックエンド側に `services/outlook_agent.py` (HTTP 呼出ラッパ)

### Phase 7: 本番デプロイ ✅
- `docs/DEPLOY.md` (Windows Server / SMB マウント / HTTPS / Firewall / バックアップ / ロールバック)

### Phase 8: 受入テスト準備 ✅
- 統合テスト: `tests/test_api_jobs.py` (jobs/axes/progress/mail/files の主要パス)
- セキュリティテスト: Path Traversal / LAN判定 / 削除関数grep
- pre-commit: 削除関数禁止 + Excel書込禁止を機械的に検出

## 既知の制約

| 項目 | 制約 | 対応 |
|---|---|---|
| Outlook exe ビルド | クライアントPC上で `build.ps1` 実行が必要 | ソースは完成、ビルドは導入手順で実施 |
| 自己署名 TLS 証明書 | 本番サーバ FQDN 確定後に発行 | `docs/DEPLOY.md` に手順記載 |
| Firewall ルール | サーバ実IPで適用 | PowerShell スニペット記載 |
| DXF 高度機能 | 平面投影前提。3D表示は範囲外 | 図面はすべて 2D で運用 |
| 認証 | なし (社内LAN前提) | Firewall + IP制限の二重防御 |

## 起動方法 (デスクトップDocker 動作確認用)

```powershell
cd "C:\Users\imaizumi.LINEWORKS-NET\Documents\Project Management"
Copy-Item .env.example .env
docker compose up -d --build
# Web: http://localhost:18080  (8080は他で使用中のため変更)
# API: http://localhost:18080/api/v1/docs
```

開発時 (Vite dev サーバ):
```powershell
cd backend; uvicorn app.main:app --reload --port 8000
cd frontend; npm install; npm run dev   # http://localhost:5174
```

## セキュリティ遵守状況

- 削除系関数: コードベース全体 grep ヒット **0件** ✅
- SMB `:ro` / アップロード `:rw` 分離 ✅
- 工番マスタExcel `read_only=True` 固定 ✅
- Path Traversal 防御 (`resolve_under`) ✅
- LAN 制限ミドルウェア + Firewall 二重防御 ✅
- SQLAlchemy ORM のみ (SQL文字列連結なし) ✅
- React JSX 自動エスケープ / `dangerouslySetInnerHTML` 不使用 ✅
- 認証情報は `SecretStr` ✅
