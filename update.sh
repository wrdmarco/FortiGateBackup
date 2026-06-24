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
SYSTEMCTL="${SYSTEMCTL:-$(command -v systemctl || echo /usr/bin/systemctl)}"
UPDATE_SCRIPT_SUM_BEFORE="$(cksum "$SCRIPT_DIR/update.sh" 2>/dev/null || true)"

run_as_service_user() {
  if [ "$(id -un)" = "$SERVICE_USER" ]; then
    "$@"
  elif [ "${EUID:-$(id -u)}" -eq 0 ]; then
    sudo -u "$SERVICE_USER" "$@"
  else
    echo "This command must run as root or as $SERVICE_USER." >&2
    exit 1
  fi
}

run_systemctl() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$SYSTEMCTL" "$@"
  else
    sudo -n "$SYSTEMCTL" "$@"
  fi
}

restart_services_or_explain() {
  if run_systemctl daemon-reload && run_systemctl restart fortigate-backup; then
    for attempt in $(seq 1 "$HEALTH_RETRIES"); do
      if run_as_service_user pnpm run health; then
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
    run_systemctl restart fortigate-backup-worker
    return 0
  fi

  cat >&2 <<EOF
Update files, dependencies, migrations and build completed, but services were not restarted.
The current user cannot run systemctl through sudo.
Run this once as root to activate the new build:

  systemctl daemon-reload
  systemctl restart fortigate-backup fortigate-backup-worker

For a fully automatic update button, explicitly approve a limited sudoers rule for the $SERVICE_USER user.
EOF
}

cd "$APP_DIR"
run_as_service_user mkdir -p "$BACKUP_DIR"
run_as_service_user tar \
  --exclude node_modules \
  --exclude .next \
  --exclude data/backups \
  --exclude data/self-backups \
  --exclude data/logs \
  --exclude data/temp \
  -czf "$TMP_BACKUP" .
run_as_service_user mv "$TMP_BACKUP" "$BACKUP_DIR/$BACKUP_NAME"
run_as_service_user git -c core.filemode=false fetch --all --prune
run_as_service_user git -c core.filemode=false pull --ff-only
UPDATE_SCRIPT_SUM_AFTER="$(cksum "$SCRIPT_DIR/update.sh" 2>/dev/null || true)"
if [ "${FORTIGATE_UPDATE_REEXECED:-0}" != "1" ] && [ "$UPDATE_SCRIPT_SUM_BEFORE" != "$UPDATE_SCRIPT_SUM_AFTER" ]; then
  echo "update.sh changed during pull. Restarting update with the new script."
  FORTIGATE_UPDATE_REEXECED=1 exec bash "$SCRIPT_DIR/update.sh"
fi
run_as_service_user corepack enable
run_as_service_user pnpm install --frozen-lockfile
run_as_service_user pnpm prisma migrate deploy
run_as_service_user pnpm run build
restart_services_or_explain
echo "Update complete."