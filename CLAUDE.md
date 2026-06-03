# CLAUDE.md — Project Management 開発規約

このファイルは Claude Code が本リポジトリで作業する際の遵守事項です。

## 1. アプリの目的と性質

- 産業用機械メーカー向け **出図管理 + 軸別進捗管理 + メール送信ハブ**
- 利用人数: 4〜10名
- デプロイ: **Windows Server 上 Docker Compose、社内LAN限定**
- 認証: **なし** (Firewall + IP制限で社外遮断)
- 仕様書: `docs/REQUIREMENTS.md` v1.0.4 / `docs/ARCHITECTURE.md` v1.0.4 / `docs/WIREFRAMES.md` v1.0.4

## 2. セキュリティ・データ保護 (絶対遵守)

### 2.1 ファイル削除の全面禁止

以下の関数・操作は **コードベース全体で禁止**:

| 言語 | 禁止対象 |
|---|---|
| Python | `os.remove`, `os.unlink`, `os.rmdir`, `os.removedirs`, `shutil.rmtree`, `Path.unlink`, `Path.rmdir`, `Path.rename` |
| TypeScript/Node | `fs.unlink*`, `fs.rmdir*`, `fs.rm*`, `fs.rename*`, `fsPromises.unlink`, `fsPromises.rm` |
| Shell (Dockerfile/script) | `rm`, `rmdir`, `mv` (※`mv` は名前変更も含むため禁止) |
| SQL | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE` (※ migration 上の `op.drop_table` は許可しない方針。代わりに新規テーブル方式に倒す) |

**例外**: アップロード処理での `tempfile.NamedTemporaryFile` の自動削除 (`delete=True`) のみ許可。それ以外は **全て禁止**。

- pre-commit hook + ruff custom rule で機械的に強制する (Phase 0 で導入)。
- 違反は CI でビルド失敗扱い。

### 2.2 SMBマウントは「新規ファイル作成のみ」許可

旧仕様で `:ro` 厳守としていたが、**v2 要件で「編集後の新バージョンを元と同じフォルダに保存」が必要となったため緩和**:

- `/mnt/fileserver` は **`:rw`** マウントするが、アプリ側で以下を**コードレベルで厳守**:
  - **新規ファイル作成のみ許可** (`open(path, "xb")` 等で既存ファイルがあれば失敗させる)
  - **上書き禁止** (既存ファイルが見つかったら即エラー、絶対に書き換えない)
  - **削除禁止** (CLAUDE.md §2.1 の削除関数禁止と整合)
  - **rename 禁止** (`os.rename` / `Path.rename` / `mv` は §2.1 で全面禁止)
- 工番マスタ Excel (`新一覧.xlsm`, `日程表A.xlsx`) は **読むのみ**。openpyxl で `read_only=True` を必ず指定。
- バージョンアップ保存先のディレクトリは、元PDFと同じフォルダ。ファイル名は元から命名規約 (`rev_NN.pdf` / `v_NN.pdf` / `Rev.A` 等) を推定して自動採番。既存名と衝突したら 409 で失敗 (上書きしない)。
- Path Traversal は `Path.resolve()` で `/mnt/fileserver` 配下を `is_relative_to()` で必ず検証。
- アップロード書込先は **`/mnt/uploads` (`:rw`)** も併存。差替用一時保存・EML 保存・スキャン受領などに使う。

### 2.2.1 本番運用時の二重防御 (SMB ACL)

ファイルサーバ側でも、アプリ用アカウントに対して以下の Windows ACL を必ず設定する:
- 該当共有 (例: `Drawings\`) に対して **Modify / Delete / Rename 権限を剥奪**
- **Read / Write (Create file only)** 権限のみ付与
- これでアプリのバグ・侵入があってもファイルサーバ側で削除・上書きを防げる

### 2.3 機密情報の取り扱い

- `.env` は Git 管理外 (`.gitignore` に登録済み)
- DB パスワード、Meili マスターキー、SMTP 認証情報は **環境変数経由のみ**
- ログに認証情報・PII・メール本文を絶対に出力しない
- `print()` 禁止、`structlog` 経由のみ。Pydantic SecretStr を活用。

### 2.4 入力検証・SQLi/XSS 対策

- すべての API 入力は Pydantic v2 で検証
- SQL は SQLAlchemy ORM / `text()` + パラメータバインドのみ。文字列連結禁止
- React の `dangerouslySetInnerHTML` 使用禁止
- ファイルパスは API 経路で必ず `resolve()` し、許可ベースディレクトリ配下を `is_relative_to()` で確認

## 3. 言語・規約

### 3.1 Python (backend/)

- バージョン: 3.12 固定
- フォーマッタ: `ruff format`
- リンタ: `ruff check` (rule set: E, F, W, I, B, UP, S, A, C4, T20, PT, ASYNC)
- 型: `mypy --strict` を目標 (services / api 層)
- 非同期: SQLAlchemy 2.x async、FastAPI async、httpx
- 命名: snake_case (関数/変数)、PascalCase (クラス)、UPPER_SNAKE (定数)

### 3.2 TypeScript (frontend/)

- バージョン: 5.x
- フォーマッタ: `prettier`
- リンタ: `eslint` + `@typescript-eslint`
- 型: `strict: true`、`noUncheckedIndexedAccess: true`
- React: 関数コンポーネント + Hooks のみ、クラスコンポーネント禁止
- 状態管理: TanStack Query (server state) + Zustand (UI state) のみ

### 3.3 共通

- 行末スペース禁止、改行コード LF、UTF-8 BOM なし
- コメント: 日本語OK。WHY を書く。WHAT は書かない (識別子で表現)
- 1関数 50行以内目安、ネスト 4段以内

## 4. テスト

- backend: `pytest` + `pytest-asyncio`、coverage 70% 以上
- frontend: `vitest` (unit) + `playwright` (e2e、smoke のみ)
- DB は dockerized PostgreSQL を使い、モック化しない (= integration test 主体)

## 5. コミット

- メッセージは日本語可、prefix は `feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:`
- 1 commit = 1 目的、機械的整形と機能変更を混ぜない
- pre-commit が通らない状態でコミット禁止

## 6. ディレクトリ規約

```
backend/
  app/
    api/v1/      # FastAPI ルーター。1ファイル = 1リソース
    core/        # 設定、ロギング、DB セッション
    models/      # SQLAlchemy ORM (1ファイル = 1テーブル群)
    schemas/     # Pydantic v2 (request/response)
    services/    # ビジネスロジック (importers, search, mail, files)
    utils/       # 横断的ヘルパ
  alembic/
  tests/
frontend/
  src/
    routes/      # ページコンポーネント
    components/  # 再利用コンポーネント
    api/         # TanStack Query フック
    stores/      # Zustand
    styles/      # tokens.css, globals.css
    hooks/       # 共通フック
```

## 7. 設計トークン (フロント)

仕様書 `docs/WIREFRAMES.md` §9 と `docs/mock/styles.css` を **唯一の真実**とする。

- アクセントカラー: Cyan `#06b6d4` 単色
- グレースケール: ink/ink2/ink3/ink4 + hair の 5 階調
- 角丸: `--radius-pill: 999px`, `--radius-md: 8px`, `--radius-sm: 6px`
- 影: 平面寄り。`box-shadow` は最小限。

## 8. 完了の定義

タスク完了と宣言する前に、必ず以下を満たすこと:

1. `ruff check` / `ruff format --check` がエラー0
2. `mypy` がエラー0 (対象パッケージ)
3. `pytest` がパス
4. フロントは `tsc --noEmit` と `eslint .` がエラー0
5. 動作確認 (該当箇所): ブラウザで主要パスを実際にクリックして確認
6. 削除系関数を導入していないか grep で再確認
