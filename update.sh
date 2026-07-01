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
MIN_FREE_KB="${MIN_FREE_KB:-262144}"
FORTIGATE_UPDATE_LOCK_PATH="${FORTIGATE_UPDATE_LOCK_PATH:-}"

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

clear_update_lock() {
  if [ -n "$FORTIGATE_UPDATE_LOCK_PATH" ]; then
    rm -f "$FORTIGATE_UPDATE_LOCK_PATH"
  fi
}

fail_preflight() {
  cat >&2 <<EOF
Update cannot continue: $1

Recommended checks on the server:

  df -h "$APP_DIR"
  ls -ld "$APP_DIR" "$APP_DIR/.git" "$APP_DIR/.git/objects"

If ownership is wrong because files were created as root, run as root:

  chown -R $SERVICE_USER:$SERVICE_USER "$APP_DIR"
  chmod -R u+rwX "$APP_DIR/.git"

Then start the update again.
EOF
  exit 1
}

check_free_space() {
  local available_kb
  available_kb="$(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}')"
  if [ -z "$available_kb" ]; then
    fail_preflight "could not determine free disk space for $APP_DIR."
  fi
  if [ "$available_kb" -lt "$MIN_FREE_KB" ]; then
    fail_preflight "only ${available_kb}KB free on the filesystem, need at least ${MIN_FREE_KB}KB before pulling updates."
  fi
}

check_repository_writable() {
  run_as_service_user test -d "$APP_DIR/.git" || fail_preflight "$APP_DIR is not a Git repository."
  run_as_service_user test -d "$APP_DIR/.git/objects" || fail_preflight "$APP_DIR/.git/objects does not exist."
  run_as_service_user test -w "$APP_DIR/.git/objects" || fail_preflight "$SERVICE_USER cannot write to $APP_DIR/.git/objects."
  local probe="$APP_DIR/.git/objects/.fortigate-update-write-test-$$"
  if ! run_as_service_user sh -c 'touch "$1" && rm -f "$1"' sh "$probe"; then
    fail_preflight "$SERVICE_USER cannot create files in $APP_DIR/.git/objects."
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
check_free_space
check_repository_writable
run_as_service_user git -c core.filemode=false fetch --all --prune
LOCAL_REV="$(run_as_service_user git rev-parse HEAD)"
UPSTREAM_REF="$(run_as_service_user git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo origin/main)"
REMOTE_REV="$(run_as_service_user git rev-parse "$UPSTREAM_REF")"

if [ "$LOCAL_REV" = "$REMOTE_REV" ]; then
  echo "Already up to date. No update needed."
  clear_update_lock
  exit 0
fi

echo "Update available: ${LOCAL_REV:0:12} -> ${REMOTE_REV:0:12}. Starting update."
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
clear_update_lock
restart_services_or_explain
echo "Update complete."
