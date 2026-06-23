#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
SERVICE_USER="${SERVICE_USER:-fortigate-backup}"
RELEASE_STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_NAME="release-$RELEASE_STAMP.tar.gz"
BACKUP_DIR="data/self-backups"
TMP_BACKUP="/tmp/fortigate-backup-$BACKUP_NAME"

cd "$APP_DIR"
sudo -u "$SERVICE_USER" mkdir -p "$BACKUP_DIR"
sudo -u "$SERVICE_USER" tar \
  --exclude node_modules \
  --exclude .next \
  --exclude data/backups \
  --exclude data/self-backups \
  --exclude data/logs \
  --exclude data/temp \
  -czf "$TMP_BACKUP" .
sudo -u "$SERVICE_USER" mv "$TMP_BACKUP" "$BACKUP_DIR/$BACKUP_NAME"
sudo -u "$SERVICE_USER" git fetch --all --prune
sudo -u "$SERVICE_USER" git pull --ff-only
sudo -u "$SERVICE_USER" corepack enable
sudo -u "$SERVICE_USER" pnpm install --frozen-lockfile
sudo -u "$SERVICE_USER" pnpm prisma migrate deploy
sudo -u "$SERVICE_USER" pnpm run build
sudo systemctl restart fortigate-backup fortigate-backup-worker
sudo -u "$SERVICE_USER" pnpm run health
echo "Update complete."
