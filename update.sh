#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export NEXT_TELEMETRY_DISABLED=1
export CHECKPOINT_DISABLE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
SERVICE_USER="${SERVICE_USER:-fortigate-backup}"
SYSTEMCTL="${SYSTEMCTL:-$(command -v systemctl || true)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
MIN_FREE_KB="${MIN_FREE_KB:-262144}"
HEALTH_INITIAL_DELAY_MS="${HEALTH_INITIAL_DELAY_MS:-5000}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_RETRY_DELAY_MS="${HEALTH_RETRY_DELAY_MS:-2000}"
HEALTH_TIMEOUT_MS="${HEALTH_TIMEOUT_MS:-5000}"
LOCK_HEARTBEAT_SECONDS="${LOCK_HEARTBEAT_SECONDS:-20}"
LOCK_WAS_PROVIDED=0
if [ -n "${FORTIGATE_UPDATE_LOCK_PATH:-}" ]; then
  LOCK_WAS_PROVIDED=1
fi
FORTIGATE_UPDATE_LOCK_PATH="${FORTIGATE_UPDATE_LOCK_PATH:-$APP_DIR/data/logs/update.lock}"
MAINTENANCE_SERVICE="fortigate-backup-update-maintenance.service"
MAINTENANCE_SOURCE="$APP_DIR/scripts/maintenance-server.mjs"
MAINTENANCE_RUNTIME="$APP_DIR/data/update-runtime/maintenance-server.mjs"
IS_RUNNER=0
if [ "${1:-}" = "--runner" ]; then
  IS_RUNNER=1
  shift
fi

SERVICES_STOPPED="${FORTIGATE_SERVICES_STOPPED:-0}"
BUILD_COMPLETED=0
RELEASE_MUTATED="${FORTIGATE_RELEASE_MUTATED:-0}"
WEB_HEALTHY="${FORTIGATE_WEB_HEALTHY:-0}"
RELEASE_BACKUP="${FORTIGATE_RELEASE_BACKUP:-}"
ACTIVE_COMMAND_PID=""
ACTIVE_HEARTBEAT_PID=""

fail() {
  echo "Update failed: $1" >&2
  exit 1
}

validate_positive_integer() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ]; then
    fail "$name must be a positive integer."
  fi
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

touch_update_lock() {
  mkdir -p "$(dirname "$FORTIGATE_UPDATE_LOCK_PATH")"
  touch "$FORTIGATE_UPDATE_LOCK_PATH"
}

clear_update_lock() {
  rm -f "$FORTIGATE_UPDATE_LOCK_PATH"
}

prepare_maintenance_runtime() {
  run_as_service_user test -f "$MAINTENANCE_SOURCE" || fail "maintenance runtime source is missing: $MAINTENANCE_SOURCE"
  run_as_service_user mkdir -p "$(dirname "$MAINTENANCE_RUNTIME")"
  run_as_service_user install -m 0700 "$MAINTENANCE_SOURCE" "$MAINTENANCE_RUNTIME"
}

mark_maintenance_started() {
  run_as_service_user "$NODE_BIN" "$MAINTENANCE_RUNTIME" begin \
    --app-dir "$APP_DIR" \
    --operation update \
    --return-to / || fail "could not initialize the update status."
}

mark_update_finished() {
  local exit_code="$1"
  if [ -x "$MAINTENANCE_RUNTIME" ]; then
    run_as_service_user "$NODE_BIN" "$MAINTENANCE_RUNTIME" finalize \
      --app-dir "$APP_DIR" \
      --exit-code "$exit_code" || clear_update_lock
  else
    clear_update_lock
  fi
}

start_maintenance_service() {
  run_systemctl start "$MAINTENANCE_SERVICE"
  run_systemctl is-active --quiet "$MAINTENANCE_SERVICE" || fail "maintenance service did not become active."
  run_with_lock_heartbeat run_as_service_user "$NODE_BIN" "$MAINTENANCE_RUNTIME" probe \
    --url http://127.0.0.1:3000/api/health \
    --retries 20 || fail "maintenance service did not take over the application port."
}

ensure_maintenance_service() {
  if ! run_systemctl is-active --quiet "$MAINTENANCE_SERVICE" 2>/dev/null; then
    run_systemctl start "$MAINTENANCE_SERVICE"
  fi
  run_systemctl is-active --quiet "$MAINTENANCE_SERVICE"
}

stop_active_processes() {
  if [ -n "$ACTIVE_HEARTBEAT_PID" ]; then
    kill "$ACTIVE_HEARTBEAT_PID" 2>/dev/null || true
    wait "$ACTIVE_HEARTBEAT_PID" 2>/dev/null || true
    ACTIVE_HEARTBEAT_PID=""
  fi
  if [ -n "$ACTIVE_COMMAND_PID" ]; then
    kill "$ACTIVE_COMMAND_PID" 2>/dev/null || true
    wait "$ACTIVE_COMMAND_PID" 2>/dev/null || true
    ACTIVE_COMMAND_PID=""
  fi
}

run_with_lock_heartbeat() {
  local status=0
  touch_update_lock
  "$@" &
  ACTIVE_COMMAND_PID=$!
  (
    while kill -0 "$ACTIVE_COMMAND_PID" 2>/dev/null; do
      sleep "$LOCK_HEARTBEAT_SECONDS"
      touch "$FORTIGATE_UPDATE_LOCK_PATH" 2>/dev/null || exit 0
    done
  ) &
  ACTIVE_HEARTBEAT_PID=$!

  wait "$ACTIVE_COMMAND_PID" || status=$?
  ACTIVE_COMMAND_PID=""
  kill "$ACTIVE_HEARTBEAT_PID" 2>/dev/null || true
  wait "$ACTIVE_HEARTBEAT_PID" 2>/dev/null || true
  ACTIVE_HEARTBEAT_PID=""
  touch_update_lock
  return "$status"
}

cleanup_runner() {
  local status=$?
  set +e
  stop_active_processes
  if [ "$IS_RUNNER" -ne 1 ]; then
    return
  fi

  if [ "$status" -eq 0 ]; then
    run_systemctl stop "$MAINTENANCE_SERVICE" 2>/dev/null || true
    mark_update_finished 0
    return
  fi

  echo "Update runner stopped with exit code $status." >&2
  if [ "$RELEASE_MUTATED" -eq 1 ] && [ -n "$RELEASE_BACKUP" ] && [ -f "$RELEASE_BACKUP" ] && [ "$WEB_HEALTHY" -ne 1 ]; then
    echo "Restoring the previous release after failed update validation." >&2
    recovery_stage="$(mktemp -d /tmp/fortigate-update-recovery.XXXXXX)"
    run_as_service_user tar -xzf "$RELEASE_BACKUP" -C "$recovery_stage"
    run_as_service_user rsync -a --delete --delete-delay \
      --exclude='.env' --exclude='data/' --exclude='uploads/' --exclude='secrets/' --exclude='keys/' \
      "$recovery_stage/" "$APP_DIR/"
    rm -rf -- "$recovery_stage"
    if [ -f "$APP_DIR/data/postgres-migration-state.json" ]; then
      recovery_env="$($NODE_BIN -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(s.phase!=="COMPLETE")process.stdout.write(String(s.recoveryPath||"")+"/legacy.env")' "$APP_DIR/data/postgres-migration-state.json")"
      if [ -n "$recovery_env" ] && [ -f "$recovery_env" ]; then
        run_as_service_user install -m 0600 "$recovery_env" "$APP_DIR/.env.recovery"
        run_as_service_user mv "$APP_DIR/.env.recovery" "$APP_DIR/.env"
        run_as_service_user touch "$APP_DIR/data/postgres-migration-state.failed"
      fi
    fi
    RELEASE_MUTATED=0
  fi
  if [ "$SERVICES_STOPPED" -eq 1 ]; then
    if [ "$WEB_HEALTHY" -eq 1 ]; then
      echo "The verified web service remains available; the worker stays stopped." >&2
    elif [ "$RELEASE_MUTATED" -eq 0 ]; then
      echo "No release files were changed; restoring web and worker." >&2
      run_systemctl stop "$MAINTENANCE_SERVICE" 2>/dev/null || true
      if run_systemctl start fortigate-backup.service && run_systemctl is-active --quiet fortigate-backup.service; then
        WEB_HEALTHY=1
        run_systemctl start fortigate-backup-worker.service || true
      else
        echo "The previous web service could not be restored; maintenance remains available." >&2
        ensure_maintenance_service || true
      fi
    else
      echo "No healthy application build is available; maintenance remains on the application port." >&2
      run_systemctl stop fortigate-backup.service 2>/dev/null || true
      ensure_maintenance_service || true
    fi
  fi
  mark_update_finished "$status"
}

check_free_space() {
  local available_kb
  available_kb="$(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}')"
  [ -n "$available_kb" ] || fail "could not determine free disk space for $APP_DIR."
  if [ "$available_kb" -lt "$MIN_FREE_KB" ]; then
    fail "only ${available_kb}KB is free; at least ${MIN_FREE_KB}KB is required."
  fi
}

check_repository_writable() {
  run_as_service_user test -d "$APP_DIR/.git" || fail "$APP_DIR is not a Git repository."
  run_as_service_user test -d "$APP_DIR/.git/objects" || fail "$APP_DIR/.git/objects does not exist."
  run_as_service_user test -w "$APP_DIR/.git/objects" || fail "$SERVICE_USER cannot write to $APP_DIR/.git/objects."
  local probe="$APP_DIR/.git/objects/.fortigate-update-write-test-$$"
  if ! run_as_service_user sh -c 'touch "$1" && rm -f "$1"' sh "$probe"; then
    fail "$SERVICE_USER cannot create files in $APP_DIR/.git/objects."
  fi
  run_as_service_user git diff --quiet || fail "tracked application files contain local changes."
  run_as_service_user git diff --cached --quiet || fail "the Git index contains local changes."
}

create_release_backup() {
  local release_stamp
  local backup_name
  local backup_dir="$APP_DIR/data/self-backups"
  local temporary_backup

  release_stamp="$(date +%Y%m%d%H%M%S)"
  backup_name="release-$release_stamp.tar.gz"
  temporary_backup="$backup_dir/.$backup_name.tmp"
  run_as_service_user mkdir -p "$backup_dir"
  run_with_lock_heartbeat run_as_service_user tar \
    --exclude='./.env' \
    --exclude='./node_modules' \
    --exclude='./.next' \
    --exclude='./data/backups' \
    --exclude='./data/self-backups' \
    --exclude='./data/logs' \
    --exclude='./data/temp' \
    --exclude='./data/update-runtime' \
    --exclude='./uploads' \
    --exclude='./secrets' \
    --exclude='./keys' \
    -czf "$temporary_backup" \
    -C "$APP_DIR" .
  run_as_service_user chmod 0600 "$temporary_backup"
  run_as_service_user mv "$temporary_backup" "$backup_dir/$backup_name"
  RELEASE_BACKUP="$backup_dir/$backup_name"
  export FORTIGATE_RELEASE_BACKUP="$RELEASE_BACKUP"
  echo "Created release backup $backup_dir/$backup_name."
}

stop_application_services() {
  echo "Handing the application port to the standalone maintenance service."
  run_as_service_user test -f "/etc/systemd/system/$MAINTENANCE_SERVICE" || fail "maintenance service is not installed; run setup.sh once as root."
  prepare_maintenance_runtime
  SERVICES_STOPPED=1
  export FORTIGATE_SERVICES_STOPPED=1
  run_systemctl stop fortigate-backup-worker.service
  run_systemctl stop fortigate-backup.service
  touch_update_lock
  start_maintenance_service
}

start_and_verify_services() {
  echo "Returning the application port to the web service."
  run_systemctl daemon-reload
  run_systemctl stop "$MAINTENANCE_SERVICE"
  run_systemctl start fortigate-backup.service
  run_systemctl is-active --quiet fortigate-backup.service || fail "web service did not become active."

  if ! run_with_lock_heartbeat run_as_service_user pnpm run health -- \
    "--initial-delay-ms=$HEALTH_INITIAL_DELAY_MS" \
    "--retries=$HEALTH_RETRIES" \
    "--retry-delay-ms=$HEALTH_RETRY_DELAY_MS" \
    "--timeout-ms=$HEALTH_TIMEOUT_MS"; then
    run_systemctl stop fortigate-backup.service 2>/dev/null || true
    ensure_maintenance_service || true
    fail "web health check failed; maintenance has resumed."
  fi
  WEB_HEALTHY=1
  export FORTIGATE_WEB_HEALTHY=1

  echo "Starting worker service after the web health check passed."
  run_systemctl start fortigate-backup-worker.service
  run_systemctl is-active --quiet fortigate-backup-worker.service || fail "worker service did not become active."
  SERVICES_STOPPED=0
}

if [ "$#" -ne 0 ]; then
  fail "unknown argument: $1"
fi
[ -n "$SYSTEMCTL" ] || fail "systemctl is required."
[ -n "$NODE_BIN" ] || fail "node is required."
validate_positive_integer MIN_FREE_KB "$MIN_FREE_KB"
validate_positive_integer HEALTH_INITIAL_DELAY_MS "$HEALTH_INITIAL_DELAY_MS"
validate_positive_integer HEALTH_RETRIES "$HEALTH_RETRIES"
validate_positive_integer HEALTH_RETRY_DELAY_MS "$HEALTH_RETRY_DELAY_MS"
validate_positive_integer HEALTH_TIMEOUT_MS "$HEALTH_TIMEOUT_MS"
validate_positive_integer LOCK_HEARTBEAT_SECONDS "$LOCK_HEARTBEAT_SECONDS"

cd "$APP_DIR"

if [ "$IS_RUNNER" -eq 0 ]; then
  prepare_maintenance_runtime
  if [ "$LOCK_WAS_PROVIDED" -eq 0 ]; then
    run_as_service_user mkdir -p "$(dirname "$FORTIGATE_UPDATE_LOCK_PATH")"
    if ! run_as_service_user sh -c 'set -C; printf "%s\n" "$2" > "$1"' sh "$FORTIGATE_UPDATE_LOCK_PATH" "$(date +%s)"; then
      fail "another update is already running."
    fi
  elif [ ! -f "$FORTIGATE_UPDATE_LOCK_PATH" ]; then
    fail "the provided update lock does not exist."
  fi
  mark_maintenance_started
  echo "Handing the update to fortigate-backup-update.service."
  if ! run_systemctl start fortigate-backup-update.service; then
    mark_update_finished 1
    fail "the isolated update service failed to start or did not complete successfully. Run setup.sh once as root if the update service is not installed."
  fi
  exit 0
fi

trap cleanup_runner EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
touch_update_lock
check_free_space
check_repository_writable

case "${DATABASE_URL:-}" in
  file:*)
    if [ ! -r /etc/fortigate-backup/postgres.env ]; then
      fail "PostgreSQL migration preparation is missing. Keep the current application running and execute exactly: cd $APP_DIR && sudo ./setup.sh --prepare-postgres-migration ; then start the update again."
    fi
    ;;
  postgres://*|postgresql://*) ;;
  *) fail "Unsupported DATABASE_URL scheme; no changes were made." ;;
esac

if [ "${FORTIGATE_UPDATE_REEXECED:-0}" != "1" ]; then
  run_with_lock_heartbeat run_as_service_user git -c core.filemode=false fetch --all --prune
  LOCAL_REV="$(run_as_service_user git rev-parse HEAD)"
  UPSTREAM_REF="$(run_as_service_user git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo origin/main)"
  REMOTE_REV="$(run_as_service_user git rev-parse "$UPSTREAM_REF")"

  if [ "$LOCAL_REV" = "$REMOTE_REV" ]; then
    echo "Already up to date. No update needed."
    exit 0
  fi

  echo "Update available: ${LOCAL_REV:0:12} -> ${REMOTE_REV:0:12}."
  UPDATE_SCRIPT_SUM_BEFORE="$(cksum "$APP_DIR/update.sh")"
  stop_application_services
  create_release_backup
  RELEASE_MUTATED=1
  export FORTIGATE_RELEASE_MUTATED=1
  run_with_lock_heartbeat run_as_service_user git -c core.filemode=false pull --ff-only
  UPDATE_SCRIPT_SUM_AFTER="$(cksum "$APP_DIR/update.sh")"

  if [ "$UPDATE_SCRIPT_SUM_BEFORE" != "$UPDATE_SCRIPT_SUM_AFTER" ]; then
    echo "update.sh changed during pull. Continuing with the new script at the post-pull phase."
    export FORTIGATE_UPDATE_REEXECED=1
    export FORTIGATE_SERVICES_STOPPED="$SERVICES_STOPPED"
    export FORTIGATE_RELEASE_BACKUP="$RELEASE_BACKUP"
    export APP_DIR SERVICE_USER SYSTEMCTL NODE_BIN MIN_FREE_KB FORTIGATE_RELEASE_MUTATED FORTIGATE_RELEASE_BACKUP FORTIGATE_WEB_HEALTHY
    export HEALTH_INITIAL_DELAY_MS HEALTH_RETRIES HEALTH_RETRY_DELAY_MS HEALTH_TIMEOUT_MS LOCK_HEARTBEAT_SECONDS
    exec bash "$APP_DIR/update.sh" --runner
  fi
else
  if [ "$SERVICES_STOPPED" -ne 1 ]; then
    fail "post-pull continuation was requested without a stopped application."
  fi
  echo "Resumed update after update.sh changed; skipping fetch and pull."
fi

run_with_lock_heartbeat run_as_service_user pnpm install --frozen-lockfile
if [[ "${DATABASE_URL:-}" == file:* ]]; then
  POSTGRES_MIGRATION_URL="$(awk -F= '/^POSTGRES_MIGRATION_URL=/{sub(/^[^=]*=/,""); print}' /etc/fortigate-backup/postgres.env)"
  eval "POSTGRES_MIGRATION_URL=$POSTGRES_MIGRATION_URL"
  run_with_lock_heartbeat run_as_service_user env DATABASE_URL="$POSTGRES_MIGRATION_URL" CHECKPOINT_DISABLE=1 pnpm prisma migrate deploy
  run_with_lock_heartbeat run_as_service_user env POSTGRES_MIGRATION_URL="$POSTGRES_MIGRATION_URL" DATABASE_URL="$DATABASE_URL" NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 pnpm exec tsx scripts/migrate-sqlite-to-postgres.ts
  DATABASE_URL="$(awk -F= '/^DATABASE_URL=/{sub(/^[^=]*=/,""); print}' "$APP_DIR/.env")"
  eval "DATABASE_URL=$DATABASE_URL"
else
  dump_dir="$APP_DIR/data/self-backups/postgres"
  run_as_service_user mkdir -p "$dump_dir"
  dump_file="$dump_dir/pre-migration-$(date -u +%Y%m%dT%H%M%SZ).dump"
  run_with_lock_heartbeat run_as_service_user pg_dump -Fc --file="$dump_file" "$DATABASE_URL"
  run_as_service_user sha256sum "$dump_file" > "$dump_file.sha256"
  run_as_service_user pg_restore --list "$dump_file" >/dev/null
  run_with_lock_heartbeat run_as_service_user env DATABASE_URL="$DATABASE_URL" CHECKPOINT_DISABLE=1 pnpm prisma migrate deploy
fi
run_as_service_user env NEXT_TELEMETRY_DISABLED=1 pnpm exec next telemetry disable >/dev/null
run_with_lock_heartbeat run_as_service_user pnpm run build
BUILD_COMPLETED=1
start_and_verify_services
if [ -f "$APP_DIR/data/postgres-migration-state.json" ]; then
  run_as_service_user env DATABASE_URL="$DATABASE_URL" pnpm exec tsx scripts/finalize-postgres-migration.ts
fi
echo "Update complete."
