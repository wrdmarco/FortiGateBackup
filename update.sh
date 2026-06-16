#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fortigate-backup}"
SERVICE_USER="${SERVICE_USER:-fortigate-backup}"
RELEASE_STAMP="$(date +%Y%m%d%H%M%S)"

cd "$APP_DIR"
sudo -u "$SERVICE_USER" mkdir -p data/self-backups
sudo -u "$SERVICE_USER" tar --exclude node_modules --exclude .next --exclude data/backups -czf "data/self-backups/release-$RELEASE_STAMP.tar.gz" .
sudo -u "$SERVICE_USER" git fetch --all --prune
sudo -u "$SERVICE_USER" git pull --ff-only
sudo -u "$SERVICE_USER" corepack enable
sudo -u "$SERVICE_USER" pnpm install --frozen-lockfile
sudo -u "$SERVICE_USER" pnpm prisma migrate deploy
sudo -u "$SERVICE_USER" pnpm run build
sudo systemctl restart fortigate-backup fortigate-backup-worker
sudo -u "$SERVICE_USER" pnpm run health
echo "Update complete."
