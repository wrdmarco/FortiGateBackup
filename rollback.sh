#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
SERVICE_USER="${SERVICE_USER:-fortigate-backup}"
SYSTEMCTL="${SYSTEMCTL:-$(command -v systemctl || true)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
ARCHIVE="${1:-}"
BACKUP_DIR="$APP_DIR/data/self-backups"
UPDATE_LOCK="$APP_DIR/data/logs/update.lock"
MAINTENANCE_SERVICE="fortigate-backup-update-maintenance.service"
MAINTENANCE_SOURCE="$APP_DIR/scripts/maintenance-server.mjs"
MAINTENANCE_RUNTIME="$APP_DIR/data/update-runtime/maintenance-server.mjs"
STAGING_DIR=""
SERVICES_STOPPED=0
BUILD_COMPLETED=0
RELEASE_MUTATED=0
WEB_HEALTHY=0
LOCK_ACQUIRED=0

fail() {
  echo "Rollback failed: $1" >&2
  exit 1
}

run_as_service_user() {
  if [ "$(id -un)" = "$SERVICE_USER" ]; then
    "$@"
  elif [ "${EUID:-$(id -u)}" -eq 0 ]; then
    runuser -u "$SERVICE_USER" -- "$@"
  else
    sudo -n -u "$SERVICE_USER" "$@"
  fi
}

run_systemctl() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$SYSTEMCTL" "$@"
  else
    sudo -n "$SYSTEMCTL" "$@"
  fi
}

prepare_maintenance_runtime() {
  run_as_service_user test -f "$MAINTENANCE_SOURCE" || fail "maintenance runtime source is missing: $MAINTENANCE_SOURCE"
  run_as_service_user mkdir -p "$(dirname "$MAINTENANCE_RUNTIME")"
  run_as_service_user install -m 0700 "$MAINTENANCE_SOURCE" "$MAINTENANCE_RUNTIME"
}

mark_rollback_started() {
  run_as_service_user "$NODE_BIN" "$MAINTENANCE_RUNTIME" begin \
    --app-dir "$APP_DIR" \
    --operation rollback \
    --return-to / || fail "could not initialize rollback status."
}

mark_rollback_finished() {
  local exit_code="$1"
  if [ -x "$MAINTENANCE_RUNTIME" ]; then
    run_as_service_user "$NODE_BIN" "$MAINTENANCE_RUNTIME" finalize \
      --app-dir "$APP_DIR" \
      --exit-code "$exit_code" || run_as_service_user rm -f "$UPDATE_LOCK"
  else
    run_as_service_user rm -f "$UPDATE_LOCK"
  fi
}

start_maintenance_service() {
  run_systemctl start "$MAINTENANCE_SERVICE"
  run_systemctl is-active --quiet "$MAINTENANCE_SERVICE" || fail "maintenance service did not become active."
  run_as_service_user "$NODE_BIN" "$MAINTENANCE_RUNTIME" probe \
    --url http://127.0.0.1:3000/api/health \
    --retries 20 || fail "maintenance service did not take over the application port."
}

ensure_maintenance_service() {
  if ! run_systemctl is-active --quiet "$MAINTENANCE_SERVICE" 2>/dev/null; then
    run_systemctl start "$MAINTENANCE_SERVICE"
  fi
  run_systemctl is-active --quiet "$MAINTENANCE_SERVICE"
}

cleanup() {
  local status=$?
  set +e
  if [ -n "$STAGING_DIR" ] && [[ "$STAGING_DIR" == /tmp/fortigate-rollback.* ]]; then
    rm -rf -- "$STAGING_DIR"
  fi
  if [ "$status" -eq 0 ]; then
    run_systemctl stop "$MAINTENANCE_SERVICE" 2>/dev/null || true
  elif [ "$SERVICES_STOPPED" -eq 1 ]; then
    if [ "$WEB_HEALTHY" -eq 1 ]; then
      echo "The verified web service remains available; the worker stays stopped." >&2
    elif [ "$RELEASE_MUTATED" -eq 0 ]; then
      echo "No release files were changed; restoring web and worker." >&2
      run_systemctl stop "$MAINTENANCE_SERVICE" 2>/dev/null || true
      if run_systemctl start fortigate-backup.service && run_systemctl is-active --quiet fortigate-backup.service; then
        WEB_HEALTHY=1
        run_systemctl start fortigate-backup-worker.service || true
      else
        ensure_maintenance_service || true
      fi
    else
      echo "Rollback did not produce a healthy build; maintenance remains available." >&2
      run_systemctl stop fortigate-backup.service 2>/dev/null || true
      ensure_maintenance_service || true
    fi
  fi
  if [ "$LOCK_ACQUIRED" -eq 1 ]; then
    mark_rollback_finished "$status"
  fi
}

validate_archive_entries() {
  local entry
  local normalized
  run_as_service_user tar -tzf "$ARCHIVE" >/dev/null || fail "archive is not a readable gzip tar archive."
  while IFS= read -r entry; do
    normalized="${entry#./}"
    case "$normalized" in
      /*|../*|*/../*|*/..)
        fail "archive contains an unsafe path: $entry"
        ;;
      .env|.env/*|data/backups|data/backups/*|data/self-backups|data/self-backups/*|data/logs|data/logs/*|data/temp|data/temp/*|uploads|uploads/*|secrets|secrets/*|keys|keys/*)
        fail "archive attempts to overwrite protected application data: $entry"
        ;;
    esac
  done < <(run_as_service_user tar -tzf "$ARCHIVE")
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

[ "$#" -eq 1 ] || fail "usage: rollback.sh $BACKUP_DIR/release-YYYYMMDDHHMMSS.tar.gz"
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run rollback.sh as root."
[ -n "$SYSTEMCTL" ] || fail "systemctl is required."
[ -n "$NODE_BIN" ] || fail "node is required."
[ -f "$ARCHIVE" ] || fail "archive does not exist: $ARCHIVE"

APP_DIR="$(realpath -m "$APP_DIR")"
BACKUP_DIR="$APP_DIR/data/self-backups"
UPDATE_LOCK="$APP_DIR/data/logs/update.lock"
MAINTENANCE_SOURCE="$APP_DIR/scripts/maintenance-server.mjs"
MAINTENANCE_RUNTIME="$APP_DIR/data/update-runtime/maintenance-server.mjs"
ARCHIVE="$(realpath "$ARCHIVE")"
case "$ARCHIVE" in
  "$BACKUP_DIR"/release-*.tar.gz) ;;
  *) fail "archive must be a release backup stored in $BACKUP_DIR." ;;
esac

if run_systemctl is-active --quiet fortigate-backup-update.service 2>/dev/null; then
  fail "an application update is currently running."
fi
validate_archive_entries
test -f "/etc/systemd/system/$MAINTENANCE_SERVICE" || fail "maintenance service is not installed; run setup.sh once before rollback."
prepare_maintenance_runtime
run_as_service_user mkdir -p "$(dirname "$UPDATE_LOCK")"
if ! run_as_service_user sh -c 'set -C; printf "%s\n" "$2" > "$1"' sh "$UPDATE_LOCK" "$(date +%s)"; then
  fail "an update or rollback is already running."
fi
LOCK_ACQUIRED=1
mark_rollback_started

echo "Handing the application port to the standalone maintenance service."
SERVICES_STOPPED=1
run_systemctl stop fortigate-backup-worker.service
run_systemctl stop fortigate-backup.service
start_maintenance_service

STAGING_DIR="$(mktemp -d /tmp/fortigate-rollback.XXXXXXXX)"
chown "$SERVICE_USER:$(id -gn "$SERVICE_USER")" "$STAGING_DIR"
run_as_service_user tar -xzf "$ARCHIVE" --no-same-owner --no-same-permissions -C "$STAGING_DIR"

RELEASE_MUTATED=1
run_as_service_user rsync -a --delete --delete-delay \
  --exclude='.env' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='/data/backups/' \
  --exclude='/data/self-backups/' \
  --exclude='/data/logs/' \
  --exclude='/data/temp/' \
  --exclude='/uploads/' \
  --exclude='/secrets/' \
  --exclude='/keys/' \
  "$STAGING_DIR/" "$APP_DIR/"

cd "$APP_DIR"
run_as_service_user pnpm install --frozen-lockfile
run_as_service_user pnpm prisma migrate deploy
run_as_service_user pnpm run build
BUILD_COMPLETED=1

run_systemctl daemon-reload
run_systemctl stop "$MAINTENANCE_SERVICE"
run_systemctl start fortigate-backup.service
run_systemctl is-active --quiet fortigate-backup.service || fail "web service did not become active."
if ! run_as_service_user pnpm run health -- \
  --initial-delay-ms=5000 \
  --retries=30 \
  --retry-delay-ms=2000 \
  --timeout-ms=5000; then
  run_systemctl stop fortigate-backup.service 2>/dev/null || true
  ensure_maintenance_service || true
  fail "web health check failed; maintenance has resumed."
fi
WEB_HEALTHY=1
run_systemctl start fortigate-backup-worker.service
run_systemctl is-active --quiet fortigate-backup-worker.service || fail "worker service did not become active."
SERVICES_STOPPED=0

echo "Rollback complete."
