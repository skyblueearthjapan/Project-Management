#!/bin/sh
# 毎日 3:00 (Asia/Tokyo) に pg_dump を実行する常駐コンテナ用エントリ。
# ファイル削除は一切行わない (CLAUDE.md §2.1)。古い dump は別途運用で世代管理する。

set -eu

CRON_FILE=/etc/crontabs/root
mkdir -p /etc/crontabs

cat > "$CRON_FILE" <<'EOF'
0 3 * * * /usr/local/bin/pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /backups/pm_$(date +\%Y\%m\%d).dump
EOF

echo "[backup] crontab written:"
cat "$CRON_FILE"

# busybox crond をフォアグラウンドで実行 (-l 8 = info ログ)
exec crond -f -l 8
