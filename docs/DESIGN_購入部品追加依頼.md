# 技術設計書(実装コントラクト)— 購入部品追加依頼 × DOVE連携

> ステータス: 実装直前コントラクト / 対象要件 `docs/REQUIREMENTS_購入部品追加依頼.md` v1.1
> 規約遵守: `CLAUDE.md` §2.1(削除/rename全面禁止)・§2.2(新規作成のみ)・§3(言語)・§6(ディレクトリ)・§8(完了の定義)
> 原則: **アップロードは新規作成のみ。copy/move/delete/overwrite/rename を一切しない。**
> 作成: 2026-07-27(実コード精査済)

## 0. 全体像

```
[新EXE: tools/kounyuu-agent/]  (設計部員PC / 五十嵐様PC・Tkinter+win32com)
   起動 → Windowsアカウント取得 → マスタExcel照合 → 役割で画面を切替
   │
   ├ 設計部員モード(往路)
   │   工番選択(DOVE master/search・未登録工番/工番未定OK)
   │     → 部品リストExcel選択 → 宛先/CC自動 → 本人Outlookで送信
   │     → POST /api/v1/purchase-requests (multipart・冪等)
   │
   └ 購買モード(五十嵐様・復路)
       GET /api/v1/purchase-requests?status=open (工番未定を先頭に固定)
         → 対象選択 → スキャンPDF選択 → 依頼元へ返信(CC自動)
         → POST /api/v1/purchase-requests/{id}/replies (multipart)
         → ステータス更新
   │
   ▼
[DOVE backend: 新 purchase_requests ルーター]
   Job get-or-create(origin=purchase) → 依頼INSERT → Excelアップロード
   → 回答PDFアップロード → ステータス遷移 → mail_logs/action_logs
   │
   ▼
[DOVE frontend: JobDetailPage]
   「購入部品依頼」タブ(既存「工番別指示書」と同形) → PurchaseRequestsView
   ※ 工番一覧・件数・検索には出さない(§3)
```

### 設計の核となる既存実態(実コードで確認済 / 2026-07-27)

- **アップロード基盤が既にある**: `api/v1/attachments.py` の `_save_uploaded_file()` が
  `open(path, "xb")` による**排他作成**(`_exclusive_write_bytes`)、**50MB上限**、
  **同名衝突時のタイムスタンプ+連番リトライ(最大5回→409)**、拡張子ホワイトリスト、
  `resolve_under()` による `/mnt/uploads` 配下強制を実装済み。**そのまま流用する**。
- **工番一覧と件数のフィルタが1箇所に集約**: `api/v1/jobs.py:178` の `_filtered(stmt, q, filt, today)` を
  `GET /jobs` と `GET /jobs/counts` の両方が使う。**ここ1箇所に条件を足せば表示除外が全経路で効く**(§3)。
- **`MailLog.job_id` は nullable**(`models/mail.py:45`)。**工番未定でも送信履歴を記録できる** → 流用可。
- **`ActionLog.job_id` も nullable**(`models/action.py:31`)、`write_action_log(job_id=None)` 可(`services/audit.py`)。
- **Job の get-or-create パターンが実績付きで存在**: `services/shutsuzu.py:85 _get_or_create_job()`。
  アーカイブ済み Job の自動復活、PK競合の savepoint 吸収まで実装済み。**同型で書く**。
- **LAN制限は自動適用**: `api/v1/__init__.py:27` で `/api/v1/*` 全体に `enforce_lan_only`。
  新ルーターを include するだけで追加配線不要。
- **alembic head は `0011_job_axis_archive`**。
- **EXE 側の資産**: `mailer.find_outlook_account(outlook, email)`(送信元アカウント解決)、
  `members.flag_kind()`(`○`/`CC`/`×` 判定)、`master.py`(枝番での品名・客先照合)、
  `kouban.to_job_id()`(親工番の接頭辞付与)。**すべて流用する**。

---

## 1. データモデル変更

### 1.1 新テーブル `purchase_requests`

`backend/app/models/purchase_request.py`(新規)。

| カラム | 型 | 制約 / 既定 | 備考 |
|---|---|---|---|
| `id` | Integer | PK, autoincrement | |
| `job_id` | String(32) | FK `jobs.id` ON DELETE SET NULL, **nullable** | **工番未定は NULL**(要件 D-06) |
| `job_no_input` | String(64) | nullable | ユーザーが選択/入力した工番文字列(原文) |
| `branch_no` | String(32) | nullable | 枝番(例 `25146-1`)。**付帯情報。構造化しない**(D-05) |
| `requester_account` | String(64) | NOT NULL | Windows アカウント |
| `requester_name` | String(64) | NOT NULL | マスタExcel 由来 |
| `requester_email` | String(256) | NOT NULL | マスタExcel 由来 |
| `requested_at` | DateTime(tz) | NOT NULL | |
| `request_file_path` | String(512) | NOT NULL | `/mnt/uploads` からの相対パス |
| `request_file_original_name` | String(256) | NOT NULL | 依頼者PC上の元ファイル名(表示用) |
| `request_file_size` | BigInteger | nullable | |
| `subject` | String(256) | nullable | 送信した件名 |
| `note` | Text | nullable | |
| `status` | String(16) | NOT NULL, server_default `'requested'` | §1.4 |
| `closed_at` | DateTime(tz) | nullable | |
| `client_request_id` | String(64) | **UNIQUE**, NOT NULL | **冪等キー**(EXE 生成 UUID) |
| `archived_at` | DateTime(tz) | nullable | 論理アーカイブ(§2.1) |
| `created_at` / `updated_at` | DateTime(tz) | server_default now() / onupdate | |

インデックス:
`ix_purchase_requests_job_id` / `ix_purchase_requests_status` /
`ix_purchase_requests_requester` / `ix_purchase_requests_archived_at` /
`uq_purchase_requests_client_request_id`(UNIQUE)

### 1.2 新テーブル `purchase_request_replies`

`backend/app/models/purchase_request.py`(同ファイル)。**1依頼に 0〜n 件**(T-06 推奨案)。

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| `id` | Integer | PK | |
| `request_id` | Integer | FK `purchase_requests.id` ON DELETE CASCADE, NOT NULL | |
| `pdf_path` | String(512) | NOT NULL | `/mnt/uploads` 相対 |
| `original_name` | String(256) | nullable | |
| `size` | BigInteger | nullable | |
| `replied_by_account` | String(64) | NOT NULL | Windows アカウント |
| `replied_by_name` | String(64) | nullable | |
| `replied_at` | DateTime(tz) | NOT NULL | |
| `note` | Text | nullable | |
| `client_reply_id` | String(64) | UNIQUE, NOT NULL | 冪等キー |
| `archived_at` | DateTime(tz) | nullable | |
| `created_at` | DateTime(tz) | server_default now() | |

インデックス: `ix_purchase_request_replies_request_id`、`uq_..._client_reply_id`。

### 1.3 `jobs` への列追加

| カラム | 型 | 既定 | 備考 |
|---|---|---|---|
| `origin` | String(16) | NOT NULL, server_default `'shutsuzu'` | `shutsuzu` / `purchase` / `manual` |

- **列の追加のみ。既存列の削除・型変更はしない**(§2.1)。
- 既存 22 行は server_default により `'shutsuzu'` で backfill される。
- インデックス `ix_jobs_origin`。

#### origin の昇格ルール(重要)

購入依頼だけで作られた Job(`origin='purchase'`)は工番一覧に出さない(§3)。
しかし**後からその工番が出図された場合は一覧に出す必要がある**。

→ `services/shutsuzu.py:_get_or_create_job()` に **昇格処理**を1行加える:
既存 Job が `origin='purchase'` だった場合、出図登録の時点で `'shutsuzu'` に更新する。
(既存 Job の他の項目は従来どおり上書きしない。)

> 既知のエッジ: `origin='purchase'` の工番は `GET /jobs/master/search?exclude_existing=true` の
> 候補からも外れるため、DOVE の「+新規工番」モーダルからは選べない。出図EXE 経由なら
> get-or-create で拾えるので実務上の支障はない。手動で表に出したい場合は §3.2 の
> 隠しフィルタ `filt=purchase` から工番詳細を開ける。

### 1.4 ステータス(`purchase_requests.status`)

| 値 | 意味 | 遷移契機 |
|---|---|---|
| `requested` | 依頼済 | 依頼登録時(既定) |
| `ordered` | 手配済 | 購買モードで手配完了を入力 |
| `answered` | 回答済 = **完了** | 回答PDFを登録して返信した時点。`closed_at` を設定 |

- **要件 T-04 未確定**: `ordered` を実運用で使うかは五十嵐様の運用次第。
  使わない場合は `requested` → `answered` の2段階で運用する(**DB 定義は変更不要**。
  値を使わないだけ。将来使い始めても migration 不要)。
- 「未対応」= `status IN ('requested','ordered') AND archived_at IS NULL`。

### 1.5 Alembic `0012_purchase_requests`

`backend/alembic/versions/0012_purchase_requests.py`。
`revision = "0012_purchase_requests"` / `down_revision = "0011_job_axis_archive"`。

- `upgrade()`: `create_table` ×2 + `add_column("jobs", "origin")` + index。
- **`downgrade()` は `pass`(no-op)**。`op.drop_table` / `op.drop_column` / `DROP` / `TRUNCATE` を
  一切書かない(§2.1)。
- `models/__init__.py` に新モデルを import 追加(autogenerate が DROP 差分を出さないため必須)。

> **デプロイ時の注意**: 本番反映時に `alembic upgrade head` の手動実行が必要
> (`0011` のときと同じ運用)。

---

## 2. API 契約

ルーター `backend/app/api/v1/purchase_requests.py`(新規)、
オーケストレーションは `backend/app/services/purchase_request.py`(新規)。
`api/v1/__init__.py` に prefix `/purchase-requests` で include(LAN制限は自動適用)。

### 2.0 共通のアップロード実装(先に決めること)

`_save_uploaded_file()` / `_exclusive_write_bytes()` / `_safe_filename()` / `_MAX_UPLOAD_BYTES` を
`attachments.py` から **`backend/app/services/uploads.py`(新規)へ移動**し、
`attachments.py` はそこから import する形に変更する。

- **純粋な移動(behavior-preserving)**。既存の添付テストが全て通ることを移動の合格条件とする。
- 目的: 新ルーターから private を跨いで import しないため。重複実装も作らない。

### 2.1 `POST /api/v1/purchase-requests` — 依頼登録(multipart・冪等)

**multipart/form-data**(メタ情報 + 部品リスト Excel を1リクエストで受ける)。

| フィールド | 必須 | 内容 |
|---|---|---|
| `client_request_id` | ○ | EXE 生成 UUID(冪等キー) |
| `job_no_input` | — | 選択した工番文字列(枝番込み原文)。工番未定なら空 |
| `job_id` | — | 親工番(`LW25146`)。工番未定なら空 |
| `branch_no` | — | 枝番(`25146-1`) |
| `title` / `customer` / `delivery_date` | — | Job 新規作成時のフォールバック(EXE が枝番照合で取得済みの値) |
| `requester_account` / `requester_name` / `requester_email` | ○ | マスタExcel 由来 |
| `subject` | — | 送信した件名 |
| `note` | — | 備考 |
| `mail_to` / `mail_cc` | — | JSON 配列文字列 `[{"name":"","email":""}]`(送信履歴用) |
| `file` | ○ | 部品リスト Excel(`.xlsx` / `.xlsm` / `.xls`) |

#### 冪等ロジック

| ステップ | 冪等キー | 実装 |
|---|---|---|
| 依頼 | `client_request_id` | 既存行があれば**ファイルを再保存せず**その行を返す(`created=false`) |
| Job | `job_id` | `_get_or_create_job` 同型。`job_id` 空なら **何も作らず NULL のまま** |
| ファイル | 依頼行に紐づく | 既存行にファイルが未保存なら、このとき保存して補完(§要件 5.1.3) |
| 送信履歴 | `(client_request_id)` | `mail_logs` に `method="purchase_agent"` で1件。job_id は nullable なのでそのまま |

保存先: `/mnt/uploads/purchase/{request_id}/`
→ **`request_id` 単位でディレクトリが分かれるため、`部品リスト.xlsx` の汎用名が何件来ても衝突しない。**

> 実装順の注意: 保存先パスに `request_id` を使うため、**先に依頼行を flush して id を確定**してから
> ファイルを保存し、`request_file_path` を更新する。ファイル保存が失敗したらトランザクション全体を
> ロールバックする(中途半端な行を残さない)。

#### Response(201 / 既存なら 200)

```jsonc
{
  "id": 12, "created": true,
  "job_id": "LW25146", "job_created": false, "job_unassigned": false,
  "branch_no": "25146-1",
  "status": "requested",
  "request_file_path": "purchase/12/部品リスト__20260727143000.xlsx",
  "request_file_original_name": "部品リスト.xlsx",
  "mail_log_id": 88,
  "warnings": []
}
```

エラー: 400(拡張子・書式・Traversal) / 413(50MB超) / 409(同名連続衝突) / 422(検証) / 500(全ロールバック)。

### 2.2 `GET /api/v1/purchase-requests` — 一覧

クエリ: `status`(`open` / `requested` / `ordered` / `answered` / `all`) /
`requester_account` / `job_id` / `unassigned_only` / `q` / `page` / `size`。

**並び順(要件 D-08)**:
```sql
ORDER BY (job_id IS NULL) DESC,   -- 工番未定を最上部に固定
         requested_at ASC          -- 以降は古い順
```

レスポンスの各行に `job_title` / `customer`(Job から join)、`reply_count` を含める。

### 2.3 `GET /{id}` / `PATCH /{id}`

`PATCH` で更新可能な項目:

| 項目 | 用途 |
|---|---|
| `job_id` | **工番の後付け紐づけ**(D-06。設計部員・五十嵐様の双方が実行可)。Job の get-or-create を伴う |
| `branch_no` | 枝番の補正 |
| `status` | 手動でのステータス変更 |
| `note` | 備考 |
| `archived_at` | 論理アーカイブ / 復活 |

**削除エンドポイントは作らない。** 非表示は `archived_at` のみ(§2.1)。

### 2.4 `POST /{id}/replies` — 回答登録(multipart・冪等)

| フィールド | 必須 | 内容 |
|---|---|---|
| `client_reply_id` | ○ | 冪等キー |
| `replied_by_account` / `replied_by_name` | ○ | |
| `note` | — | |
| `set_status` | — | 既定 `answered`(= 完了)。`ordered` も指定可 |
| `file` | ○ | スキャンPDF(magic bytes `%PDF-` を検証) |

保存先: `/mnt/uploads/purchase/{request_id}/replies/`。
`set_status='answered'` のとき `closed_at` を設定する。

### 2.5 配信エンドポイント

| パス | 内容 |
|---|---|
| `GET /api/v1/purchase-requests/{id}/file` | 部品リスト Excel。`resolve_under(upload_dir, rel)` → `FileResponse`(attachment) |
| `GET /api/v1/purchase-requests/{id}/replies/{reply_id}/file` | 回答PDF。`FileResponse`(inline) |

`archived_at IS NOT NULL` の行は **404**(既存のソフトデリート配信と同じ挙動)。

### 2.6 その他

| パス | 内容 |
|---|---|
| `GET /api/v1/jobs/{job_id}/purchase-requests` | 工番詳細タブ用(active のみ) |
| `GET /api/v1/purchase-requests/export` | Excel 出力(openpyxl で生成し `StreamingResponse`) |

**Excel 出力は読み取り専用の一方向**。生成した Excel を DOVE に取り込む経路は作らない(要件 D-10)。

---

## 3. 表示制御の実装(要件 §5.3.1 の担保)

**「表示しない」は放置すると漏れる。** 実装箇所を1点に絞り、テストで固定する。

### 3.1 除外は `_filtered()` の1箇所だけで行う

`api/v1/jobs.py:178 _filtered(stmt, q, filt, today)` は
`GET /jobs`(一覧)と `GET /jobs/counts`(件数)の**両方**が通る唯一の経路。
ここに次の1条件を加えれば、**一覧・件数・検索の3経路すべてに同時に効く**。

```python
# 購入依頼だけで発生した工番は既定の一覧/件数/検索に出さない (要件 D-07)。
# DB には記録されており、filt="purchase" で明示的に呼べば取得できる。
if filt == "purchase":
    stmt = stmt.where(Job.origin == "purchase")
else:
    stmt = stmt.where(Job.origin != "purchase")
```

### 3.2 隠しフィルタ `filt=purchase`

UI のフィルタタブには**出さない**が、API としては呼べるようにしておく
(調査・保守用の逃げ道。将来 UI に出す判断をしたときも実装追加が不要)。

### 3.3 除外の対象外(意図的に除外しないもの)

| 経路 | 挙動 | 理由 |
|---|---|---|
| `GET /jobs/{job_id}`(詳細) | **除外しない** | 購入依頼から工番詳細へ辿れる必要があるため |
| `GET /jobs/counts` の `archived` | 同じく除外する | 件数の整合を保つ |

### 3.4 リグレッションテスト(必須)

`backend/tests/test_purchase_request_visibility.py`(新規)で以下を固定する。

1. `origin='purchase'` の Job を作成 → `GET /jobs` の `items` に**含まれない**
2. 同 → `GET /jobs/counts` の `all` が**増えない**
3. 同 → `GET /jobs?q={その工番}` で**ヒットしない**
4. 同 → `GET /jobs/{job_id}` は **200 で取得できる**
5. その Job に出図登録すると `origin` が `shutsuzu` に昇格し、`GET /jobs` に**現れる**
6. 工番未定の依頼(`job_id IS NULL`)は `GET /purchase-requests` の**先頭に来る**

---

## 4. フロントエンド設計(最小)

### 4.1 「購入部品依頼」タブ

`frontend/src/routes/JobDetailPage.tsx`。既存の `ActiveTab` に `"purchase"` を追加し、
タブラベルに `購入部品依頼` を追加する。**工番別指示書と同じく Job 単位**(軸非依存)なので、
`axis &&` ブロックの外に置き、未出図 Job でも表示する。

### 4.2 `PurchaseRequestsView`(新規)

`frontend/src/components/views/PurchaseRequestsView.tsx`。
`KobanInstructionView.tsx` を雛形にする(Job 単位・一覧+閲覧のみ)。

- 一覧: 依頼日 / 依頼者 / 枝番 / ステータスバッジ / 回答件数
- 部品リスト Excel を開く → `GET /api/v1/purchase-requests/{id}/file`
- 回答PDF を開く → `GET /api/v1/purchase-requests/{id}/replies/{reply_id}/file`
- **登録・編集機能は置かない**(v1。EXE が主経路)
- デザイントークン: cyan `#06b6d4`、`--radius-md`、平面影(§7 準拠)

### 4.3 API クライアント

`frontend/src/api/purchaseRequests.ts`(新規)。`jobInstructions.ts` と同型
(`usePurchaseRequests(jobId)`)。`jobs.ts` / `attachments.ts` は**編集しない**。

---

## 5. EXE 設計 — `tools/kounyuu-agent/`(新規ディレクトリのみ)

**`tools/shutsuzu-agent/` は不可侵**(稼働中のため)。資産はコピーして流用する。

```
tools/kounyuu-agent/
  pyproject.toml            # tkinter(標準) + openpyxl + pywin32 + requests + pyinstaller
  config.example.toml
  run_app.py                # PyInstaller エントリ(パッケージ外ランチャー方式・必須)
  kounyuu_agent/
    __init__.py
    main.py                 # 設定/マスタ読込 → アカウント判定 → GUI 起動
    account.py              # Windowsアカウント取得 + マスタ照合 + 役割判定
    members.py              # マスタExcel 読込(役割/依頼CC/回答CC)
    gui_request.py          # 設計部員モード画面
    gui_purchase.py         # 購買モード画面(未対応一覧・工番未定を先頭固定)
    mailer.py               # 本人アカウント送信(find_outlook_account 流用)
    dove_client.py          # requests: master/search, purchase-requests CRUD
    kouban.py               # 親工番抽出/枝番キー(shutsuzu-agent からコピー)
    master.py               # 日程表Excel 照合(shutsuzu-agent からコピー)
  build.ps1
  README.md
```

### 5.1 起動シーケンス

1. `resource_base_dir()` で EXE 位置を解決 → `config.toml` 読込
2. **Windows アカウント取得**: `os.environ.get("USERNAME")` を第一候補、
   取得できなければ `win32api.GetUserName()` にフォールバック
3. マスタExcel(ファイルサーバ固定パス)を `read_only=True` で読み、アカウントで本人行を特定
4. **本人行が無ければダイアログで通知して終了**(誤送信を防ぐため起動させない)
5. 役割列が `購買` なら購買モード、`設計` なら設計部員モード

> **PyInstaller の落とし穴(既知)**: パッケージ内 `main.py` を直接エントリにすると
> 相対 import が壊れる。**必ず `run_app.py`(パッケージ外・絶対 import)をエントリにする**
> (`shutsuzu-agent` で発生済み・`be5b543` で修正)。

### 5.2 設計部員モード(`gui_request.py`)

- 工番選択: `GET /jobs/master/search?q=&only_active=false&exclude_existing=false` を叩き、
  インクリメンタル検索で候補表示。**「工番未定」を明示的に選べるチェックボックスを置く**
- 選択した工番文字列から `kouban.extract_master_key_from_filename` 相当で枝番キーを作り、
  `master.py` で品名・客先を解決 → 件名・本文に反映(§0 の ID体系ズレ対策)
- 親工番は `kouban.to_job_id()` で `LW` 接頭辞を付与して `job_id` に載せる
- 部品リスト Excel 選択 → **Outlook にはローカルパスのまま添付**
- 宛先/CC は マスタExcel の `役割=購買` + `依頼CC` 列から自動構成(手動追加も可)
- 送信元は `find_outlook_account(outlook, 本人のメール)` で解決
- 送信成功後に `POST /purchase-requests`(multipart)。`client_request_id` は送信前に1回だけ生成

### 5.3 購買モード(`gui_purchase.py`)

- 起動時に `GET /purchase-requests?status=open` を取得して一覧表示
  (**API 側で工番未定が先頭に来る**ので、EXE は並べ替えない)
- 工番未定の行は背景色を変えて視認性を上げる
- 選択行から: 部品リスト Excel を開く / 工番を後付けで紐づける(`PATCH`)/ 回答PDFを登録
- 回答: スキャンPDF選択 → 依頼元(`requester_email`)へ返信、CC は `回答CC` 列から自動
  → 送信成功後に `POST /{id}/replies`

### 5.4 失敗時の扱い(shutsuzu-agent と同方式)

- メール送信成功 → API 失敗 の場合、**メールを再送せずに登録だけ再試行**するボタンを出す
- `client_request_id` / `client_reply_id` は**送信前に確定**しておく
  (再試行しても依頼・ファイル・送信履歴が重複しない)

### 5.5 config 例

```toml
dove_base_url = "http://dove/api/v1"
master_xlsx_path = "\\\\lineworks-sv\\Data\\...\\購入部品依頼_送付先マスタ.xlsx"
master_nittei_path = "\\\\lineworks-sv\\Data\\総務部\\社内\\日程表\\日程表A.xlsx"
master_shin_ichiran_path = "\\\\lineworks-sv\\Data\\総務部\\社内\\日程表\\新一覧.xlsm"
request_timeout_sec = 30      # ファイルアップロードを伴うため出図EXE(15秒)より長く取る
```

---

## 6. ワークストリーム分担(相互非干渉)

共有契約 = 本設計書 + §2 の API スキーマ。

### WS-A backend
新規: `models/purchase_request.py` / `schemas/purchase_request.py` /
`services/purchase_request.py` / `services/uploads.py` / `api/v1/purchase_requests.py` /
`alembic/versions/0012_purchase_requests.py` / `tests/test_purchase_request.py` /
`tests/test_purchase_request_visibility.py`
編集: `api/v1/__init__.py`(include) / `models/__init__.py`(import) /
`api/v1/jobs.py`(`_filtered` に1条件 + `origin` 列) /
`api/v1/attachments.py`(アップロード関数の移動に伴う import 変更) /
`services/shutsuzu.py`(origin 昇格の1行)

### WS-B frontend
新規: `src/api/purchaseRequests.ts` / `src/components/views/PurchaseRequestsView.tsx`
編集: `src/routes/JobDetailPage.tsx` のみ

### WS-C EXE
`tools/kounyuu-agent/**` 一式のみ。**`tools/shutsuzu-agent/` と `outlook-agent/` は不可侵。**

WS-B / WS-C は WS-A の `schemas/purchase_request.py`(JSON契約)にのみ依存する。

---

## 7. リスクと検証観点

1. **メール送信と登録の非原子性** — 送信成功後に API を呼ぶ。失敗時は
   `client_request_id` による**冪等再送**で整合を回復する(メールは再送しない)。
2. **アップロード失敗で中途半端な行が残る** — ファイル保存はトランザクション内で行い、
   失敗時は依頼行ごとロールバックする。「行はあるがファイルが無い」状態を作らない。
3. **同名ファイルの取り違え** — `request_id` 単位のディレクトリ分離 + 排他作成で原理的に回避。
   表示は `original_name`、実体は衝突しないパスという二重管理にする。
4. **「表示しない」の漏れ** — 除外条件を `_filtered()` の1箇所に集約し、§3.4 のテストで固定する。
5. **工番未定依頼の埋没** — API 側の `ORDER BY (job_id IS NULL) DESC` で先頭固定。
   EXE 側の並べ替えに依存しない(EXE を直しても壊れないようにする)。
6. **origin 昇格漏れ** — 購入依頼で作った工番が後で出図されたのに一覧に出ない事故。
   §3.4 のテスト5で固定する。
7. **削除関数の混入禁止(§2.1)** — 新規ファイル・EXE に
   `rm/mv/unlink/rmtree/rename/DROP/TRUNCATE/op.drop` が無いことを grep 0件で確認。
   migration の `downgrade()` は `pass`。
8. **認証なし Write API** — LAN 限定のみで受ける(DOVE 既存の全 write と同方針)。
   `actor` は発信元 IP を `action_logs` に記録する。
9. **PII をログに残さない** — `action_logs.payload` にメール本文・宛先アドレスを入れない
   (宛先は `mail_log_recipients` にのみ保持する)。

### 完了の定義(CLAUDE.md §8)

- **backend**: `ruff check` / `ruff format --check` / `mypy`(services・api)エラー0、
  `pytest` パス(冪等再送で重複0 / Traversal 400 / 50MB超 413 / アーカイブ後 404 /
  §3.4 の可視性テスト6件)。
- **frontend**: `tsc --noEmit` / `eslint .` エラー0、
  工番詳細の「購入部品依頼」タブ → 一覧表示 → Excel/PDF が開けることを実ブラウザで確認。
- **EXE**: 実機で 設計部員モード送信 → API 201 → DOVE 工番詳細に反映、
  購買モードで一覧取得 → 回答PDF登録 → ステータス完了、再送で重複なし。
  工番未定の依頼が一覧の先頭に出ること。
- **全体**: 依頼者PC上の元ファイル、および `/mnt/fileserver` 配下に対して
  copy/delete/overwrite/rename が発生しないこと。
- **デプロイ**: 本番反映時に `alembic upgrade head` を手動実行すること(0011 と同じ)。
