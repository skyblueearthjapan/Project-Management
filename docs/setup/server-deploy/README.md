# Project Management 本番デプロイ手順書 (社内 Windows Server)

社内 Windows Server に **Project Management (DOVE 出図管理)** をデプロイし、外出先の指定タブレットから Tailscale 経由で使えるようにするまでの手順。**初回フル構築**を想定。

> **現状: 待ち (2026-05-28)**
> 対象サーバは BIOS で Intel VT-x が無効のため Docker (Linux コンテナ) を起動できません。
> 在庫管理アプリと**同じサーバ・同じブロッカー**です。詳細と判断は
> `../../../../Stock Management/docs/setup/server-deploy/BIOS-blocker-decision.md` を参照。
> **BIOS の VT-x / VT-d を有効化した後、本書の手順をそのまま実行**してください。

---

## 0. 概要フロー

```
[管理者PC (社内LAN)] ──RDP──▶ [Windows Server]
                                  ├─ ① BIOS VT-x/VT-d 有効 (前提・別途)
                                  ├─ ② WSL2 有効化
                                  ├─ ③ Docker Desktop 導入 (WSL2 backend)
                                  ├─ ④ コード取得 (git clone / フォルダコピー)
                                  ├─ ⑤ .env 本番値設定
                                  ├─ ⑥ SMB マウント (新規作成のみ) + Windows ACL 二重防御
                                  ├─ ⑦ docker compose up -d --build
                                  ├─ ⑧ alembic upgrade head (初回)
                                  ├─ ⑨ Windows Firewall: 18080 を LAN + Tailscale のみ許可
                                  ├─ ⑩ 動作確認 (http://<サーバIP>:18080/)
                                  └─ ⑪ Tailscale 導入 → 指定タブレットから外出先アクセス
```

所要: BIOS 後 約1〜2時間 (Docker/WSL2 DL 含む) + Tailscale 30分程度。

---

## 1. 対象環境 (在庫管理と同居)

| 項目 | 値 | 備考 |
|---|---|---|
| サーバ | Windows Server 2019 Standard | 在庫管理アプリと同一サーバに同居 |
| サーバ IP | `192.168.1.240` (要確認) | RDP / ユーザー `administrator` (パスワードは管理者から別途) |
| 社内 LAN | `192.168.1.0/24` | |
| ファイルサーバ | `\\lineworks-sv\Data` | 工番マスタ Excel・図面の所在 |
| 公開ポート | **18080** (HTTP) | 在庫管理は 80 を使用 → **ポート衝突なし** |
| 認証 | **なし** | ネットワーク到達性 (LAN + Tailscale) で制御 |

> 在庫管理と Docker Desktop を共有します。Compose プロジェクト名が異なるためコンテナは別管理 (`project-management-*` / `stockmanagement-*`)。

---

## 2. 前提条件チェック (BIOS 有効化後に確認)

サーバの PowerShell (管理者) で:

```powershell
# 仮想化が有効か (3つとも True であること)
Get-ComputerInfo -Property HyperVRequirementVirtualizationFirmwareEnabled, `
  HyperVRequirementVMMonitorModeExtensions, `
  HyperVRequirementSecondLevelAddressTranslationExtensions
# False が残る場合は BIOS 設定が未反映 → 再度 BIOS で VT-x/VT-d を Enable
```

---

## 3. デプロイ手順

### ① RDP 接続
```cmd
mstsc /v:192.168.1.240
```
ユーザー `administrator` / パスワードは別途入手。

### ② WSL2 有効化
```powershell
wsl --install --no-distribution
shutdown /r /t 5
# 再起動後
wsl --set-default-version 2
wsl --update
```

### ③ Docker Desktop 導入
1. https://www.docker.com/products/docker-desktop/ → Windows (AMD64)
2. インストール時「**Use WSL 2 instead of Hyper-V**」を有効 (既定)
3. 再起動 → Docker Desktop 稼働確認
```powershell
docker --version
docker compose version
```
4. Settings → General → 「**Start Docker Desktop when you sign in**」を ON (サーバ再起動後の自動復帰用)

### ④ コード取得
配置先 `C:\pm-app\` を推奨 (パスが短い)。

```powershell
# git が使える場合
cd C:\
git clone <repo-url> pm-app
cd pm-app
```
> 本リポジトリは GitHub 未連携の場合あり。その時は開発機の `Documents\Project Management` フォルダ一式を
> RDP のドライブ共有 or ファイルサーバ経由で `C:\pm-app\` にコピーする (`node_modules` は不要、`frontend` は
> Docker ビルド内で `npm install` される)。

### ⑤ .env 本番値設定
```powershell
copy .env.example .env
notepad .env
```

| 項目 | 本番値 (例) | 備考 |
|---|---|---|
| `POSTGRES_PASSWORD` | 16桁以上のランダム | パスワードマネージャ管理 |
| `DATABASE_URL` | 上記 PW を反映 | `postgresql+asyncpg://pm:<PW>@db:5432/pm` |
| `FILESERVER_ROOT` | `/mnt/fileserver` | 変更不要 (コンテナ内パス) |
| `UPLOAD_DIR` | `/mnt/uploads` | 変更不要 |
| `MASTER_EXCEL_PATH_SHIN_ICHIRAN` | `/mnt/fileserver/<実パス>/新一覧.xlsm` | 実際のフォルダ階層に合わせる |
| `MASTER_EXCEL_PATH_NITTEI_HYO_A` | `/mnt/fileserver/<実パス>/日程表A.xlsx` | 同上 |
| `CORS_ORIGINS` | `http://192.168.1.240:18080` | 外出時の Tailscale 名でアクセスするなら追記 |
| `WEB_PORT` | `18080` | |
| `LAN_ALLOW_CIDR` | `192.168.0.0/16` | DEV_MODE=true の間は未使用 |
| `DEV_MODE` | `true` | **下記注記参照** |
| `LOG_LEVEL` | `info` | |

> **メール / Meilisearch の項目は不要** (アプリから全廃済み。`OUTLOOK_AGENT_*` / `MEILI_*` は設定しない)。
>
> **DEV_MODE について**: 本アプリは nginx(web) → api の内部プロキシ構成のため、`enforce_lan_only` が見る
> 送信元 IP は Docker 内部 IP になります。よって `DEV_MODE=false` にすると正規 LAN ユーザーまで 403 になり得ます。
> アクセス制御は **Windows Firewall (LAN + Tailscale のみ) + Tailscale 端末限定**で担保するため、**`DEV_MODE=true` のままを推奨**します。
> (将来どうしてもアプリ層 CIDR 制限を使うなら、uvicorn の proxy-headers 設定 + nginx の `X-Forwarded-For` 転送が別途必要)

### ⑥ SMB マウント (新規作成のみ) + Windows ACL
SMB は `:rw` でマウントするが「**新規作成のみ・上書き禁止・削除禁止**」をアプリ層 + ACL で二重に強制する
(CLAUDE.md §2.2 / §2.1)。詳細手順は `../../DEPLOY.md` の §2.1 を参照 (WSL2 fstab / `cmdkey` / NTFS ACL の
PowerShell スニペットあり)。要点:

```powershell
# Docker から SMB 共有へアクセスする認証情報をキャッシュ
cmdkey /add:lineworks-sv /user:<ドメイン\PM-APP> /pass:<パスワード>
```
- ファイルサーバ側で `PM-APP` に **Read + Create files/folders のみ許可、Delete/上書き/Rename は明示 Deny** (DEPLOY.md §2.1.2 のスニペット)。
- 工番マスタ Excel (`新一覧.xlsm` / `日程表A.xlsx`) は**読むだけ** (openpyxl `read_only=True`)。

Compose の bind 元パスを環境変数で指定:
```powershell
$env:FILESERVER_HOST_PATH = "//lineworks-sv/Data"        # Docker Desktop は //host/share 形式
$env:UPLOADS_HOST_PATH    = "D:\pm-data\uploads"          # 書込先 (事前に作成)
$env:BACKUPS_HOST_PATH    = "D:\pm-data\backups"          # DB バックアップ先
New-Item -ItemType Directory -Force D:\pm-data\uploads, D:\pm-data\backups | Out-Null
```

### ⑦ サービス起動
```powershell
cd C:\pm-app
docker compose up -d --build
docker compose ps
# db / api / web / backup の 4 サービスが Up (db, api は healthy) であること
```

### ⑧ 初回 DB マイグレーション
```powershell
docker compose exec api alembic upgrade head
docker compose exec api alembic current   # head であることを確認
```

### ⑨ Windows Firewall (18080 を LAN + Tailscale のみ許可)
```powershell
# 社内 LAN を許可
New-NetFirewallRule -DisplayName "PM Web 18080 LAN" `
  -Direction Inbound -Protocol TCP -LocalPort 18080 `
  -RemoteAddress 192.168.1.0/24 -Action Allow -Profile Domain,Private

# Tailscale (100.64.0.0/10) を許可 (外出タブレット用)
New-NetFirewallRule -DisplayName "PM Web 18080 Tailscale" `
  -Direction Inbound -Protocol TCP -LocalPort 18080 `
  -RemoteAddress 100.64.0.0/10 -Action Allow -Profile Domain,Private,Public

# 念のため WAN (インターネット) は明示ブロック
New-NetFirewallRule -DisplayName "PM Web 18080 deny WAN" `
  -Direction Inbound -Protocol TCP -LocalPort 18080 `
  -RemoteAddress Internet -Action Block
```
> **ルータのポート開放 (18080 の port forwarding) は行わない**。DMZ / UPnP 自動開放も無効に。
> これによりインターネットからサーバは到達不能 (= 外部筒抜けを原理的に防止)。

### ⑩ 動作確認
サーバ上:
```powershell
(Invoke-WebRequest http://localhost:18080/ -UseBasicParsing).StatusCode   # 200
(Invoke-WebRequest http://localhost:8000/health).Content                  # コンテナ内 health (api)
```
社内 LAN の別 PC: ブラウザで `http://192.168.1.240:18080/` → 工番一覧が表示されれば成功。

---

## 4. リモートアクセス (Tailscale) — 「社内は全員 / 外出は指定タブレットのみ」

方針: **社内はこれまで通り LAN で全員可。外出先は Tailscale に参加させた指定タブレットだけ**。公開ポートは作らない。
(アプリ改修は不要。アプリは `0.0.0.0:18080` で待ち受けるため Tailscale インターフェイスでも自動的に届く。)

### 手順
1. **サーバに Tailscale 導入**: https://tailscale.com/download/windows → インストール → `tailscale up` で自社 tailnet にサインイン。サーバに `100.x` アドレスが付く。
2. **管理コンソール設定** (https://login.tailscale.com/admin):
   - **Device approval (端末承認) を ON** — 承認した端末しか tailnet に入れない。
   - サーバの **Key expiry を無効化** (鍵失効でオフラインにならないように)。
   - **MagicDNS を ON** にすると `http://<サーバ名>:18080` で開けて楽。
3. **指定タブレットに Tailscale アプリ** を入れ、同じ tailnet にサインイン → 管理コンソールで**承認**。
4. **重要 — 端末限定の担保**: 社内 PC は Tailscale に入れない (LAN 利用) ため、**tailnet の中身は「サーバ + 指定タブレット」だけ**になり、それ以外の端末は到達不能。さらに固めるなら ACL で「タブレット → `サーバ:18080` のみ許可」を追加 (任意)。
5. **アクセス URL**:
   - 社内: `http://192.168.1.240:18080`
   - 外出タブレット: `http://<サーバの100.xアドレス>:18080` (または MagicDNS 名)

### 動作確認テスト
- 指定タブレットを 4G/5G (社外) にして上記 Tailscale URL → 開ける。
- 同じ回線で **Tailscale 未参加の別端末** から、サーバのグローバル IP / ドメインで `:18080` → **開けない (タイムアウト)**。
- 社内 LAN の業務 PC → 従来どおり開ける。

### 端末の追加・失効
- 追加: タブレットに Tailscale を入れ tailnet 参加 → 管理コンソールで承認 (+ 必要なら ACL のタブレット群に追加)。
- 失効 (紛失・退職): 管理コンソールでその端末を削除 → **即時遮断**。
- タブレットは画面ロック / 生体認証 / 可能なら MDM で保護 (本アプリは「端末 = 身分」のため端末管理が肝)。

---

## 5. 動作確認チェックリスト (現行機能)

- [ ] `docker compose ps` で db / api / web / backup が Up (db, api healthy)
- [ ] `http://localhost:18080/` がサーバ上で 200
- [ ] 社内 LAN 別 PC から `http://192.168.1.240:18080/` で工番一覧が開く
- [ ] `alembic current` が head
- [ ] 工番マスタ Excel の変更が約1分以内に反映 (scheduler)
- [ ] PDF ビューア / DXF ビューアが動く
- [ ] **PDF 差し替え**: ビューアの「差替」→ ローカル取込 or **登録済み差替図面から取込** → ページ差替 → `⬇ ダウンロード` で結合PDF取得 / 「サーバに保存」で新版作成
- [ ] 差し替え後の PDF を `D:\pm-data\uploads\replacements\...` に新規作成で保存できる (上書きされない)
- [ ] 関連資料 / 部品リスト / 済受領スキャンの登録ができる
- [ ] 管理画面タブが「工程 / ユーザー / 作業者」の3つ (メール・連絡先・テンプレは無し)
- [ ] 外出タブレット (Tailscale) からアクセスでき、未参加端末からは到達不能
- [ ] Windows Firewall: 18080 は LAN + Tailscale のみ許可、WAN ブロック

> メール / Meilisearch 関連の確認項目は**対象外** (アプリから全廃済み)。

---

## 6. 運用

### 自動起動
- Docker Desktop: 「Start Docker Desktop when you sign in」ON。
- Compose は `restart: unless-stopped` 設定済 → Docker 起動後に自動復帰。

### バックアップ
- `backup` サービスが PostgreSQL を `D:\pm-data\backups` に定期 dump。**サービス側は削除しない**ため、古い世代は運用ポリシーで手動管理。
- `uploads` は `D:\pm-data\uploads` を NAS 等へミラー (robocopy) 推奨。

### アップデート
```powershell
cd C:\pm-app
git pull            # or 新フォルダを再コピー
docker compose up -d --build
docker compose exec api alembic upgrade head   # 新規マイグレーションがある場合
```

### ログ
```powershell
docker compose logs --tail=100 api
docker compose logs --tail=100 web
```

---

## 7. ロールバック

```powershell
docker compose down                 # 停止 (DB ボリュームは残る)
git checkout <previous-tag>         # or 旧フォルダへ
docker compose up -d --build
```
> **Alembic の downgrade は原則使わない** (CLAUDE.md §2.1: テーブル DROP を含むため)。旧コンテナを上げ直す方式に倒す。

---

## 参考
- BIOS ブロッカーと判断: `Stock Management/docs/setup/server-deploy/BIOS-blocker-decision.md`
- 在庫管理デプロイ手順 (同サーバ・同形式): `Stock Management/docs/setup/server-deploy/README.md`
- SMB / ACL の詳細スニペット: 本リポジトリ `docs/DEPLOY.md` §2 (※同ファイルのメール/Meili/HTTPS 記述は旧仕様。サーバ手順は本書を正とする)
