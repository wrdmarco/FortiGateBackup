#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
SERVICE_USER="${SERVICE_USER:-fortigate-backup}"
RELEASE_STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_NAME="release-$RELEASE_STAMP.tar.gz"
BACKUP_DIR="data/self-backups"
TMP_BACKUP="/tmp/fortigate-backup-$BACKUP_NAME"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"
UPDATE_SCRIPT_SUM_BEFORE="$(cksum "$SCRIPT_DIR/update.sh" 2>/dev/null || true)"

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
UPDATE_SCRIPT_SUM_AFTER="$(cksum "$SCRIPT_DIR/update.sh" 2>/dev/null || true)"
if [ "${FORTIGATE_UPDATE_REEXECED:-0}" != "1" ] && [ "$UPDATE_SCRIPT_SUM_BEFORE" != "$UPDATE_SCRIPT_SUM_AFTER" ]; then
  echo "update.sh changed during pull. Restarting update with the new script."
  FORTIGATE_UPDATE_REEXECED=1 exec "$SCRIPT_DIR/update.sh"
fi
sudo -u "$SERVICE_USER" corepack enable
sudo -u "$SERVICE_USER" pnpm install --frozen-lockfile
sudo -u "$SERVICE_USER" pnpm prisma migrate deploy
sudo -u "$SERVICE_USER" pnpm run build
sudo systemctl daemon-reload
sudo systemctl restart fortigate-backup
for attempt in $(seq 1 "$HEALTH_RETRIES"); do
  if sudo -u "$SERVICE_USER" pnpm run health; then
    echo "Health check passed."
    break
  fi
  if [ "$attempt" -eq "$HEALTH_RETRIES" ]; then
    echo "Health check failed after $HEALTH_RETRIES attempts." >&2
    exit 1
  fi
  echo "Waiting for application health check ($attempt/$HEALTH_RETRIES)..."
  sleep "$HEALTH_DELAY"
done
sudo systemctl restart fortigate-backup-worker
echo "Update complete."
