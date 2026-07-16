# shutsuzu-agent — 出図のお知らせ × DOVE連携 メール送信エージェント（WS-C）

木場さんのPCで**都度起動**する Windows EXE。Outlook COM で「出図のお知らせ」メールを送信し、
**送信成功時のみ** DOVE バックエンドへ **パス参照のみ** で登録する。

> **TS工番の二重登録 (2026-07-16〜)**: TS工番で登録すると、DOVE に加えて
> **TSC出張図面管理 (TTD, `ttd_base_url`)** にも同じ内容が登録される。LW工番は従来どおり DOVE のみ。
> 片側だけ失敗した場合はダイアログが失敗した側を明示し、［再試行］は**失敗した側だけ**を再送する
> （成功済みの側へ再送しても冪等なので安全だが、そもそも再送しない）。
> 配布時は EXE と一緒に config.toml へ `ttd_base_url = "http://ttd/api/v1"` を追記すること。

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
5. 本文は画面上で**直接編集可**（『本文を再生成』で工番情報から作り直し）。送信/下書き時は
   編集後テキスト中の UNC 行を**自動でクリック可能リンク化**して Outlook に渡す。
6. 出図のお知らせは **3 つの操作**から選ぶ（いずれも `POST /shutsuzu/register`・冪等）:
   - **下書き作成 → DOVE登録**: Outlook 下書きを表示し、図面データを DOVE 登録。
     メール未送信のため**送信履歴 `mail_logs` は残さない**。
   - **DOVE登録のみ（メール送信なし）**: メールを一切作らず図面データだけ DOVE 登録。
   - **確認して送信 → DOVE登録**: 確認ダイアログ → メール送信 → DOVE登録。
     このときだけ `mail` ブロックを付け **`mail_logs`（送信履歴）を記録**する。
7. **テスト下書き作成（宛先を絞る・DOVE登録なし）**: 出図のお知らせ／工番別指示書の
   両画面に用意。押すと宛先ピッカーが開き、メンバーごとに `送らない / TO / CC` を選んで
   **宛先を絞って Outlook 下書き**を作る。**DOVE登録は一切しない**。初期値は送付先一覧の
   **「テスト送信」列**（`○`=TO / `CC` / `×`）。絞った宛先はステータス行に表示する。
8. 送信ログ（`送信ログ.csv`）は EXE 側にも追記（DOVE `mail_logs` と併存）。テスト下書きは
   動作 `テスト下書き` として記録。
9. ＋で軸を増やしても操作ボタンが隠れないよう、ヘッダー固定・中央縦スクロール・
   ボタン下部固定のレイアウト。

## セキュリティ規約（CLAUDE.md §2.1 / §2.2）

- ファイルの **copy / move / delete / overwrite / rename を一切行わない**。すべて **パス参照のみ**。
- Excel（送付先一覧）は読むだけ（`read_only=True`）。ヘッダは
  `ID / 名前 / メールアドレス / 工番別指示書 / LW工番 / TS工番 / テスト送信`。
  「テスト送信」列は任意で、無い旧フォーマットでも `×` 既定で読み込める。
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
