# 本番デプロイガイド (Windows Server + Docker Desktop / WSL2)

対象: 社内LAN限定の Windows Server (1台構成、利用人数 4〜10名)。

> **⚠️ このファイルは一部が旧仕様です。**
> 実際のサーバ導入手順は **`docs/setup/server-deploy/README.md`（社内サーバ＋Tailscale 込みの最新手順書）を正とします**。
> 本ファイル中の **メール (EML / outlook-agent) と Meilisearch、HTTPS(443) の記述は無効** です
> (メール機能は全廃: `docs/REFACTOR_REMOVE_MAIL.md`、Meilisearch は Phase A で廃止)。
> ただし **§2「SMB マウント / Windows ACL 二重防御」のスニペットは現行で有効**なので、サーバ手順書から参照しています。

> このドキュメントは導入手順テンプレート。サーバー名・FQDN・IPレンジ・SMB資格情報は導入時に実値で置換する。

## 1. 前提

| 項目 | 推奨 |
|---|---|
| OS | Windows Server 2022 (またはWindows 11 Pro 64bit) |
| CPU/RAM | 4 vCPU / 16 GB 以上 |
| ディスク | OS ボリュームとは別に **D:\pm-data** (50GB以上) を確保 |
| Docker | Docker Desktop 4.34+ (WSL2 backend) |
| ネットワーク | 社内LAN固定IP, 既定ゲートウェイ・DNS設定済 |
| ファイルサーバ | SMB v3 で `\\<file-server>\Data` を読み取り可能 |

## 2. ホスト準備

### 2.1 SMB マウント (新規作成のみ許可で :rw)

**v2 改訂** (Phase F 編集後 PDF を新バージョンとして元フォルダに保存する要件 §6.4 + CLAUDE.md §2.2 改訂):
SMB マウントは **`:rw`** で行うが、**アプリ層 + Windows ACL の二重防御** で「**新規ファイル作成のみ許可・上書き禁止・削除禁止**」を強制する。

#### 2.1.1 WSL2 fstab

ホストの WSL2 ディストリビューション内で `/host/mnt/fileserver` に SMB を **書込可** でマウント:

```bash
# WSL2 内で
sudo mkdir -p /host/mnt/fileserver /host/mnt/uploads
sudo cp /etc/fstab /etc/fstab.bak
echo '//FILE-SERVER/Data /host/mnt/fileserver cifs rw,uid=1000,gid=1000,credentials=/etc/pm-smb.cred,iocharset=utf8,vers=3.0,file_mode=0644,dir_mode=0755 0 0' | sudo tee -a /etc/fstab
sudo bash -c 'cat > /etc/pm-smb.cred <<EOF
username=PM-APP
password=<<REPLACE_ME>>
domain=LINEWORKS
EOF'
sudo chmod 600 /etc/pm-smb.cred
sudo mount -a
ls /host/mnt/fileserver   # 読めればOK
touch /host/mnt/fileserver/_pm-write-test.tmp  # 書込テスト (アプリは削除しないので、テスト後は手動で削除すること)
```

`/host/mnt/uploads` は **Windows 側で D:\pm-data\uploads を作って WSL から bind** (書込先のため :rw)。

#### 2.1.2 ★ Windows サーバ側の SMB ACL (重要・二重防御)

**ファイルサーバ側で必ず設定**:
- アプリ用アカウント `PM-APP` を作成
- 共有フォルダ (例: `Drawings\`) に対して以下 NTFS / 共有権限を付与:

| 権限 | 設定 |
|---|---|
| 読み取り (`Read`) | ✅ 許可 |
| 書き込み (新規作成のみ) (`Write` + `Create files / Create folders`) | ✅ 許可 |
| **削除** (`Delete subfolders and files` / `Delete`) | ❌ **明示的に拒否** |
| **既存ファイルの上書き** (`Write` + `Write extended attributes`) | ❌ **明示的に拒否** (`Read & execute` のみ既存ファイルに付与) |
| **名前変更** (`Write attributes` 含む) | ❌ **拒否** |
| フルコントロール | ❌ 与えない |

PowerShell スニペット (管理者で実行):

```powershell
$acl = Get-Acl 'D:\Drawings'

# PM-APP に読取 + 新規作成 を許可
$ruleAllow = New-Object System.Security.AccessControl.FileSystemAccessRule(
    'LINEWORKS\PM-APP',
    'ReadAndExecute, CreateFiles, CreateDirectories',
    'ContainerInherit, ObjectInherit',
    'None',
    'Allow'
)
$acl.AddAccessRule($ruleAllow)

# 削除 / 上書き / Rename を明示的に拒否
$ruleDeny = New-Object System.Security.AccessControl.FileSystemAccessRule(
    'LINEWORKS\PM-APP',
    'Delete, DeleteSubdirectoriesAndFiles, WriteAttributes, WriteExtendedAttributes, ChangePermissions, TakeOwnership',
    'ContainerInherit, ObjectInherit',
    'None',
    'Deny'
)
$acl.AddAccessRule($ruleDeny)

Set-Acl -Path 'D:\Drawings' -AclObject $acl
```

これにより、たとえアプリのコードにバグがあっても、ファイルサーバ側で削除・上書き・rename が物理的に不可能になる。

#### 2.1.3 アプリ層の保護 (既に実装済)

- `backend/app/api/v1/axes.py` の `save_edited_version` は `open(path, "xb")` (排他作成) を使用 → 既存ファイル時は `FileExistsError` で 409
- `backend/app/core/security.py` の `resolve_under()` で `/mnt/fileserver` 配下を強制
- ファイル名サニタイズ (`<>:"/\\|?*\x00`)
- 削除関数 (`os.remove` / `Path.unlink` / `shutil.rmtree` / `Path.rename` 等) はリポジトリ全体で禁止 (CLAUDE.md §2.1 + pre-commit hook)

### 2.2 ファイアウォール

```powershell
# 社内LANからのみ Web (HTTPS 443) を許可。それ以外はブロック
New-NetFirewallRule -DisplayName "PM Web 443 LAN only" `
    -Direction Inbound -Protocol TCP -LocalPort 443 `
    -RemoteAddress 192.168.0.0/16 -Action Allow

New-NetFirewallRule -DisplayName "PM Web 18080 deny WAN" `
    -Direction Inbound -Protocol TCP -LocalPort 18080 `
    -RemoteAddress Internet -Action Block
```

サーバの NIC が社内LANにしか繋がっていないことを必ず確認。

## 3. HTTPS

社内CAを使うのが理想。発行できない場合は自己署名で配布する。

```powershell
# 自己署名証明書を作成 (有効期間 5 年)
$cert = New-SelfSignedCertificate -DnsName "pm.lineworks-chiba.local" `
    -CertStoreLocation "cert:\LocalMachine\My" `
    -NotAfter (Get-Date).AddYears(5)
$pwd = ConvertTo-SecureString -String "<<PFX_PASS>>" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath D:\pm-data\tls\pm.pfx -Password $pwd
```

`nginx-reverse-proxy/` ディレクトリを作り、HTTPS 終端用の Nginx を docker-compose に追加する。

```yaml
# docker-compose.prod.yml (差分)
services:
  proxy:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "443:443"
    volumes:
      - "D:/pm-data/tls:/etc/nginx/tls:ro"
      - "./nginx-reverse-proxy/default.conf:/etc/nginx/conf.d/default.conf:ro"
    depends_on:
      - web
    networks: [internal]
```

`nginx-reverse-proxy/default.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name pm.lineworks-chiba.local;
    ssl_certificate /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://web:80;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

`.pfx` から `fullchain.pem` / `privkey.pem` への変換は openssl で実施。

## 4. デプロイ手順

```powershell
cd D:\pm-app
git clone <repo-url> .   # もしくは zip 展開
copy .env.example .env
# .env を本番値に編集 (DB パスワード、Meili マスターキー、SMTP 認証情報、CORS_ORIGINS)

# Windows 側 bind 用パスを指定
$env:FILESERVER_HOST_PATH = "/host/mnt/fileserver"
$env:UPLOADS_HOST_PATH    = "D:\pm-data\uploads"
$env:BACKUPS_HOST_PATH    = "D:\pm-data\backups"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

初回のみ DB マイグレーションを実行 (API コンテナ内):

```powershell
docker compose exec api alembic upgrade head
```

## 5. 動作確認チェックリスト

- [ ] `curl -k https://pm.lineworks-chiba.local/health` が `{"status":"ok"}` を返す
- [ ] 社内LANクライアントPCのブラウザから上記URLが開ける
- [ ] 社外IPからは TCP 443 が拒否される (`Test-NetConnection` で確認)
- [ ] 工番一覧が表示される (`docker compose exec api alembic current` で最新であることを確認)
- [ ] 工番マスタExcelの変更が 1 分以内に反映される (scheduler 動作確認)
- [ ] Meilisearch 検索結果が返る
- [ ] PDF / DXF Viewer が動く
- [ ] PDF 差し替えアップロードが成功し、`D:\pm-data\uploads\replacements\...` にファイルが残る
- [ ] メール EML 作成 → Outlook で開ける
- [ ] (任意) クライアントPCに常駐 exe を入れ、`/v1/mail/compose` method=agent でテスト送信

## 6. バックアップ

`backup` サービスが毎日 3:00 に PostgreSQL を `D:\pm-data\backups` に dump 出力する。
**ファイルの削除はサービス側で一切行わない** ため、別途古いファイルは運用ポリシーで手動世代管理する。

## 7. 災害復旧

- DB: 最新の `pm_YYYYMMDD.dump` を `pg_restore -d pm` で復元
- アップロードPDF (`/mnt/uploads`): `D:\pm-data\uploads` を NAS 等にミラーする運用を別途
- 工番マスタExcel: ファイルサーバ側のバックアップに従う (本アプリは読み取りのみ)

## 8. ロールバック

```powershell
docker compose down                         # サービス停止 (DB ボリュームは残る)
git checkout <previous-tag>
docker compose up -d --build
docker compose exec api alembic downgrade <previous-revision>   # 必要時のみ
```

> **注意**: Alembic の downgrade はテーブル DROP を含むため、本番では極力使わない。可能なら旧コンテナを上げ直す方式に倒す。
