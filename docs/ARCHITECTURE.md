# Project Management アーキテクチャ設計書

| 項目 | 内容 |
|---|---|
| ドキュメント版数 | **v1.0.4** |
| 作成日 | 2026-05-24 |
| ステータス | レビュー中 |
| 対応する要件定義書 | [REQUIREMENTS.md](./REQUIREMENTS.md) v1.0.4 |
| 関連 | [WIREFRAMES.md](./WIREFRAMES.md) v1.0.4 |
| 主要変更 (v0.2) | related_documents / related_document_versions / parts_orders / pdf_replacements の4テーブル追加 / 対応 API エンドポイントを追加 |
| 主要変更 (v0.3) | モバイル/タブレット対応 (閲覧専用): レスポンシブ Web + PWA化 |
| 主要変更 (v1.0.4) | **モック v3.0 整合**: (1) DDL の前方参照を Alembic 後付け FK に統一 / 循環FK を廃止 / soft delete 整合 / `contacts.email` UNIQUE 制約。(2) API のパス命名統一 (`{job_id}`)、`/health`・`/mail-logs/{id}/eml` 追加、`cmdk/search` 廃止。(3) **過剰設計の削除**: Service Worker / `@use-gesture/react` / `cmdk` / `react-dropzone`。(4) フロント構造刷新: タブ廃止 → モーダル化、`AxisProgressSubHeader.tsx` `AxisActionButtons.tsx` 新規。(5) バックアップ・ヘルスチェック・ログローテ追加。(6) §14 段階的開発計画を更新 |

---

## 1. システム全体構成

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Client (社内PC) — Chrome / Edge / Outlook (個人アカウント)                   │
│                                                                            │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐         │
│  │ ブラウザ                  │    │ 常駐 exe (任意配布)            │         │
│  │  - React アプリ           │    │  - localhost:NNNN で listen   │         │
│  │  - PDF Viewer (pdfjs)     │ ──▶│  - Outlook COM 経由で下書き作成│         │
│  │  - DXF Viewer (dxf-viewer)│    │  - System Tray アイコン       │         │
│  └──────────────┬───────────┘    └──────────────────────────────┘         │
│                 │ HTTP (社内LAN, HTTPS)                                     │
└─────────────────┼──────────────────────────────────────────────────────────┘
                  │
                  ▼  ※ Windows Firewall でLANサブネットのみ許可
┌────────────────────────────────────────────────────────────────────────────┐
│ Windows Server (lineworks-sv) 上の Docker Compose                           │
│                                                                            │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐                   │
│  │ web         │    │ api         │    │ db           │                   │
│  │ Nginx       │───▶│ FastAPI     │───▶│ PostgreSQL16 │                   │
│  │ React Build │    │ (uvicorn)   │    └──────────────┘                   │
│  │ allow/deny  │    │             │    ┌──────────────┐                   │
│  └─────────────┘    │             │───▶│ meili        │                   │
│                     │             │    │ Meilisearch  │                   │
│                     └──────┬──────┘    └──────────────┘                   │
│                            │                                              │
│                            ▼                                              │
│                ┌──────────────────────────────┐                          │
│                │ /mnt/fileserver (SMBマウント) │                          │
│                │   ├ master/                  │  ★ Excel ポーリング      │
│                │   │   ├ 新一覧.xlsm   ◀──┐   │                          │
│                │   │   └ 日程表A.xlsx ◀──┤   │                          │
│                │   ├ drawings/               │  ★ PDFパス参照            │
│                │   └ dxf/                    │  ★ DXFフォルダパス参照    │
│                └──────────────────────┼──────┘                          │
│                            ▲ CIFS/SMB │                                  │
│                            │ :ro      │                                  │
│       ┌────────────────────┴─────┐   │ ★ 工番マスタ                       │
│       │ MasterSync (APScheduler) │◀──┘ openpyxl で60秒間隔読込             │
│       │  - mtime チェック        │                                       │
│       │  - 2フェーズ UPSERT      │                                       │
│       └──────────────────────────┘                                       │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │ 社内ファイルサーバー            │
                │ \\lineworks-sv\Data\...       │
                │   ├ 総務部\社内\日程表\       │
                │   │   ├ 新一覧.xlsm           │
                │   │   └ 日程表A.xlsx          │
                │   ├ <設計>\drawings\          │ ← PDF実体
                │   └ <設計>\dxf\               │ ← DXF実体
                └─────────────────────────────┘
```

> 🔒 SMBマウントは **`:ro`** 厳守。アプリは Excel / PDF / DXF を **読むのみ**、書き換え・削除のコード経路を持たない。

---

## 2. 技術スタック詳細

### 2.1 バックエンド
| 領域 | 技術 | 補足 |
|---|---|---|
| 言語 | Python 3.12+ | |
| Web フレームワーク | FastAPI | OpenAPI 自動生成 |
| ASGI サーバー | uvicorn | workers 2-4 |
| ORM | SQLAlchemy 2.x (async) | |
| マイグレーション | Alembic | |
| バリデーション | Pydantic v2 | |
| Excel処理 | openpyxl + pandas | 新一覧.xlsm / 日程表A.xlsx 読込 |
| ハッシュ | hashlib (SHA-256) | A+B ハイブリッドパス紐付け |
| **メール (EML生成)** | Python 標準 `email.message.EmailMessage` | ★ MIME multipart生成 |
| **DXFメタ** | ezdxf (オプション、Python) | DXF内のTITLE等抽出に使う場合 |
| スケジューラ | APScheduler | Excel ポーリング + リンク切れ検証 |
| ロギング | loguru | |
| マスタ連携 (Excel) | openpyxl / pandas | ※Stock Management と同じ Excel を別 DB に保存 |

### 2.2 フロントエンド ⭐ v1.0.4 整理

| 領域 | 技術 | 補足 |
|---|---|---|
| 言語 | TypeScript 5.x | strict |
| フレームワーク | React 18+ | |
| ビルド | Vite | |
| スタイル | Tailwind CSS + 独自トークン (Cyan単色 `#06b6d4` ベース) | 詳細は WIREFRAMES.md §9 参照 |
| ルーティング | React Router v6+ | |
| サーバー状態 | TanStack Query | キャッシュは v1.0.4 ではメモリのみ (Service Worker なし) |
| クライアント状態 | Zustand | |
| フォーム | React Hook Form + Zod | |
| **PDFビューア** | `pdfjs-dist` | Marin 流の大きく見せる描画 + タッチ対応 |
| **DXFビューア** | `dxf-viewer` (本命候補) | three.js ベース、マウス + タッチで寸法計測 (距離のみ v1.0.4) |
| **仮想スクロール** ⭐ v1.0.4 | `@tanstack/react-virtual` | 一覧画面の工番リスト |
| ファイルツリー | react-arborist | A: ファイルブラウザ (PCのみ) |
| アイコン | lucide-react | |
| **PWA** | `vite-plugin-pwa` (manifest.json のみ) | ホーム画面追加対応。Service Worker は **v2 以降** |
| テスト | Vitest, RTL | |

#### v1.0.4 で削除したライブラリ (過剰設計の判断)
- **`@use-gesture/react`**: Pointer Events API + three.js OrbitControls で十分
- **`cmdk` (コマンドパレット)**: 4-10名規模では検索バーで十分
- **`react-dropzone`**: B案 (ハッシュ照合) は v2 以降
- **`Workbox` (Service Worker)**: 社内Wi-Fi 限定なのでオフラインキャッシュ不要

### 2.3 データストア
| 領域 | 技術 |
|---|---|
| RDBMS | PostgreSQL 16+ |
| 全文検索 | Meilisearch v1.x（日本語tokenizer内蔵）|
| ファイル実体 | 社内Windowsファイルサーバー（SMBマウント `:ro`）|

### 2.4 インフラ
| 領域 | 技術 |
|---|---|
| コンテナ | Docker Compose v2 |
| Dockerランタイム | Stock と同じ方式（WSL2 ベース Docker 想定） |
| デプロイ先 | Windows Server (`lineworks-sv`) |
| リバプロ | Nginx（web内）|
| TLS | 自己署名 or 社内CA |

### 2.5 常駐exe（任意配布、Outlook 連携用）
| 領域 | 技術 |
|---|---|
| 言語 | Python 3.12 (pyinstaller で .exe 化) |
| Outlook 操作 | pywin32 (COM経由) |
| HTTP listener | `aiohttp` or `fastapi` のミニ常駐 |
| 通知UI | `pystray` (System Tray) |
| 配布 | 管理画面からダウンロード（将来）/ 当面は zip 配布 |

---

## 3. データベース設計（v0.1）

### 3.1 DDL骨格 ⭐ v1.0.4 修正

> **v1.0.4 修正方針**:
> - 前方参照 (`mail_log_id` 等) は全て **Alembic マイグレーションで後付け FK** に統一
> - `related_documents.current_version_id` の **循環FK を廃止** → `SELECT MAX(version_no)` で導出
> - `axis_progress` は `axes` の soft delete に追従するため CASCADE 維持 (物理削除を soft delete と整合させる運用)
> - `contacts.email` に **UNIQUE 制約** を追加

```sql
-- 工番
CREATE TABLE jobs (
  id              BIGSERIAL PRIMARY KEY,
  parent_job_no   VARCHAR(50) NOT NULL,     -- 元工番（マスタとの結合キー）
  job_no          VARCHAR(50),              -- 工番（個別、parent_job_noと同じ場合も多い）
  display_label   VARCHAR(300),             -- 一覧表示用ラベル（製品名等のキャッシュ）
  starred         BOOLEAN NOT NULL DEFAULT FALSE,  -- ★ v1.0.4 お気に入り
  note            TEXT,
  deleted_at      TIMESTAMPTZ,              -- soft delete
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_jobs_parent ON jobs(parent_job_no);
CREATE INDEX idx_jobs_deleted ON jobs(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_starred ON jobs(starred) WHERE starred = TRUE;

-- 軸（1工番:N軸、軸名はジョブ内ユニーク）
CREATE TABLE axes (
  id                 BIGSERIAL PRIMARY KEY,
  job_id             BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name               VARCHAR(100) NOT NULL,    -- 軸名（自由入力、例: 全体図/昇降軸/...）
  display_order      INTEGER NOT NULL DEFAULT 0,
  pdf_path           TEXT,                     -- 出図PDFのフルパス（UNC or マウント先）
  pdf_path_hash      VARCHAR(64),              -- SHA-256（B案: ハッシュ照合）
  dxf_folder_path    TEXT,                     -- DXFフォルダのフルパス
  description        TEXT,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, name)
);
CREATE INDEX idx_axes_job ON axes(job_id);
CREATE INDEX idx_axes_pdf_hash ON axes(pdf_path_hash);

-- 軸×工程 進捗（10工程 × 軸数ぶんの行を持つ）
CREATE TABLE axis_progress (
  id            BIGSERIAL PRIMARY KEY,
  axis_id       BIGINT NOT NULL REFERENCES axes(id) ON DELETE CASCADE,
  step_code     VARCHAR(40) NOT NULL,       -- pre_check / design_release / ...
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','done')),
  owner         VARCHAR(100),               -- 担当者名（pre_check は必須、他は任意）
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (axis_id, step_code)
);
CREATE INDEX idx_axis_progress_axis ON axis_progress(axis_id);

-- 工程定義（マスタ、固定10件で初期化） ⭐ v1.0.4 short_label 追加
CREATE TABLE progress_steps (
  step_code      VARCHAR(40) PRIMARY KEY,
  label          VARCHAR(100) NOT NULL,            -- 例: '出図前チェック'
  short_label    VARCHAR(20) NOT NULL,             -- 例: '前検' (詳細画面・一覧の短縮表示用)
  display_order  INTEGER NOT NULL,
  requires_owner BOOLEAN NOT NULL DEFAULT FALSE    -- pre_check のみ true
);

-- 出図履歴（軸ごとに複数件、追記のみ） ※ mail_log_id FK は Alembic 後付け
CREATE TABLE release_logs (
  id             BIGSERIAL PRIMARY KEY,
  axis_id        BIGINT NOT NULL REFERENCES axes(id) ON DELETE CASCADE,
  pdf_path       TEXT NOT NULL,
  releaser_name  VARCHAR(100),
  comment        TEXT,
  mail_log_id    BIGINT,  -- 出図通知メールへのリンク (FK は後で Alembic で追加)
  released_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_release_logs_axis ON release_logs(axis_id);
CREATE INDEX idx_release_logs_released ON release_logs(released_at);

-- 関連資料 ★ v0.2 新規 / v1.0.4 修正 (current_version_id 廃止)
-- v1.0.4: 循環FK廃止のため current_version_id を削除、最新版は SELECT MAX(version_no) で導出
CREATE TABLE related_documents (
  id                  BIGSERIAL PRIMARY KEY,
  job_id              BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  group_code          VARCHAR(40) NOT NULL,    -- 'parts_list' / 'material' / 'instruction' / 'other'
  display_name        VARCHAR(200) NOT NULL,   -- 例: 「25214 部品リスト」
  description         TEXT,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_related_docs_job        ON related_documents(job_id);
CREATE INDEX idx_related_docs_group      ON related_documents(group_code);
CREATE INDEX idx_related_docs_deleted    ON related_documents(deleted_at) WHERE deleted_at IS NULL;

-- 関連資料のバージョン (1資料 N版、v1.0.4 では parts_list のみ複数バージョン)
CREATE TABLE related_document_versions (
  id                  BIGSERIAL PRIMARY KEY,
  related_doc_id      BIGINT NOT NULL REFERENCES related_documents(id) ON DELETE CASCADE,
  version_no          INTEGER NOT NULL,        -- 1, 2, 3, ...
  file_path           TEXT NOT NULL,
  file_path_hash      VARCHAR(64),
  note                TEXT,                    -- 例: 「ベアリング追加」
  added_by            VARCHAR(100),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (related_doc_id, version_no)
);
CREATE INDEX idx_rdv_doc       ON related_document_versions(related_doc_id);

-- アプリ側で最新版を取得するクエリ例:
--   SELECT v.* FROM related_document_versions v
--   WHERE v.related_doc_id = $1
--   ORDER BY v.version_no DESC LIMIT 1;

-- 部品手配 ★ v0.2 新規 / v1.0.4 では v1=単純送信、v2=3状態管理
-- ※ mail_log_id FK は Alembic 後付け
CREATE TABLE parts_orders (
  id                  BIGSERIAL PRIMARY KEY,
  job_id              BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  related_doc_id      BIGINT NOT NULL REFERENCES related_documents(id) ON DELETE CASCADE,
  related_doc_version_id BIGINT NOT NULL REFERENCES related_document_versions(id),
  status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','returned')),
  sent_at             TIMESTAMPTZ,
  sent_mail_log_id    BIGINT,  -- v1.0.4: FK は後で Alembic で追加 (前方参照解消)
  returned_at         TIMESTAMPTZ,    -- v2 で使用
  return_file_path    TEXT,           -- v2 で使用
  return_file_hash    VARCHAR(64),    -- v2 で使用
  return_note         TEXT,           -- v2 で使用
  created_by          VARCHAR(100),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_parts_orders_job     ON parts_orders(job_id);
CREATE INDEX idx_parts_orders_doc     ON parts_orders(related_doc_id);
CREATE INDEX idx_parts_orders_status  ON parts_orders(status);

-- PDF差し替え履歴 ★ v0.2 新規 (軸PDFを差し替えた履歴を時系列保持)
-- ※ mail_log_id FK は Alembic 後付け
CREATE TABLE pdf_replacements (
  id              BIGSERIAL PRIMARY KEY,
  axis_id         BIGINT NOT NULL REFERENCES axes(id) ON DELETE CASCADE,
  old_pdf_path    TEXT NOT NULL,        -- 差し替え前のパス (UIには現状表示しないが履歴として保持)
  new_pdf_path    TEXT NOT NULL,        -- 差し替え後のパス
  reason          TEXT,                 -- 差し替え理由コメント
  replaced_by     VARCHAR(100),
  mail_log_id     BIGINT,               -- 差し替え連絡メール (FK は後で Alembic で追加)
  replaced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pdf_repl_axis      ON pdf_replacements(axis_id);
CREATE INDEX idx_pdf_repl_replaced  ON pdf_replacements(replaced_at);

-- 工番マスタキャッシュ（Stock Management の job_master_cache と同等、独立保持）
-- v1.0.4: ttl_until を削除 (60秒間隔の全件UPSERT前提のため不要)
CREATE TABLE job_master_cache (
  parent_job_no  VARCHAR(50) PRIMARY KEY,
  customer_name  VARCHAR(300),
  product_name   VARCHAR(300),
  is_active      BOOLEAN NOT NULL DEFAULT FALSE,
  due_date       DATE,
  owner          VARCHAR(50),
  extra          JSONB,
  source_sheet   VARCHAR(50),
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_jmc_active   ON job_master_cache(is_active);
CREATE INDEX idx_jmc_customer ON job_master_cache(customer_name);

-- 連絡先マスタ ★ v1.0.4 email UNIQUE 追加
CREATE TABLE contacts (
  id             BIGSERIAL PRIMARY KEY,
  display_name   VARCHAR(200) NOT NULL,
  email          VARCHAR(300) NOT NULL UNIQUE,    -- ★ v1.0.4 重複登録防止
  company        VARCHAR(200),
  tags           TEXT[] NOT NULL DEFAULT '{}',  -- internal / supplier / customer / ...
  note           TEXT,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_contacts_tags ON contacts USING GIN(tags);

-- メールテンプレート
CREATE TABLE mail_templates (
  id                BIGSERIAL PRIMARY KEY,
  name              VARCHAR(200) NOT NULL,
  usage_tag         VARCHAR(40) NOT NULL,    -- release / redraw / delivery_answer / other
  subject_template  TEXT NOT NULL,
  body_template     TEXT NOT NULL,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_templates_usage ON mail_templates(usage_tag) WHERE deleted_at IS NULL;

-- メール送信ログ（下書き作成イベント、送信完了は検知不能）
CREATE TABLE mail_logs (
  id            BIGSERIAL PRIMARY KEY,
  sender_name   VARCHAR(100),
  to_addresses  TEXT[] NOT NULL,
  cc_addresses  TEXT[],
  bcc_addresses TEXT[],
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  usage_tag     VARCHAR(40),
  job_id        BIGINT REFERENCES jobs(id),
  axis_id       BIGINT REFERENCES axes(id),
  method        VARCHAR(20) NOT NULL,    -- eml / com
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mail_logs_job ON mail_logs(job_id);
CREATE INDEX idx_mail_logs_created ON mail_logs(created_at);

-- 進捗変更ログ（誰が・いつ・どの工程を変更したか）
CREATE TABLE progress_logs (
  id            BIGSERIAL PRIMARY KEY,
  axis_id       BIGINT NOT NULL REFERENCES axes(id) ON DELETE CASCADE,
  step_code     VARCHAR(40) NOT NULL,
  old_status    VARCHAR(20),
  new_status    VARCHAR(20) NOT NULL,
  owner         VARCHAR(100),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_progress_logs_axis ON progress_logs(axis_id);
CREATE INDEX idx_progress_logs_changed ON progress_logs(changed_at);

-- システム設定
CREATE TABLE settings (
  key    VARCHAR(100) PRIMARY KEY,
  value  JSONB NOT NULL
);
-- 例: watch_config, watch_state, ip_allowlist, mail_signature, etc.

-- ============================================================
-- 後付け FK (Alembic マイグレーションの 2ステップ目で追加)
-- ============================================================
ALTER TABLE release_logs
  ADD CONSTRAINT fk_release_logs_mail
  FOREIGN KEY (mail_log_id) REFERENCES mail_logs(id) ON DELETE SET NULL;

ALTER TABLE parts_orders
  ADD CONSTRAINT fk_parts_orders_mail
  FOREIGN KEY (sent_mail_log_id) REFERENCES mail_logs(id) ON DELETE SET NULL;

ALTER TABLE pdf_replacements
  ADD CONSTRAINT fk_pdf_replacements_mail
  FOREIGN KEY (mail_log_id) REFERENCES mail_logs(id) ON DELETE SET NULL;
```

### 3.2 初期データ投入 ⭐ v1.0.4 short_label 追加

```sql
INSERT INTO progress_steps (step_code, label, short_label, display_order, requires_owner) VALUES
  ('pre_check',         '出図前チェック', '前検', 1, TRUE),
  ('design_release',    '設計出図',       '設計', 2, FALSE),
  ('stock_check',       '在庫チェック',   '在庫', 3, FALSE),
  ('purchase',          '購入',           '購入', 4, FALSE),
  ('material',          '材料',           '材料', 5, FALSE),
  ('material_check',    '材料チェック',   'M検',  6, FALSE),
  ('factory_release',   '工場出図',       '工場', 7, FALSE),
  ('mizusumashi',       '水すまし',       '水す', 8, FALSE),
  ('bolt',              'ボルト',         'ボル', 9, FALSE),
  ('assembly_release',  '組立出図',       '組立', 10, FALSE);
```

### 3.3 マイグレーション戦略 ⭐ v1.0.4 更新

**2ステップ戦略**:
- **Step 1**: `mail_logs` を含む全テーブル作成 (`release_logs.mail_log_id` 等は FK なしの BIGINT)
- **Step 2**: 後付け FK を `ALTER TABLE` で追加

これにより前方参照問題を解消し、Alembic の依存順序が明確になる。
- 開発初期なので破壊的変更可

---

## 4. API設計 ⭐ v1.0.4 整理

### 4.1 設計方針
- REST + JSON
- OpenAPI 自動生成
- パスバージョニング: `/api/v1/...`
- **パスパラメータ命名統一**: 工番配下リソースは `{job_id}`、軸配下リソースは `{axis_id}`、それ以外は `{id}` (v1.0.4 で統一)
- **共通エラーレスポンス** (4xx/5xx):
  ```json
  { "detail": "Job not found", "error_code": "JOB_NOT_FOUND" }
  ```

### 4.2 主要エンドポイント

#### ヘルスチェック ⭐ v1.0.4 新規
```
GET    /api/v1/health                     DB + Meilisearch + SMB マウント疎通確認
                                          res: { status: "ok", db: "ok", meili: "ok", smb: "ok", version: "1.0.4" }
```

#### 工番
```
GET    /api/v1/jobs                       一覧 (ページング、検索、フィルタ、ソート、スター)
                                          query: ?filter=all|inprog|over|thisweek|starred&sort=due|pct|no&q=...
                                          - all       : 全件 (deleted_at IS NULL)
                                          - inprog    : 進行中 (deleted_at IS NULL AND has_axes AND progress_pct < 100) ←デフォルト
                                          - over      : 期限超過 (due_date < today)
                                          - thisweek  : 今週 (due_date BETWEEN today AND today + 7 days)
                                          - starred   : starred = true
GET    /api/v1/jobs/{job_id}              詳細 (軸・進捗・履歴・マスタJOIN込み)
POST   /api/v1/jobs                       工番マスタから選んで登録
PUT    /api/v1/jobs/{job_id}              更新 (starred 等)
DELETE /api/v1/jobs/{job_id}              削除 (soft delete)
POST   /api/v1/jobs/{job_id}/restore      復元 (Undoトースト)
GET    /api/v1/jobs/search                Meilisearch 経由検索 (q + フィルタ)
```

#### 軸
```
POST   /api/v1/jobs/{job_id}/axes         軸を追加 (名前指定)
PUT    /api/v1/axes/{axis_id}             軸の編集 (パス変更等)
DELETE /api/v1/axes/{axis_id}             軸削除 (soft delete)
POST   /api/v1/axes/{axis_id}/restore     復元
GET    /api/v1/axes/{axis_id}/dxf-files   DXFフォルダ内のファイル一覧
```

#### 出図
```
POST   /api/v1/axes/{axis_id}/release            軸を出図 (PDFパス + 通知の有無)
GET    /api/v1/axes/{axis_id}/release-logs       軸の出図履歴
GET    /api/v1/jobs/{job_id}/activity            工番全体の活動履歴 (出図・差し替え・進捗変更の統合タイムライン) ⭐ v1.0.4 新規
```

#### 進捗
```
PUT    /api/v1/axes/{axis_id}/progress/{step}    進捗ステータスを変更
GET    /api/v1/axes/{axis_id}/progress           軸の全工程進捗
GET    /api/v1/axes/{axis_id}/progress-logs      変更履歴
```

#### 工番マスタ
```
GET    /api/v1/master/jobs/{parent_job_no}  キャッシュから取得
GET    /api/v1/master/search?q=...          検索（工番ピッカー用）
POST   /api/v1/master/sync                  即時同期
GET    /api/v1/master/status                同期状態
```

#### 関連資料 ★ v0.2
```
GET    /api/v1/jobs/{job_id}/related-documents          一覧 (フラットリスト、各最新版情報込み)
POST   /api/v1/jobs/{job_id}/related-documents          新規追加 (グループ + display_name + v1パス)
GET    /api/v1/related-documents/{id}                   詳細 (全バージョン含む)
PUT    /api/v1/related-documents/{id}                   display_name / description 更新
DELETE /api/v1/related-documents/{id}                   削除 (soft delete)

POST   /api/v1/related-documents/{id}/versions          新バージョンを追加 (parts_list のみ多用)
                                                          req: { file_path, note }
GET    /api/v1/related-documents/{id}/versions          全バージョン取得
```

#### 部品手配 ★ v0.2 / v1.0.4 パス統一
v1.0.4 では「メールで手配」ボタンのみ。`parts_orders` レコードは送信時に作成、状態は `sent` 固定。

```
GET    /api/v1/jobs/{job_id}/parts-orders               一覧
POST   /api/v1/jobs/{job_id}/parts-orders               新規作成 (v1.0.4: state=sent で直接作成)
                                                          req: { related_doc_id, related_doc_version_id, mail_log_id }
GET    /api/v1/parts-orders/{id}                        詳細

★ v2 で追加予定:
POST   /api/v1/parts-orders/{id}/return                 返却を紐付け (state: sent → returned)
DELETE /api/v1/parts-orders/{id}                        取消し (soft delete)
```

#### 差し替え図面 ★ v0.2
```
GET    /api/v1/jobs/{job_id}/pdf-replacements           工番全体の差し替え履歴 (時系列)
GET    /api/v1/axes/{axis_id}/pdf-replacements          軸単位の差し替え履歴
POST   /api/v1/axes/{axis_id}/replace-pdf               PDF差し替え実行
                                                          req: multipart/form-data: file + reason + replaced_by + create_mail (bool)
                                                          動作: アップロード受領 → /mnt/uploads/YYYY-MM/ に保存
                                                                → 旧パスを履歴に記録 + axes.pdf_path 更新
                                                                → create_mail=true なら mail_log 作成し ID を返す
POST   /api/v1/pdf-replacements/{id}/link-mail          メールログを紐付け
                                                          req: { mail_log_id }
```

#### 連絡先
```
GET    /api/v1/contacts
POST   /api/v1/contacts
PUT    /api/v1/contacts/{id}
DELETE /api/v1/contacts/{id}
POST   /api/v1/contacts/import              CSVインポート
GET    /api/v1/contacts/export              CSVエクスポート
```

#### メールテンプレート
```
GET    /api/v1/mail-templates?usage_tag=release
POST   /api/v1/mail-templates
PUT    /api/v1/mail-templates/{id}
DELETE /api/v1/mail-templates/{id}
POST   /api/v1/mail-templates/{id}/render   テンプレに job_id, axis_id を渡して変数展開済みの件名/本文を返す
```

#### メール送信
```
POST   /api/v1/mails/draft                  下書き作成 (mail_log を記録、EML or COM は別エンドポイントで取得)
                                            req: { sender, to[], cc[], bcc[], subject, body, usage_tag, job_id?, axis_id? }
                                            res: 200: { mail_log_id, method_hint: "com" | "eml" }
                                                  method_hint は localhost:NNNN/health の事前 probe 結果から推定
GET    /api/v1/mail-logs/{id}/eml           ★ v1.0.4 新規: 指定 mail_log の EML バイナリを返す
                                            res: Content-Type: message/rfc822, X-Unsent: 1 ヘッダ
GET    /api/v1/mail-logs                    送信ログ一覧
GET    /api/v1/mail-logs/{id}               送信ログ詳細
```

#### ファイルブラウザ・PDF/DXF 配信
```
GET    /api/v1/fileserver/browse?path=...   サーバー上のディレクトリツリー取得 (A案ファイルブラウザ用)
GET    /api/v1/files/pdf?path=...           PDF を StreamingResponse で配信 (パストラバーサル防止)
GET    /api/v1/files/dxf?path=...           DXF を StreamingResponse で配信

★ v2 で追加予定:
POST   /api/v1/files/match-hash             D&D ハッシュ照合 (B案)
```

#### ⌘K コマンドパレット
**v1.0.4 で削除**。検索バー (`/api/v1/jobs/search`) で代替。

#### 設定
```
GET    /api/v1/settings/{key}
PUT    /api/v1/settings/{key}
```

### 4.3 ファイル配信
- パスは DB 登録済みもの or ファイルブラウザで列挙されたサーバー内パスのみ許可
- `StreamingResponse` で配信、PDF.js のレンジリクエスト対応
- **パストラバーサル防止**: `realpath` で `/mnt/fileserver` 配下チェック

### 4.4 PDFアップロード・パス紐付け（A+B ハイブリッド）

#### 案A: ファイルブラウザ
- `GET /api/v1/fileserver/browse?path=...` でサーバー内ディレクトリツリー返却
- UI 上でフォルダクリック展開、ファイル選択
- 選択したフルパス（マウント先 + UNC両方）を DB に保存

#### 案B: ハッシュ照合
- ユーザーが PDF を D&D
- フロント側で SHA-256 計算（小〜中容量）or サーバー側計算（大容量）
- `POST /api/v1/files/match-hash` で既存ファイル検索
- ヒットしたパスを紐付け

---

## 5. Excel ポーリング & マスタ同期

### 5.1 監視対象（v0.1）
| 対象 | 想定パス | 間隔 | フェーズ |
|---|---|---|---|
| 新一覧.xlsm | `/mnt/fileserver/総務部/社内/日程表/新一覧.xlsm` | 60秒 | Phase1（全件UPSERT） |
| 日程表A.xlsx | `/mnt/fileserver/総務部/社内/日程表/日程表A.xlsx` | 60秒 | Phase2（is_active反転） |

### 5.2 アルゴリズム

```python
def watch_tick(cfg):
    # 1. ロックファイル検出
    lock = Path(cfg["path"]).parent / f"~${Path(cfg['path']).name}"
    if lock.exists(): return

    # 2. mtime チェック
    mtime = os.stat(cfg["path"]).st_mtime
    state = settings_get(f"watch_state.{cfg['name']}")
    if mtime == state.get("last_mtime"): return

    # 3. 読込 + UPSERT
    cfg["importer"].run(cfg["path"])

    # 4. state 保存（失敗時は更新せず次回リトライ）
    settings_put(f"watch_state.{cfg['name']}", {
        "last_mtime": mtime,
        "synced_at": now(),
        "consecutive_failures": 0,
    })
```

`.xlsm` は `openpyxl.load_workbook(path, read_only=True, keep_vba=False, data_only=True)` で開く（Stock Management v0.3.3 と同じ方針）。

### 5.3 2フェーズ UPSERT

```
Phase 1 (新一覧):  全件 UPSERT → is_active=false でリセット
Phase 2 (日程表A): 含まれる工番に対して is_active=true + due_date / owner を上書き
```

### 5.4 Stock Management との関係
- **Stock も Project も同じ Excel を読む** → 二重読込
- 衝突なし（read-only、両者独立DB）
- 負荷影響: 8000行 × 60秒 / 1分 = 軽微（Stock 側ですでに同等の読込実績あり）

---

## 6. 検索エンジン同期戦略

### 6.1 Meilisearch インデックス
- インデックス: `jobs`, `contacts`
- `jobs`:
  - 検索可能: `parent_job_no, job_no, customer_name, product_name`
  - フィルタ: `is_active, has_axes`
  - ソート: `updated_at, due_date`
- `contacts`:
  - 検索可能: `display_name, email, company, tags`

### 6.2 同期
- DB → Meili 片方向
- CRUD 時即時、起動時 + 定期再構築でリカバリ
- 工番マスタ更新時もインデックス再構築

---

## 7. Outlook 連携アーキテクチャ

### 7.1 全体フロー

```
[ユーザー: 下書き作成ボタン押下]
     ↓
[ブラウザ]
     ├ 1. POST /api/v1/mails/draft  (サーバー側でログ保存)
     │   → mail_log_id 取得
     ├ 2. fetch http://localhost:NNNN/health (timeout 500ms)
     │   ┌──────────────────────────┐
     │   │ 200 OK = 常駐exeあり       │
     │   └──────────────────────────┘
     │   　↓
     │   3a. POST localhost:NNNN/draft  { mail_log_id }
     │       → 常駐exeが GET /api/v1/mail-logs/{id} でメール内容取得
     │       → Outlook COM で下書き作成
     │       → トレイ通知「下書きを作成しました」
     │
     │   ┌──────────────────────────┐
     │   │ Timeout / Error = 常駐なし │
     │   └──────────────────────────┘
     │   　↓
     │   3b. GET /api/v1/mail-logs/{id}/eml
     │       → サーバーが .eml バイナリを返す
     │       → ブラウザでファイルダウンロード
     │       → ユーザーがダブルクリック → Outlook 新規メール窓が開く
```

### 7.2 EML 生成（Python標準）

```python
from email.message import EmailMessage
from email.utils import formataddr

def build_eml(mail_log):
    msg = EmailMessage()
    msg["Subject"] = mail_log.subject
    msg["From"] = formataddr((mail_log.sender_name, ""))   # アドレスは空でOK、Outlookで自動補完
    msg["To"] = ", ".join(mail_log.to_addresses)
    if mail_log.cc_addresses:
        msg["Cc"] = ", ".join(mail_log.cc_addresses)
    msg.set_content(mail_log.body)
    # X-Unsent: 1 で「未送信下書き」扱いに
    msg["X-Unsent"] = "1"
    return msg.as_bytes(policy=email.policy.default)
```

### 7.3 常駐exe アーキテクチャ

```
[pyinstaller .exe]
     ├ ミニHTTP listener (aiohttp)
     │   - GET  /health          → 200 OK + バージョン
     │   - POST /draft           → { mail_log_id }
     ├ Outlook COM client (pywin32)
     │   - win32com.client.Dispatch("Outlook.Application")
     │   - CreateItem(0) で MailItem
     │   - .To / .Subject / .Body を設定
     │   - .Save() で下書き保存
     ├ サーバー逆方向: GET /api/v1/mail-logs/{id}
     │   → mail_log の内容取得
     └ Tray (pystray)
         - 状態表示 / バージョン / 終了
```

配布方式（v0.1）:
- 管理者が pyinstaller でビルドした単体exeを共有フォルダに配置
- 各ユーザーがダウンロード → ダブルクリックで起動（バックグラウンド常駐）
- Windowsスタートアップに追加すれば次回起動時自動

セキュリティ:
- listener は `127.0.0.1` のみ bind（外部からは到達不可）
- POST /draft はサーバー側API を信頼して mail_log_id だけ受け取り、内容自体は API から再取得

---

## 8. DXF Viewer アーキテクチャ

### 8.1 ライブラリ選定

| 候補 | 評価 | コメント |
|---|---|---|
| **dxf-viewer** | ◎ | three.js ベース、エンティティ広範対応、MIT |
| three-dxf | ◯ | three.js ベース、軽量 |
| dxf-parser + 自作 | △ | 全部自作になる |

v0.1 では **dxf-viewer を本命**、Phase 3 で動作検証を行う。

### 8.2 描画パイプライン

```
[サーバー: GET /api/v1/files/dxf?path=...]
    ↓ StreamingResponse (text/plain)
[ブラウザ: dxf-viewer.load(blob)]
    ↓ DXF パース + three.js シーン構築
[Canvas 描画]
    ↓
[ユーザー操作]
    ├ マウスホイール → カメラズーム
    ├ 左ドラッグ → カメラパン
    └ クリック (距離計測モード時)
         ↓
       [Raycaster で 3D 座標取得]
         ↓
       [DOM オーバーレイで mm 表示]
```

### 8.3 寸法計測の実装

```typescript
// 距離計測（2点クリック）
interface MeasureState {
  mode: 'idle' | 'distance' | 'angle';
  points: Vector3[];
}

function onCanvasClick(event: MouseEvent) {
  const intersection = raycaster.intersectModel();
  if (mode === 'distance') {
    points.push(intersection);
    if (points.length === 2) {
      const dist = points[0].distanceTo(points[1]);
      const mm = dist * unitScale;  // $INSUNITS から決定
      showOverlay(midpoint, `${mm.toFixed(2)} mm`);
      // ライン描画
      drawMeasurementLine(points[0], points[1]);
      points.length = 0;
    }
  }
  // 角度モードも同様、3点で middle 角度を計算
}
```

単位変換:
- DXF の `$INSUNITS` ヘッダ値（4=mm, 1=inch等）を読み取り
- 取得できなければ `mm` をデフォルト
- ユーザーが手動で単位上書き可

---

## 9. ファイル管理戦略

### 9.1 SMBマウント
Stock Management と同じ方式（WSL2 Docker + CIFS マウント想定）:

```yaml
# docker-compose.yml の volumes 例
volumes:
  - "/host/mnt/fileserver:/mnt/fileserver:ro"
```

### 9.2 リンク切れ検証
- APScheduler で `axes.pdf_path` / `axes.dxf_folder_path` を定期スキャン
- 不在なら設定値 `link_check_state` に記録
- 管理画面「ファイル監視」タブで一覧表示

### 9.3 ハッシュ照合（B案）
- サーバー側 SHA-256（大容量PDFはchunked計算）
- 同ハッシュ既存ファイル検索 → 0/1/N件のハンドリング

---

## 10. プロジェクトディレクトリ構造

```
Project-Management/
├── README.md
├── docker-compose.yml
├── .env.example
├── .gitignore
├── CLAUDE.md                  プロジェクト規約・開発ガイド
├── docs/
│   ├── REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── WIREFRAMES.md
│   └── mock/                  HTML/JSXモック (任意)
│
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/                config / db / meili
│   │   ├── api/v1/              jobs / axes / progress / contacts /
│   │   │                        mail_templates / mails / master /
│   │   │                        files / fileserver / settings / health
│   │   ├── models/              SQLAlchemy
│   │   ├── schemas/             Pydantic
│   │   ├── services/
│   │   │   ├── search.py        Meilisearch
│   │   │   ├── files.py         SMB / ハッシュ
│   │   │   ├── master_sync.py   ★ マスタ連携
│   │   │   ├── mail_eml.py      ★ EML 生成
│   │   │   ├── mail_render.py   ★ テンプレート変数展開
│   │   │   └── link_check.py
│   │   └── utils/
│   └── tests/
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       │   ├── Home.tsx          一覧
│       │   └── JobDetail.tsx     工番詳細（PDF + DXF）
│       ├── components/
│       │   ├── TopBar.tsx                ★ v1.0.4 54px 白基調、ナビ(工番/管理)+検索+[出図]+通知+アバター
│       │   ├── JobList.tsx               一覧+フィルタタブ+ソート
│       │   ├── JobRow.tsx                ★ v1.0.4 4px進捗バー+10ラベル+スター+納期警告色
│       │   ├── FilterTabs.tsx            ★ v1.0.4 すべて/進行中/期限超過/今週/スター
│       │   ├── PhaseProgressBar.tsx      ★ v1.0.4 4px細線+10tick+dot (一覧・サブヘッダー共用)
│       │   ├── PdfViewer.tsx             ★ pdfjs ラップ
│       │   ├── DxfViewer.tsx             ★ dxf-viewer ラップ + 距離計測 (角度は v2)
│       │   ├── DxfFileList.tsx           右ペイン専用 (DXFのみ)
│       │   ├── PaneToggle.tsx            ★ v1.0.4 chevron で右ペイン開閉
│       │   ├── AxisTabBar.tsx            ★ v1.0.4 軸タブ + アクションボタン群を統合
│       │   ├── AxisActionButtons.tsx     ★ v1.0.4 関連資料/差し替え図面/部品リスト ボタン
│       │   ├── AxisProgressSubHeader.tsx ★ v1.0.4 軸タブ直下の進捗サブヘッダー
│       │   ├── Breadcrumb.tsx            ★ v1.0.4 パンくず (工番 / 25214)
│       │   ├── RelatedDocsModal.tsx      ★ v1.0.4 関連資料モーダル (フラットリスト)
│       │   ├── PartsListModal.tsx        ★ v1.0.4 部品リストモーダル (バージョン管理)
│       │   ├── PdfReplaceModal.tsx       ★ PDF差し替えモーダル (PCアップロード)
│       │   ├── JobPickerModal.tsx        工番マスタからの選択
│       │   ├── AxisAddModal.tsx          軸追加
│       │   ├── ReleaseModal.tsx          出図モーダル
│       │   ├── MailComposeModal.tsx      メール作成 (関連資料パス自動添付対応)
│       │   ├── HistoryModal.tsx          ★ v1.0.4 出図+差し替えの統合履歴モーダル
│       │   ├── ConfirmDialog.tsx
│       │   ├── Toast.tsx
│       │   ├── NotificationBell.tsx      ★ v1.0.4 通知ベル (ドットバッジ)
│       │   ├── MobileBottomNav.tsx       ★ v1.0.4 モバイルボトムナビ (工番/検索/管理)
│       │   └── ui/
│       ├── api/
│       ├── stores/
│       └── styles/
│
└── outlook-agent/               ★ 常駐exe (任意配布)
    ├── pyproject.toml
    ├── outlook_agent/
    │   ├── __main__.py
    │   ├── server.py            aiohttp listener
    │   ├── outlook.py           pywin32 COM
    │   └── tray.py              pystray
    └── build.spec               pyinstaller
```

---

## 11. レスポンシブアーキテクチャ ⭐ v1.0.4 縮小 (Service Worker 削除)

### 11.1 全体方針

同一のWebアプリケーション (React + Vite ビルド成果物) を、**CSS メディアクエリのみのレスポンシブ** で PC / タブレット / スマホ から閲覧可能にする。

v1.0.4 では **Service Worker (オフラインキャッシュ) を削除** (社内Wi-Fi 限定環境では実用シーンが薄いため)。`manifest.json` (ホーム画面追加) のみ残す。

```
┌──────────────────────────────────────────────────┐
│ 同一ビルド成果物 (frontend/dist/)                  │
│   ├ index.html                                    │
│   ├ assets/  (*.js, *.css)                        │
│   ├ manifest.json   PWA マニフェスト                │
│   └ icons/          PWAアイコン (192/512px)         │
│   ※ Service Worker は v2 以降                      │
└──────────────────────────────────────────────────┘
```

### 11.2 レスポンシブ ブレークポイント

| 名前 | 幅 | 端末例 | レイアウト方針 |
|---|---|---|---|
| `sm` | `< 640px` | iPhone, Pixel | 1カラム、TopBar 縮小、ボトムナビ |
| `md` | `640px 〜 1024px` | iPad mini, iPad 縦 | 1カラム + DXFペイン下部配置 |
| `lg` | `1025px 〜` | iPad 横, PC | 2カラム (PDF左 / DXFペイン右、フル機能) |

Tailwind CSS の標準ブレークポイントに準拠。

### 11.3 manifest.json (例)

```json
{
  "name": "Project Management",
  "short_name": "PM",
  "description": "出図管理 + 進捗管理",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#06b6d4",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 11.4 タッチ対応 (DXF Viewer) ⭐ v1.0.4 軽量化

`@use-gesture/react` は使わず、**Pointer Events API + three.js OrbitControls** で実装。

#### Pointer Events
マウスとタッチを統一インターフェースで扱うため `pointerdown / pointermove / pointerup` を使用。

#### ジェスチャー対応 (標準 API のみ)

| ジェスチャー | 動作 | 実装 |
|---|---|---|
| 1本指ドラッグ / 左ドラッグ | パン | three.js OrbitControls (touch=pan モード) |
| ピンチイン/アウト / `Wheel` | ズーム | three.js OrbitControls (zoom) |
| シングルタップ / クリック | 計測モード時、点を追加 | Raycaster + pointerup |
| 2点タップで計測完了 | 距離計測 | 自前実装 (距離計算 + ラベル表示) |
| ダブルタップ | ズームリセット | controls.reset() |

#### モバイル時の計測UI

```
[ツールバー (タブレット/スマホ)]
  [距離] [クリア] [リセット]
   ↑ 大きめのタッチターゲット (最小44×44 px、Apple HIG)
   ※ 角度計測は v2 で追加

[計測オーバーレイ]
  測定点を大きめに描画 (10pxドット、タッチでも正確に表示)
  数値ラベルを上に大きく表示 (16px太字、白bg + cyan枠)
```

### 11.5 編集機能の無効化

モバイル/タブレット時、以下の操作はUIから隠す or 無効化:

```typescript
// 例: useIsTouchOnly フック (タブレット縦 + スマホ で true)
function useIsTouchOnly() {
  const [val, setVal] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    setVal(mq.matches);
    const fn = (e: MediaQueryListEvent) => setVal(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return val;
}

// 出図ボタン例
{!isTouchOnly && <Button onClick={openRelease}>出図</Button>}
{isTouchOnly && (
  <div className="text-subtle">
    出図登録はPCからお願いします
  </div>
)}
```

無効化対象:
- 出図ボタン
- 軸追加ボタン
- 進捗ステッパーのクリック (タップ無効)
- メール送信ボタン
- PDF差し替えボタン
- 関連資料の追加・削除
- 部品手配ボタン
- 管理画面アクセス

ただし **DXF Viewer の寸法計測タッチ** は閲覧の延長として有効。

### 11.6 モバイルでの動線

#### スマホ ボトムナビ

```
┌────────────────────────────────────────┐
│  画面コンテンツ                          │
│                                        │
├────────────────────────────────────────┤
│ [🏠 一覧] [🔍 検索] [📋 履歴] [⋯ メニュー] │ ← ボトムナビ (高さ 56px)
└────────────────────────────────────────┘
```

- 親指で届く範囲に主要アクション
- 各タブクリックでルート遷移

#### モバイル モーダルの扱い

- 縦持ち時、モーダルは **ボトムシート** スタイル (画面下から上にスライド)
- 横持ち時、PCと同じセンタード モーダル

### 11.7 デプロイ時の追加考慮

- nginx で manifest.json / sw.js に **適切な Content-Type** を設定
- Service Worker は **スコープ `/` で登録**
- HTTPS必須 (PWA要件、自己署名 or 社内CA)
- iOS Safari の制約 (PWA機能の一部制限) を考慮:
  - プッシュ通知はiOS 16.4+のみ → v3 では実装しない
  - Service Worker のキャッシュ容量 50MB 上限あり

---

## 12. セキュリティ考慮事項
| 項目 | 対策 |
|---|---|
| SQLインジェクション | SQLAlchemy パラメータバインド |
| XSS | React 自動エスケープ、`dangerouslySetInnerHTML` 不使用 |
| パストラバーサル | ファイル配信は `realpath` で `/mnt/fileserver` 配下チェック |
| **社内LAN限定** ⭐ | Windows Firewall + Docker bind 固定 + Nginx allow/deny の **三層防御** |
| **マスタExcel保護** ⭐ | SMBマウント `:ro`、`openpyxl.load_workbook(read_only=True)` 固定、削除系関数禁止 |
| **正規データの誤改変防止** | アプリは Excel / PDF / DXF を **書き換えない・削除しない** |
| CORS | 同一オリジン前提、外部オリジン拒否 |
| 機密 | DB 接続情報・テンプレ機密は環境変数 |
| HTTPS | 自己署名 or 社内CA、mitm対策 |
| 監査ログ | 進捗変更・出図履歴・メール送信を全件 timestamp 保持 |
| 常駐exe | localhost のみ bind、外部から到達不能 |

---

## 13. デプロイ構成（compose 骨格）

```yaml
# docker-compose.yml

services:
  web:
    build: ./frontend
    image: project-management/web:latest
    ports:
      - "192.168.X.Y:443:443"     # ★ LAN IP に固定 (0.0.0.0 にしない)
      - "192.168.X.Y:80:80"
    depends_on:
      - api

  api:
    build: ./backend
    image: project-management/api:latest
    environment:
      DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      MEILI_URL: http://meili:7700
      MEILI_KEY: ${MEILI_MASTER_KEY}
      FILESERVER_ROOT: /mnt/fileserver
      UPLOAD_DIR: /mnt/uploads
      FILESERVER_UNC_BASE: ${FILESERVER_UNC_BASE:-}
      MASTER_EXCEL_PATH_SHIN_ICHIRAN: /mnt/fileserver/総務部/社内/日程表/新一覧.xlsm
      MASTER_EXCEL_PATH_NITTEI_HYO_A: /mnt/fileserver/総務部/社内/日程表/日程表A.xlsx
      MASTER_SYNC_INTERVAL_SEC: 60
      CORS_ORIGINS: ${CORS_ORIGINS:-https://192.168.X.Y}
      LAN_ALLOW_CIDR: ${LAN_ALLOW_CIDR:-192.168.0.0/16}
    volumes:
      - "/host/mnt/fileserver:/mnt/fileserver:ro"             # ★ SMB 読み取り専用
      - "/host/mnt/uploads:/mnt/uploads:rw"                   # ★ v1.0.4 アップロード書込先 (PDF差し替え時のみ)
    depends_on:
      - db
      - meili
    env_file:
      - .env

  db:
    image: postgres:16
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backups:/backups   # ★ v1.0.4 バックアップ出力先
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  meili:
    image: getmeili/meilisearch:v1.9
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}
      MEILI_ENV: production
    volumes:
      - meili-data:/meili_data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7700/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ★ v1.0.4 PostgreSQL の日次バックアップ
  backup:
    image: postgres:16
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./backups:/backups
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD}
    entrypoint: |
      sh -c 'while true; do
        pg_dump -h db -U ${POSTGRES_USER} -d ${POSTGRES_DB} -Fc -f /backups/pm_$$(date +%Y%m%d_%H%M%S).dump;
        find /backups -name "pm_*.dump" -mtime +30 -delete;
        sleep 86400;
      done'
    restart: unless-stopped

volumes:
  pgdata:
  meili-data:
```

### 13.X バックアップ・リストア戦略 ⭐ v1.0.4 新規

- **日次自動バックアップ**: 上記 compose の `backup` サービスが毎日 `pg_dump -Fc` で `/backups/` に出力
- **保持期間**: 30日 (find で 30日前のファイルを削除)
- **Meilisearch**: 工番マスタは Excel から再構築可能なので、バックアップは不要 (`meili-data` ボリュームの定期スナップショットのみ)
- **手動リストア**:
  ```bash
  docker compose exec db pg_restore -U $POSTGRES_USER -d $POSTGRES_DB -c /backups/pm_20260524_030000.dump
  ```

Nginx config 抜粋:
```nginx
server {
  listen 443 ssl;
  ssl_certificate     /etc/nginx/certs/internal.crt;
  ssl_certificate_key /etc/nginx/certs/internal.key;

  # ★ LAN サブネットのみ許可
  allow 192.168.0.0/16;
  deny all;

  location /api/ { proxy_pass http://api:8000; }
  location /     { root /usr/share/nginx/html; try_files $uri /index.html; }
}
```

---

## 14. 段階的開発計画 ⭐ v1.0.4 更新

| Phase | 期間 | 内容 |
|---|---|---|
| **0** | 1週 | リポ初期化 / CI 雛形 / **デスクトップ Docker でビルド動作確認** / LAN制限の検証 |
| **1** | 2週 | DBスキーマ (v1.0.4 反映、Alembic 2ステップ) / Job/Axis CRUD API / 工番マスタExcel連携 / Meilisearch 同期 |
| **2** | 2週 | 一覧画面 (FilterTabs + ソート + スター + 4px進捗バー) / 詳細画面の基本構造 (パンくず + 軸タブ + 進捗サブヘッダー) / PaneToggle |
| **3** | 2週 | PDF Viewer (`pdfjs-dist`) / DXF Viewer + 距離計測 (`dxf-viewer` + Pointer Events) / 実DXF サンプル検証 |
| **4** | 1週 | 出図モーダル / 出図履歴モーダル / A案ファイルブラウザでパス紐付け |
| **5** | 2週 | メール送信 (テンプレ + 連絡先 + EML生成) / 関連資料モーダル / 部品リストモーダル / PDF差し替えモーダル / **常駐exe (任意)** |
| **6** | 1週 | 管理画面 (連絡先 / テンプレート / 工程 / ユーザー) / リンク切れ検証バッチ |
| **7** | 1週 | 自己署名HTTPS / Firewall設定 / バックアップ自動化 / 本番デプロイ (※ Windows Server 情報受領後) |
| **8** | 1週 | 受入テスト / フィードバック反映 / リリース |

合計 **13週（約3ヶ月）**。

### 14.X 開発体制と運用ルール ⭐ v1.0.4 新規

- **開発体制**: 実装エージェント (executor) と レビューエージェント (critic) のペア体制
- **クロスレビュー**: 最終的なコードは Claude Opus + (必要に応じて OpenAI Codex) でクロスレビュー
- **ビルド検証**: 当面は **デスクトップ Docker** でビルド・動作確認 (Windows Server の情報受領後、社内サーバーでも検証)
- **ネットワーク**: 現状 C1 LAN や日程表 (Niti-o) には接続できない → 開発初期はモックデータで進める。本番では SMB マウント経由

---

## 15. 残課題 ⭐ v1.0.4 更新

| # | 項目 | 解決時期 |
|---|---|---|
| A1 | Docker on Windows Server 方式の最終確定 (Stock 同期) | Phase 7 (サーバー情報受領後) |
| A2 | SMBマウントの volumes 定義詳細 | Phase 7 |
| A3 | DXF Viewer の動作検証 (実DXFサンプルで) | Phase 3 |
| A4 | 寸法計測の精度 (座標→mm、$INSUNITS) | Phase 3 |
| A5 | 常駐exe の最小構成・配布フロー | Phase 5 |
| A6 | 自己署名HTTPS の証明書配布フロー | Phase 7 |
| A7 | デスクトップ Docker でのモック起動・検証手順 | Phase 0 |
| M1 | 軸名サジェストのロジック (parts_list の Excel パターン頻度) | Phase 4 |
| U1 | 集約進捗バー の重み (軸ごとの加重平均 等) | Phase 2 |

### v2 以降の検討事項 (Phase 後)
- Service Worker (オフラインキャッシュ) — `vite-plugin-pwa` + Workbox
- `cmdk` コマンドパレット
- B案 (ハッシュ照合) によるパス紐付け
- DXF Viewer の角度計測機能
- 部品手配の 3状態ワークフロー (`parts_orders.status` を `sent` 以外も活用)
- 関連資料の全グループでバージョン管理 (現状は `parts_list` のみ)
- 通知パネル (ベルアイコンクリックで展開)
- 進捗ログ・送信ログの管理画面 UI
- Stock Management と Excel ポーリングの統合
- プッシュ通知 (iOS 16.4+)

---

## 16. 改訂履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | 2026-05-23 | 初版。工番×軸×10工程モデル / DDL骨格 / API設計 / Outlook ハイブリッド方式 / dxf-viewer 本命選定 / 社内LAN三層防御 / 13週開発計画 |
| v0.2 | 2026-05-23 | **DDL 4テーブル追加**: `related_documents` (関連資料グループ) / `related_document_versions` (バージョン管理) / `parts_orders` (3状態の手配ワークフロー) / `pdf_replacements` (差し替え履歴)。**API 14エンドポイント追加**: 関連資料CRUD・バージョン追加・部品手配開始/送信/返却・PDF差し替え実行。**フロントコンポーネント追加**: `RelatedDocsPanel` / `PartsOrderPanel` / `PdfReplaceHistoryPanel` / `PdfReplaceModal` |
| v0.3 | 2026-05-23 | **§11 PWA / レスポンシブアーキテクチャを新設**: vite-plugin-pwa + Workbox による Service Worker、manifest.json、レスポンシブブレークポイント (sm/md/lg)、タッチ対応 (`@use-gesture/react`)、編集機能のモバイル無効化ロジック、スマホ用ボトムナビ。Service Worker のキャッシュ戦略 (一覧 NetworkFirst+fallback / PDF/DXF NetworkOnly)。フロント技術スタックに PWA・タッチライブラリ追加 |
| **v1.0.4** | **2026-05-24** | **モック v3.0 整合化と過剰設計の整理**: (1) **DDL 修正**: 前方参照を Alembic 後付け FK に統一 (`mail_log_id` の REFERENCES を一旦削除し ALTER で追加)、`current_version_id` 循環FK を廃止 → MAX(version_no) クエリで導出、`contacts.email` UNIQUE、`job_master_cache.ttl_until` 削除、`jobs.starred` 追加、`progress_steps.short_label` 追加。(2) **API 整理**: パスパラメータを `{job_id}`/`{axis_id}`/`{id}` で統一、`/health` 追加、`/mail-logs/{id}/eml` 追加、`/cmdk/search` 削除、`/files/match-hash` を v2 行き、`/jobs/{job_id}/activity` 追加、共通エラー形式定義。(3) **過剰設計の削除**: Service Worker (Workbox)、`@use-gesture/react`、`cmdk`、`react-dropzone`。(4) **フロント構造刷新**: `RelatedDocsPanel/PdfReplaceHistoryPanel/PartsOrderPanel` をモーダル化 (`RelatedDocsModal/HistoryModal/PartsListModal`)、新規 `AxisProgressSubHeader/AxisActionButtons/FilterTabs/PhaseProgressBar/PaneToggle/Breadcrumb/NotificationBell/MobileBottomNav` 追加。(5) **§13 デプロイ拡張**: ヘルスチェック (db/meili)、日次バックアップ (pg_dump cron)、ログローテ (json-file)。(6) **§14 段階的開発計画更新**: デスクトップ Docker でのビルド検証、Phase 7 でサーバー情報受領後の本番デプロイ。(7) **§15 残課題に v2 移行項目を整理** |
