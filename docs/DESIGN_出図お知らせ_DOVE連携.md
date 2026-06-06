# 技術設計書(実装コントラクト)— 出図のお知らせ × DOVE連携

> ステータス: 実装直前コントラクト / 対象要件 `docs/REQUIREMENTS_出図お知らせ_DOVE連携.md` v1.0
> 規約遵守: `CLAUDE.md` §2.1(削除/rename全面禁止)・§2.2(新規作成のみ)・§3(言語)・§6(ディレクトリ)・§8(完了の定義)
> 原則: **すべてパス参照のみ。ファイルの copy/move/delete/overwrite/rename を一切しない。**
> 作成: Architect(実コード精査済) 2026-06-06

## 0. 全体像

```
[新EXE: tools/shutsuzu-agent/]  (木場PC・Tkinter+win32com)
   1. 軸構成入力 → プレビュー → 確認ダイアログ
   2. Outlook COM でメール送信 (本文にUNCリンク, 指示書PDF添付)
   3. 送信成功時のみ → POST http://dove/api/v1/shutsuzu/register (requests)
        ↓ パス参照(fileserver相対)・冪等・単一トランザクション
[DOVE backend: 新 shutsuzu ルーター + 既存granular再利用]
   Job upsert → Axis upsert(名称) → Version(出図PDF参照) → DXFフォルダ参照 → 工番別指示書(Job単位1件) → mail_logs/action_logs
        ↓
[DOVE frontend: JobDetailPage]
   「工番別指示書」フォルダボタン(最前) → KobanInstructionView (Job単位, 軸非依存)
```

設計の核となる既存実態(確認済):
- `Job` の PK は工番文字列、`title` は **NOT NULL**、`customer` は nullable(`models/job.py:23-25`)。`create_job` は既存衝突で **409、upsert ではない**(`jobs.py:444-448`)→ 合成エンドポイント側で get-or-create。
- `Axis` は `UniqueConstraint(job_id, name)`(`axis.py:31-33`)→ 名称キーで upsert 可能。
- `Version` は軸単位・`UniqueConstraint(axis_id, version_no)`・`pdf_path` は fileserver 相対(`version.py`, `axes.py:155-166`)。
- `DxfFile` は軸単位、`add_dxf_folder` が **file_path 一致でスキップ=冪等**(`dxf.py:499-594`)。
- 既存 attachment 3種(`RelatedDoc`/`PartsList`/`PdfReplacement`)は **全て軸単位**。**Job単位の概念は存在しない** → 新テーブル必須(T1)。
- `mail_logs`/`mail_log_recipients`/`action_logs` は流用可。
- LAN制限は `/api/v1/*` 全体に `enforce_lan_only` で自動適用(`api/v1/__init__.py:26`)。新ルーターを配下に include すれば追加配線不要。
- `/mnt/fileserver` は UNC `\\lineworks-sv\Data` に対応。

---

## 1. データモデル変更

### 1.1 新テーブル `job_instructions`(Job単位・工番別指示書)
`backend/app/models/job_instruction.py`(新規)。`RelatedDoc` を雛形にしつつ **`job_id` 直結**。

| カラム | 型 | 制約 / 既定 | 備考 |
|---|---|---|---|
| `id` | Integer | PK, autoincrement | |
| `job_id` | String(32) | FK `jobs.id` ON DELETE CASCADE, NOT NULL | Job単位 |
| `file_path` | String(512) | NOT NULL | **fileserver 相対パス**(posix, 先頭`/`なし) |
| `original_name` | String(256) | nullable | 表示名 |
| `size` | BigInteger | nullable | |
| `note` | Text | nullable | |
| `created_at` | DateTime(tz) | server_default now() | |
| `created_by` | String(64) | nullable | 例 "shutsuzu_agent" |
| `deleted_at` | DateTime(tz) | nullable | ソフトデリート(実体は触らない) |

インデックス: `ix_job_instructions_job_id`、`ix_job_instructions_deleted_at`。
- 「1件」は**DBユニーク制約で縛らず**、複数行許容+**`deleted_at IS NULL` の最新1件をビューで採用**(差し替え運用 + §2.1整合)。
- `job.py` は**編集しない**(独立クエリで取得、差分最小)。

### 1.2 Alembic `0010_job_instructions`
`backend/alembic/versions/0010_job_instructions.py`。`revision="0010_job_instructions"`, `down_revision="0009_attachment_soft_delete"`(現head)。`upgrade()` で create_table+index。**`downgrade()` は `pass`(no-op)**。`op.drop_table`/`DROP`/`TRUNCATE` を一切書かない。`models/__init__.py` に新モデル import 追加。

---

## 2. API契約

### 2.1 合成エンドポイント `POST /api/v1/shutsuzu/register`
- ルーター `backend/app/api/v1/shutsuzu.py`(新規)。`api/v1/__init__.py` に include(prefix `/shutsuzu`)。
- **認証なしで良い(T9確定)**: `api_router` の `enforce_lan_only` 配下で自動 LAN 限定。`actor` は発信元IP。
- オーケストレーションは `backend/app/services/shutsuzu.py`(新規)。**1リクエスト=1 DBトランザクション**(失敗は全ロールバック)。

#### Request JSON
```jsonc
{
  "job_id": "LW25146",                 // 必須, ^[A-Za-z0-9._-]{1,32}$
  "kubun": "LW",                       // 必須, "LW" | "TS"
  "title": "○○製品",                  // 任意: master欠落時のJob.title フォールバック
  "customer": "△△様",                // 任意: master欠落時フォールバック
  "delivery_date": "2026-07-01",       // 任意
  "released_by": "木場真佐子",          // 任意
  "axes": [
    { "name": "昇降軸",                // 必須 1..64
      "drawing_pdf_path": "設計/LW25146/昇降軸/LW25146-1.pdf", // 必須, fileserver相対(.pdf)
      "drawing_label": "初版",          // 任意
      "dxf_folder_path": "設計/LW25146/昇降軸/dxf" }           // 任意/null
  ],
  "instruction_pdf_path": "部署間共通/工番別指示書/LW25146.pdf", // 任意/null, fileserver相対(.pdf)
  "instruction_original_name": "LW25146.pdf",                  // 任意
  "mail": {                            // 任意(null可): 送信ログ記録用
    "subject": "【出図のお知らせ】工番LW25146", // 必須(mail指定時)
    "sent_at": "2026-06-06T10:00:00+09:00",     // 任意, 既定 now()
    "body": "",                                  // 既定空(PII回避)
    "to": [{"name":"山田","email":"y@example.co.jp"}],
    "cc": [{"name":"佐藤","email":"s@example.co.jp"}]
  }
}
```
- スキーマ `backend/app/schemas/shutsuzu.py`(Pydantic v2)。パスは `max_length=512` + `.pdf`末尾検証 + `\`→`/`正規化 + 先頭`/`除去。
- **パス制約**: fileserver相対で受け、登録時は正規化のみ(書込なし)。serve 時 `resolve_under(fileserver_root, rel)` で配下強制。`..`/絶対/ドライブ文字は400。**os.*/shutil.*/Path.rename 等を本ファイルに登場させない**(§2.1, grep確認)。

#### 冪等ロジック
| ステップ | 冪等キー | 実装 |
|---|---|---|
| Job | `job_id` | `db.get(Job, job_id)`。無ければ作成。`title` は master→request→`job_id`。**既存Jobは上書きしない**。 |
| Axis | `(job_id, name)` | name で SELECT、無ければ create_axis 相当(進捗10工程初期化込み)。Unique違反は捕捉再取得。 |
| Version | `(axis_id, pdf_path)` active一致 | あれば skip、無ければ `max(version_no)+1`。1軸=PDF1枚。 |
| DXF | `file_path` 一致 | `add_dxf_folder` 流用(冪等)。フォルダ未存在は **当該axisのみwarning、全体は継続**。 |
| 指示書 | `(job_id, file_path)` active一致 | あれば skip、無ければ INSERT。 |
| mail_logs | `(job_id, subject, sent_at)` | 既存なら skip。`method="agent"`,`status="sent"`、recipients展開。 |

各ステップ `write_action_log` 追記(action_type `shutsuzu.register` 等)。**メール本文/PIIをpayloadに入れない**。

#### Response(200)
```jsonc
{ "job_id":"LW25146","job_created":true,
  "axes":[{"name":"昇降軸","axis_id":42,"axis_created":true,"version_id":101,"version_created":true,"dxf_registered":12,"dxf_skipped":0,"dxf_warning":null}],
  "instruction_id":7,"instruction_created":true,"mail_log_id":55,"warnings":[] }
```
エラー: 422/400(書式・Traversal)/500(全ロールバック)。

### 2.2 工番別指示書 CRUD(同 shutsuzu.py)
- `GET /api/v1/shutsuzu/jobs/{job_id}/instructions` → active を created_at DESC 一覧。
- `POST /api/v1/shutsuzu/jobs/{job_id}/instructions` → パス参照1件登録(`{file_path, original_name?, note?}`)。
- `DELETE /api/v1/shutsuzu/jobs/{job_id}/instructions/{id}` → **ソフトデリート**(実体非削除)。

### 2.3 指示書PDF配信(新規・重要)
指示書は `部署間共通/工番別指示書/…` で **job_id をパスに含まない** → 既存 `/files/fileserver` の `_scoped_to_job` ガードで必ず400。よって **DB-id解決型**を新設(`serve_version_pdf` と同パターン):
- `GET /api/v1/files/job-instruction/{instruction_id}` → DB行の `file_path` を `resolve_under(fileserver_root, rel)` → `FileResponse(inline)`。`deleted_at` 行は404。
- 実装先 `backend/app/api/v1/files.py`(WS-A内)。

---

## 3. フロントエンド設計

### 3.1 「工番別指示書」フォルダボタン(最前)
`frontend/src/routes/JobDetailPage.tsx`(WS-B単独所有)。管理系タブ群の**先頭**に追加。既存3タブは `activeAxisId` 依存だが**工番別指示書はJob単位** → `ActiveTab` を `"instruction"` 拡張、ボタンは `axis &&` ブロックの外(上部パネル)に置き未出図でも表示。Modal に `activeTab==="instruction"` 分岐で `<KobanInstructionView jobId={job.id} />`(axisId渡さない)。トークン: cyan `#06b6d4`、角丸、平面影。

### 3.2 `KobanInstructionView`(新規)
`frontend/src/components/views/KobanInstructionView.tsx`。`RelatedDocsView.tsx` を雛形に **axisId 無し/Job単位**。`useJobInstructions(jobId)`、開くリンクは **新配信** `/api/v1/files/job-instruction/${id}`(`/files/fileserver` は使えない=§2.3)。🗑️はソフトデリート(実体保持の注意書き流用)。「+追加」は任意(初版はEXE登録が主経路で一覧+閲覧+ソフトデリートで足りる)。

### 3.3 APIクライアント(新規)
`frontend/src/api/jobInstructions.ts`。`attachments.ts` 同型: `useJobInstructions/useAddJobInstruction/useDeleteJobInstruction`。`./client` の `api()` 使用。`jobs.ts`/`attachments.ts` は**編集しない**(独立フェッチ)。

---

## 4. 新EXE設計(WS-C・新規ディレクトリのみ)

**`tools/shutsuzu-agent/`** を新設。**既存 `outlook-agent/` は別責務(loopback FastAPI+HMAC中継)につき不可侵**。参照EXE `shiji_zuzu_mail_app.py`(win32com直送)を踏襲。

```
tools/shutsuzu-agent/
  pyproject.toml            # tkinter(標準)+openpyxl+pywin32+requests+pyinstaller
  config.example.toml       # 接続先・UNCルート
  shutsuzu_agent/
    __init__.py
    main.py                 # エントリ
    gui.py                  # 軸動的追加UI(＋/命名/PDF/DXFフォルダ),プレビュー,確認
    members.py              # 送付先一覧.xlsx 読込+TO/CC振り分け(参照EXE:65-103流用)
    kouban.py               # ファイル名→親工番/LW・TS判定(参照EXE:159-178流用)
    mailer.py               # Outlook COM 送信(参照EXE:306-352流用)
    dove_client.py          # requests で /shutsuzu/register, master/search
    paths.py                # UNC ⇄ fileserver相対 変換(★契約点)
    build.ps1               # PyInstaller
  README.md
```
- **gui.py**: 役割選択(LW/TS)後、軸を動的に＋追加(軸名入力/出図PDF1枚/DXFフォルダ)。Job単位で[指示書PDF1件][宛先][本文プレビュー]。プレビュー→ConfirmDialog→送信→DOVE登録。
- **mailer/members**: 参照EXEほぼ移植。送信元固定 木場 `m-kiba@lineworks.co.jp`。指示書=添付、出図PDF=本文UNCリンク。
- **kouban.py**: 親工番抽出+LW/TS判定。**軸名はユーザー入力**。
- **dove_client.py**: 納入先/品名 = `GET /jobs/master/search?q={job_id}&exclude_existing=false`(既定trueだと取込済が返らないため明示)。登録 = `POST /shutsuzu/register`。接続先 config 既定 `http://dove`。
- **paths.py(★)**: EXE選択は Windows UNC。本文リンクはUNC、**API送信は fileserver相対posix**。変換 = config `fileserver_unc_root`(既定 `\\lineworks-sv\Data`)前置除去→`\`→`/`→先頭`/`除去。プレフィックス不一致は登録前にエラー中断。
- 送信ログCSV(参照EXE:355-377)維持 + DOVE mail_logs 併存。

config例:
```toml
dove_base_url = "http://dove/api/v1"
fileserver_unc_root = "\\\\lineworks-sv\\Data"
member_xlsx = "送付先一覧.xlsx"
request_timeout_sec = 15
```

---

## 5. 3ワークストリーム ファイル分担表(相互非干渉)
共有契約 = 本設計書 + §2 APIスキーマ。**3WSは編集ファイルが一切重複しない。**

### WS-A backend
新規: `models/job_instruction.py` / `schemas/shutsuzu.py` / `services/shutsuzu.py` / `api/v1/shutsuzu.py` / `alembic/versions/0010_job_instructions.py` / `tests/test_shutsuzu_register.py` / `tests/test_job_instructions.py`
編集(全backend): `api/v1/__init__.py`(include) / `models/__init__.py`(import) / `api/v1/files.py`(配信追加)

### WS-B frontend
新規: `src/api/jobInstructions.ts` / `src/components/views/KobanInstructionView.tsx`
編集: `src/routes/JobDetailPage.tsx` のみ(`jobs.ts`/`attachments.ts` は触らない)

### WS-C EXE
`tools/shutsuzu-agent/**` 一式のみ。**`outlook-agent/` 不可侵。**

同期点: WS-B/C は WS-A の `schemas/shutsuzu.py`(JSON契約)にのみ依存。契約固定済のため3WS並行着手可。

---

## 6. リスクと検証観点
1. **メールとDOVE登録の非原子性**: 送信成功後に登録。登録失敗時メールは取消不可 → **冪等再送**で整合回復。EXEは失敗明示+再試行。
2. **master照会フォールバック**: 工番がmasterに無ければ Job.title を request→job_id で埋める。送信/登録継続可。
3. **DXFフォルダ未存在**: 当該axisのdxfのみ warning 化、全体継続。
4. **パス相対化取り違え**: UNCルート不一致は EXE 登録前中断 + backend `resolve_under` 配下強制で二重防御。
5. **認証なしWrite API**: LAN限定のみで受ける(既存DOVE全writeと同方針)。actor=IPを action_logs に記録。
6. **削除関数混入禁止(§2.1)**: 新規ファイル+EXEに `rm/mv/unlink/rmtree/rename/DROP/TRUNCATE/op.drop` を grep 0件確認。migration downgrade は `pass`。

### 完了の定義(§8)
- backend: ruff/ruff format/mypy(services・api strict)0、pytest(冪等再送で重複0/Traversal400/ソフトデリート後404)パス。
- frontend: tsc/eslint 0、工番別指示書ボタン→Modal→PDF表示を実ブラウザ確認(未出図Jobでも表示)。
- EXE: 実機で プレビュー→送信→register200→DOVE詳細にJob/軸/出図PDF/DXF/指示書反映、再送で重複なし。
- 全体: `/mnt/fileserver` の copy/delete/overwrite/rename が発生しない。
