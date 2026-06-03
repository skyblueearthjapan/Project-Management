# Project Management

産業用機械メーカー向け **出図管理 + 軸別進捗管理 + メール送信ハブ** アプリケーション。

## 構成

| 層 | 技術 |
|---|---|
| Backend | Python 3.12 / FastAPI / SQLAlchemy 2.x / Alembic / PostgreSQL 16 |
| Frontend | TypeScript / React 18 / Vite / Tailwind CSS |
| Search | Meilisearch v1.x (日本語tokenizer内蔵) |
| Mail | EML 生成 (Python email) + 任意の常駐exe (pywin32) |
| Infra | Docker Compose / Nginx |
| Deploy | Windows Server (社内LAN限定) |

## ディレクトリ

```
Project Management/
├── README.md              このファイル
├── CLAUDE.md              開発規約・コーディング規約
├── docker-compose.yml     v1.0.4 構成 (web / api / db / meili / backup)
├── .env.example           環境変数テンプレート
├── .gitignore
├── docs/                  仕様書 (REQUIREMENTS, ARCHITECTURE, WIREFRAMES, mock)
├── backend/               Python (FastAPI)
├── frontend/              TypeScript (React + Vite)
├── outlook-agent/         クライアントPC常駐 exe (Python + pywin32)
└── Sampleデータ/          ロゴ等
```

## 起動 (開発、デスクトップ Docker)

```bash
cp .env.example .env
docker compose up -d --build
```

| 画面 | URL |
|---|---|
| フロントエンド | http://localhost:5174 (dev) / http://localhost:18080 (build) |
| API ドキュメント | http://localhost:18080/api/v1/docs (本番経路) / http://localhost:8000/docs (dev 直叩き) |
| Meilisearch | http://localhost:7700/ |

> 8080 / 5173 は既に他プロセスが使用中のため、本リポジトリでは 18080 / 5174 を使用。

## 仕様書

- [要件定義書 v1.0.4](docs/REQUIREMENTS.md)
- [アーキテクチャ設計書 v1.0.4](docs/ARCHITECTURE.md)
- [ワイヤーフレーム v1.0.4](docs/WIREFRAMES.md)
- [モック (HTML プロトタイプ)](docs/mock/index.html)

## 段階的開発計画

| Phase | 期間 | 内容 |
|---|---|---|
| 0 | 1週 | リポ初期化、CI雛形、デスクトップ Docker 検証 |
| 1 | 2週 | DBスキーマ、Job/Axis CRUD、工番マスタ Excel 連携、Meilisearch 同期 |
| 2 | 2週 | 一覧画面、詳細画面 (軸タブ + 進捗サブヘッダー) |
| 3 | 2週 | PDF Viewer / DXF Viewer + 距離計測 |
| 4 | 1週 | 出図モーダル、出図履歴、ファイルブラウザ |
| 5 | 2週 | メール送信、関連資料/部品リスト/PDF差し替え、常駐exe |
| 6 | 1週 | 管理画面、リンク切れ検証 |
| 7 | 1週 | HTTPS、Firewall、バックアップ、本番デプロイ (※ Windows Server 情報受領後) |
| 8 | 1週 | 受入テスト、リリース |

合計 **13週** (約3ヶ月)。

## ライセンス

社内利用、非公開。
