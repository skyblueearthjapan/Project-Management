# shutsuzu-agent — 出図のお知らせ × DOVE連携 メール送信エージェント（WS-C）

木場さんのPCで**都度起動**する Windows EXE。Outlook COM で「出図のお知らせ」メールを送信し、
**送信成功時のみ** DOVE バックエンドへ **パス参照のみ** で登録する。

> 設計コントラクト: `../../docs/DESIGN_出図お知らせ_DOVE連携.md` §4（新EXE）・§5（WS-C）
> 要件: `../../docs/REQUIREMENTS_出図お知らせ_DOVE連携.md`

## 何をするか

1. **役割選択**
   - 出図のお知らせ（LW工番 / TS工番）→ メール送信 + DOVE連携
   - 工番別指示書（毎週末報告分）→ メール送信のみ（現行維持・DOVE連携なし）
2. **軸の構成（出図のお知らせ）**: 「＋ 軸を追加」で軸を動的に増やし、各軸に
   - 軸名（手入力）
   - 出図図面PDF 1枚（本文に UNC リンク／添付しない）
   - DXFフォルダ（任意・DOVE紐付け／添付しない）
3. **工番別指示書PDF**: 工番に1つ（メール**添付**）。
4. 親工番は出図PDFのファイル名から自動抽出（例 `LW25146-1…` → `LW25146`）。
   納入先・製品名は DOVE `GET /jobs/master/search` から取得して本文に反映。
5. プレビュー → 確認ダイアログ → **メール送信** → 成功時に **DOVE登録**
   （`POST /shutsuzu/register`、冪等）。
6. 送信ログ（`送信ログ.csv`）は EXE 側にも追記（DOVE `mail_logs` と併存）。

## セキュリティ規約（CLAUDE.md §2.1 / §2.2）

- ファイルの **copy / move / delete / overwrite / rename を一切行わない**。すべて **パス参照のみ**。
- Excel（送付先一覧）は読むだけ（`read_only=True`）。
- DOVE へ送るパスは **fileserver 相対 posix**。UNC ルート不一致は **送信前に中断**する
  （`paths.to_fileserver_relative` が `ValueError`）。

## 構成

```
shutsuzu_agent/
  main.py          # 設定/送付先読込 → GUI 起動
  gui.py           # 役割選択・軸の動的UI・プレビュー・送信・登録
  members.py       # 送付先一覧.xlsx 読込 + TO/CC 振り分け
  kouban.py        # ファイル名 → 親工番抽出 / LW・TS 判定
  mailer.py        # 本文生成 + Outlook COM 送信 + 送信ログCSV
  dove_client.py   # DOVE API（master/search・register）
  paths.py         # UNC ⇄ fileserver相対 変換（★契約点）
config.example.toml
build.ps1
pyproject.toml
```

## セットアップ（開発）

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev,build]"

# 起動
python -m shutsuzu_agent.main
```

`config.example.toml` を `config.toml` にコピーし、`dove_base_url` /
`fileserver_unc_root` を環境に合わせて設定する。`送付先一覧.xlsx` を同フォルダへ。

## 設定 (`config.toml`)

| キー | 既定 | 説明 |
|---|---|---|
| `dove_base_url` | `http://dove/api/v1` | DOVE API ベースURL（社内LAN） |
| `fileserver_unc_root` | `\\lineworks-sv\Data` | UNC ルート（相対化の基準） |
| `member_xlsx` | `送付先一覧.xlsx` | 送付先一覧の Excel ファイル名 |
| `request_timeout_sec` | `15` | DOVE API タイムアウト秒 |

## ビルド

```powershell
.\build.ps1
# dist\出図お知らせDOVE.exe を生成
```

配布フォルダに `出図お知らせDOVE.exe` / `config.toml` / `送付先一覧.xlsx` を同居させる。

## 冪等・再送について

メール送信は成功したが DOVE 登録が失敗した場合、**同じ内容で「確認して送信」を再実行**すると
登録だけが冪等に補完される（Job/軸/出図PDF/DXF/指示書/mail_logs は重複しない）。
