# Outlook Agent

クライアントPC側で常駐し、HTTP 経由で受け取ったメール送信指示を **Outlook (Windows) COM** 経由で送信する小さな Python アプリ。

## 動作

- `127.0.0.1:34782` で待ち受け (LAN 公開しない)
- API は 1 つだけ: `POST /send` (JSON: subject/body/recipients[])
- pywin32 + Outlook COM 経由で **Outlook の既定送信者** からメールを送る

## なぜ常駐 exe か

- 「EML を保存 → ユーザがダブルクリック」だと、Mac の Outlook では未対応のことがあり UX が落ちる
- COM 直送は無音で送れる反面、Outlook を起動済みである必要がある
- v1.0.4 では **EML 保存 (常時) + COM 送信 (任意・このエージェント経由)** のハイブリッド

## 実装は Phase 5

ここはスケルトンのみ。実装時に下記を作成する想定:

```
outlook-agent/
├── pyproject.toml
├── agent/
│   ├── __init__.py
│   ├── main.py           # FastAPI app (localhost only)
│   └── outlook_com.py    # pywin32 COM wrapper
└── installer.iss         # Inno Setup スクリプト
```
