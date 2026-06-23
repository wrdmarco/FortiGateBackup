#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
SERVICE_USER="${SERVICE_USER:-fortigate-backup}"
ARCHIVE="${1:-}"

if [ -z "$ARCHIVE" ]; then
  echo "Usage: rollback.sh /opt/fortigate-backup/data/self-backups/release-YYYYMMDDHHMMSS.tar.gz"
  exit 1
fi

cd "$APP_DIR"
sudo systemctl stop fortigate-backup fortigate-backup-worker || true
sudo -u "$SERVICE_USER" tar -xzf "$ARCHIVE" -C "$APP_DIR"
sudo -u "$SERVICE_USER" corepack enable
sudo -u "$SERVICE_USER" pnpm install --frozen-lockfile
sudo -u "$SERVICE_USER" pnpm prisma migrate deploy
sudo -u "$SERVICE_USER" pnpm run build
sudo systemctl start fortigate-backup fortigate-backup-worker
sudo -u "$SERVICE_USER" pnpm run health
echo "Rollback complete."
