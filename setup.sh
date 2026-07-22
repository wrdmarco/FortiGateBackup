#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export NEXT_TELEMETRY_DISABLED=1
export CHECKPOINT_DISABLE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/opt/fortigate-backup}"
SERVICE_USER="${SERVICE_USER:-fortigate-backup}"
SYSTEMCTL="${SYSTEMCTL:-$(command -v systemctl || true)}"
SUPPORTED_UBUNTU_VERSIONS="24.04 26.04"
NODE_MAJOR="24"
COREPACK_VERSION="0.34.0"
PNPM_VERSION="10.0.0"

fail() {
  echo "Setup failed: $1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is not installed."
}

run_root() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_as_postgres() { run_root runuser -u postgres -- "$@"; }

run_as_service_user() {
  if [ "$(id -un)" = "$SERVICE_USER" ]; then
    "$@"
  elif [ "${EUID:-$(id -u)}" -eq 0 ]; then
    runuser -u "$SERVICE_USER" -- "$@"
  else
    sudo -u "$SERVICE_USER" "$@"
  fi
}

validate_operating_system() {
  [ -r /etc/os-release ] || fail "/etc/os-release is not available. Ubuntu 24.04 or 26.04 LTS is required."

  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || fail "unsupported operating system '${ID:-unknown}'. Ubuntu 24.04 or 26.04 LTS is required."

  case " $SUPPORTED_UBUNTU_VERSIONS " in
    *" ${VERSION_ID:-unknown} "*) ;;
    *) fail "Ubuntu ${VERSION_ID:-unknown} is not supported. Use Ubuntu 24.04 or 26.04 LTS." ;;
  esac
}

install_system_dependencies() {
  run_root apt-get update
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    curl \
    git \
    gnupg \
    openssl \
    postgresql \
    postgresql-client \
    python3 \
    rsync \
    sudo \
    tar
}

urlencode() { python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))'; }

provision_postgresql() {
  local credentials_dir="/etc/fortigate-backup"
  local credentials_file="$credentials_dir/postgres.env"
  if [ -n "${EXTERNAL_DATABASE_URL:-}" ]; then
    [[ "$EXTERNAL_DATABASE_URL" =~ ^postgres(ql)?:// ]] || fail "EXTERNAL_DATABASE_URL must be a PostgreSQL URL."
    [[ "$EXTERNAL_DATABASE_URL" == *"sslmode=verify-full"* ]] || fail "External PostgreSQL requires sslmode=verify-full."
    [ -n "${EXTERNAL_MIGRATION_URL:-}" ] || fail "EXTERNAL_MIGRATION_URL is required for an external PostgreSQL database."
    run_root install -d -o root -g "$SERVICE_GROUP" -m 0750 "$credentials_dir"
    local external_temp
    external_temp="$(mktemp)"
    printf 'POSTGRES_RUNTIME_URL=%q\nPOSTGRES_MIGRATION_URL=%q\n' "$EXTERNAL_DATABASE_URL" "$EXTERNAL_MIGRATION_URL" > "$external_temp"
    run_root install -o root -g "$SERVICE_GROUP" -m 0640 "$external_temp" "$credentials_file"
    rm -f "$external_temp"
    return
  fi
  if run_root test -s "$credentials_file"; then return; fi
  local app_password migrator_password app_encoded migrator_encoded temp_file
  app_password="$(generate_secret)"
  migrator_password="$(generate_secret)"
  app_encoded="$(printf '%s' "$app_password" | urlencode)"
  migrator_encoded="$(printf '%s' "$migrator_password" | urlencode)"
  run_root systemctl enable --now postgresql
  run_as_postgres psql --set=ON_ERROR_STOP=1 --quiet \
    --set=app_password="$app_password" --set=migrator_password="$migrator_password" <<'SQL'
SELECT format('CREATE ROLE fortibackup_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS', :'migrator_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fortibackup_migrator') \gexec
SELECT format('CREATE ROLE fortibackup_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', :'app_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fortibackup_app') \gexec
ALTER ROLE fortibackup_migrator BYPASSRLS;
SELECT 'CREATE DATABASE fortibackup OWNER fortibackup_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='fortibackup') \gexec
REVOKE ALL ON DATABASE fortibackup FROM PUBLIC;
GRANT CONNECT ON DATABASE fortibackup TO fortibackup_app;
SQL
  run_as_postgres psql --set=ON_ERROR_STOP=1 --quiet --dbname=fortibackup <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO fortibackup_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fortibackup_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO fortibackup_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fortibackup_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO fortibackup_app;
SQL
  temp_file="$(mktemp)"
  printf 'POSTGRES_RUNTIME_URL=%q\nPOSTGRES_MIGRATION_URL=%q\n' \
    "postgresql://fortibackup_app:${app_encoded}@127.0.0.1:5432/fortibackup?sslmode=disable" \
    "postgresql://fortibackup_migrator:${migrator_encoded}@127.0.0.1:5432/fortibackup?sslmode=disable" > "$temp_file"
  run_root install -d -o root -g "$SERVICE_GROUP" -m 0750 "$credentials_dir"
  run_root install -o root -g "$SERVICE_GROUP" -m 0640 "$temp_file" "$credentials_file"
  rm -f "$temp_file"
  unset app_password migrator_password app_encoded migrator_encoded
}

node_major_version() {
  node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true
}

install_nodejs() {
  local installed_major
  local key_source
  local keyring_source
  local architecture

  installed_major="$(node_major_version)"
  if [ "$installed_major" = "$NODE_MAJOR" ]; then
    return
  fi
  if [ -n "$installed_major" ] && [ "$installed_major" -gt "$NODE_MAJOR" ]; then
    fail "Node.js $(node --version) is installed, but this release requires Node.js $NODE_MAJOR LTS."
  fi

  key_source="$(mktemp)"
  keyring_source="$(mktemp)"
  curl --fail --silent --show-error --location \
    https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    --output "$key_source"
  gpg --dearmor --yes --output "$keyring_source" "$key_source"
  run_root install -o root -g root -m 0644 "$keyring_source" /usr/share/keyrings/nodesource.gpg
  rm -f "$key_source" "$keyring_source"

  architecture="$(dpkg --print-architecture)"
  printf 'deb [arch=%s signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' \
    "$architecture" "$NODE_MAJOR" | run_root tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  run_root apt-get update
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs

  installed_major="$(node_major_version)"
  [ "$installed_major" = "$NODE_MAJOR" ] || fail "Node.js $NODE_MAJOR installation failed; found $(node --version 2>/dev/null || echo none)."
}

install_package_manager() {
  if ! command -v corepack >/dev/null 2>&1; then
    run_root npm install --global "corepack@$COREPACK_VERSION"
  fi
  run_root corepack enable
  run_root corepack prepare "pnpm@$PNPM_VERSION" --activate
  [ "$(pnpm --version)" = "$PNPM_VERSION" ] || fail "pnpm $PNPM_VERSION activation failed."
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  else
    fail "openssl or python3 is required to generate secure setup secrets."
  fi
}

validate_inputs() {
  case "$APP_DIR" in
    /*) ;;
    *) fail "APP_DIR must be an absolute path." ;;
  esac
  case "$APP_DIR" in
    *'"'*|*'\'*|*'%'*) fail "APP_DIR cannot contain double quotes, backslashes or percent signs." ;;
  esac
  case "$APP_DIR" in
    *[[:space:]]*) fail "APP_DIR cannot contain whitespace." ;;
  esac
  if ! [[ "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
    fail "SERVICE_USER contains unsupported characters."
  fi
}

set_env_if_blank() {
  local key="$1"
  local value="$2"
  local env_file="$APP_DIR/.env"

  if run_root grep -Eq "^${key}=" "$env_file"; then
    if run_root grep -Eq "^${key}=[[:space:]]*(\"\"|'')?[[:space:]]*$" "$env_file"; then
      run_root sed -i "s|^${key}=.*|${key}=\"${value}\"|" "$env_file"
    fi
  else
    printf '%s="%s"\n' "$key" "$value" | run_root tee -a "$env_file" >/dev/null
  fi
}

normalize_env_file() {
  local env_file="$APP_DIR/.env"
  local temp_file
  temp_file="$(mktemp)"

  run_root awk '
    /^DATABASE_URL=/ { database = $0 }
    /^NEXTAUTH_SECRET=/ { nextauth = $0 }
    /^ENCRYPTION_KEY=/ { encryption = $0 }
    END {
      if (database != "") print database
      if (nextauth != "") print nextauth
      if (encryption != "") print encryption
      print "NEXT_TELEMETRY_DISABLED=1"
      print "CHECKPOINT_DISABLE=1"
    }
  ' "$env_file" > "$temp_file"
  run_root install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0600 "$temp_file" "$env_file"
  rm -f "$temp_file"

  set_env_if_blank "DATABASE_URL" "$POSTGRES_RUNTIME_URL"
  set_env_if_blank "NEXTAUTH_SECRET" "$(generate_secret)"
  set_env_if_blank "ENCRYPTION_KEY" "$(generate_secret)"
  run_root chown "$SERVICE_USER:$SERVICE_GROUP" "$env_file"
  run_root chmod 0600 "$env_file"
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}

render_systemd_unit() {
  local unit_name="$1"
  local source_file="$APP_DIR/systemd/$unit_name"
  local target_file="/etc/systemd/system/$unit_name"
  local temp_file

  [ -f "$source_file" ] || fail "systemd template $source_file is missing."
  temp_file="$(mktemp)"
  sed \
    -e "s|@APP_DIR@|$(escape_sed_replacement "$APP_DIR")|g" \
    -e "s|@SERVICE_USER@|$(escape_sed_replacement "$SERVICE_USER")|g" \
    -e "s|@SERVICE_GROUP@|$(escape_sed_replacement "$SERVICE_GROUP")|g" \
    "$source_file" > "$temp_file"

  if grep -Eq '@(APP_DIR|SERVICE_USER|SERVICE_GROUP)@' "$temp_file"; then
    rm -f "$temp_file"
    fail "unresolved placeholder in $unit_name."
  fi

  run_root install -o root -g root -m 0644 "$temp_file" "$target_file"
  rm -f "$temp_file"
}

install_maintenance_runtime() {
  local source_file="$APP_DIR/scripts/maintenance-server.mjs"
  local runtime_dir="$APP_DIR/data/update-runtime"
  [ -f "$source_file" ] || fail "maintenance runtime source $source_file is missing."
  run_as_service_user mkdir -p "$runtime_dir"
  run_as_service_user install -m 0700 "$source_file" "$runtime_dir/maintenance-server.mjs"
}

install_sudoers_rule() {
  local sudoers_file="/etc/sudoers.d/fortigate-backup-update"
  local temp_file
  temp_file="$(mktemp)"

  cat > "$temp_file" <<EOF
# Allow the FortiGate Backup service account to run the isolated update workflow.
Cmnd_Alias FORTIGATE_BACKUP_UPDATE = $SYSTEMCTL start fortigate-backup-update.service, $SYSTEMCTL stop fortigate-backup.service, $SYSTEMCTL stop fortigate-backup-worker.service, $SYSTEMCTL start fortigate-backup.service, $SYSTEMCTL start fortigate-backup-worker.service, $SYSTEMCTL start fortigate-backup-update-maintenance.service, $SYSTEMCTL stop fortigate-backup-update-maintenance.service, $SYSTEMCTL is-active --quiet fortigate-backup.service, $SYSTEMCTL is-active --quiet fortigate-backup-worker.service, $SYSTEMCTL is-active --quiet fortigate-backup-update.service, $SYSTEMCTL is-active --quiet fortigate-backup-update-maintenance.service, $SYSTEMCTL daemon-reload
$SERVICE_USER ALL=(root) NOPASSWD: FORTIGATE_BACKUP_UPDATE
EOF

  run_root chmod 0440 "$temp_file"
  run_root visudo -cf "$temp_file" >/dev/null
  run_root install -o root -g root -m 0440 "$temp_file" "$sudoers_file"
  rm -f "$temp_file"
}

validate_systemd_units() {
  if command -v systemd-analyze >/dev/null 2>&1; then
    run_root systemd-analyze verify \
      /etc/systemd/system/fortigate-backup.service \
      /etc/systemd/system/fortigate-backup-worker.service \
      /etc/systemd/system/fortigate-backup-update.service \
      /etc/systemd/system/fortigate-backup-update-maintenance.service
  fi
}

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  require_command sudo
fi
require_command apt-get
validate_operating_system
if [ "${1:-}" = "--prepare-postgres-migration" ]; then
  validate_inputs
  getent passwd "$SERVICE_USER" >/dev/null 2>&1 || fail "service user $SERVICE_USER does not exist; this preparation command is only for an existing installation."
  SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
  run_root apt-get update
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y openssl postgresql postgresql-client python3
  provision_postgresql
  echo "PostgreSQL migration preparation completed. Run the normal FortiBackup update again."
  exit 0
fi
install_system_dependencies
install_nodejs
install_package_manager

for command_name in awk corepack dpkg getent git grep install node npm pnpm realpath rsync sed tar tee; do
  require_command "$command_name"
done
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  require_command sudo
else
  require_command runuser
fi
[ -n "$SYSTEMCTL" ] || fail "systemctl is required."
require_command visudo
validate_inputs

[ -f "$SCRIPT_DIR/package.json" ] || fail "package.json is missing next to setup.sh."
APP_DIR="$(realpath -m "$APP_DIR")"
SOURCE_DIR="$(realpath -m "$SCRIPT_DIR")"
if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
  case "$APP_DIR/" in
    "$SOURCE_DIR/"*) fail "APP_DIR cannot be located inside the source checkout." ;;
  esac
  case "$SOURCE_DIR/" in
    "$APP_DIR/"*) fail "the source checkout cannot be located inside APP_DIR." ;;
  esac
fi

if ! getent passwd "$SERVICE_USER" >/dev/null 2>&1; then
  if ! getent group "$SERVICE_USER" >/dev/null 2>&1; then
    run_root groupadd --system "$SERVICE_USER"
  fi
  run_root useradd --system --create-home --gid "$SERVICE_USER" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
provision_postgresql
POSTGRES_RUNTIME_URL="$(run_root awk -F= '/^POSTGRES_RUNTIME_URL=/{sub(/^[^=]*=/,""); print}' /etc/fortigate-backup/postgres.env)"
POSTGRES_MIGRATION_URL="$(run_root awk -F= '/^POSTGRES_MIGRATION_URL=/{sub(/^[^=]*=/,""); print}' /etc/fortigate-backup/postgres.env)"
eval "POSTGRES_RUNTIME_URL=$POSTGRES_RUNTIME_URL"
eval "POSTGRES_MIGRATION_URL=$POSTGRES_MIGRATION_URL"

if run_root "$SYSTEMCTL" is-active --quiet fortigate-backup-update.service 2>/dev/null; then
  fail "an application update is currently running."
fi
run_root "$SYSTEMCTL" stop fortigate-backup-update-maintenance.service fortigate-backup-worker.service fortigate-backup.service 2>/dev/null || true

run_root mkdir -p "$APP_DIR"
if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
  RSYNC_EXCLUDES=(
    "--exclude=.env"
    "--exclude=*.db"
    "--exclude=*.db-*"
    "--exclude=data/"
    "--exclude=backups/"
    "--exclude=logs/"
    "--exclude=uploads/"
    "--exclude=secrets/"
    "--exclude=keys/"
    "--exclude=node_modules/"
    "--exclude=.next/"
  )
  run_root rsync -a --delete --delete-delay "${RSYNC_EXCLUDES[@]}" "$SOURCE_DIR/" "$APP_DIR/"
else
  echo "Source and APP_DIR are identical; source synchronization is not required."
fi

run_root mkdir -p \
  "$APP_DIR/data/backups" \
  "$APP_DIR/data/self-backups" \
  "$APP_DIR/data/logs" \
  "$APP_DIR/data/temp" \
  "$APP_DIR/data/update-runtime" \
  "$APP_DIR/uploads"
run_root chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_DIR"
install_maintenance_runtime

if [ ! -f "$APP_DIR/.env" ]; then
  run_root install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0600 "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "Created $APP_DIR/.env from .env.example."
fi
normalize_env_file
echo "Validated .env; only DATABASE_URL, NEXTAUTH_SECRET and ENCRYPTION_KEY are retained."

cd "$APP_DIR"
run_as_service_user pnpm install --frozen-lockfile
run_as_service_user env DATABASE_URL="$POSTGRES_MIGRATION_URL" CHECKPOINT_DISABLE=1 pnpm prisma migrate deploy
run_as_service_user psql "$POSTGRES_MIGRATION_URL" --set=ON_ERROR_STOP=1 --quiet --command='GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO fortibackup_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO fortibackup_app;'
run_as_service_user env NEXT_TELEMETRY_DISABLED=1 pnpm exec next telemetry disable >/dev/null
run_as_service_user pnpm run build

render_systemd_unit fortigate-backup.service
render_systemd_unit fortigate-backup-worker.service
render_systemd_unit fortigate-backup-update.service
render_systemd_unit fortigate-backup-update-maintenance.service
install_sudoers_rule
validate_systemd_units

run_root "$SYSTEMCTL" daemon-reload
run_root "$SYSTEMCTL" enable fortigate-backup.service fortigate-backup-worker.service
run_root "$SYSTEMCTL" start fortigate-backup.service
run_root "$SYSTEMCTL" is-active --quiet fortigate-backup.service
run_as_service_user pnpm run health -- \
  --initial-delay-ms=5000 \
  --retries=30 \
  --retry-delay-ms=2000 \
  --timeout-ms=5000

run_as_service_user pnpm setup:link
run_root "$SYSTEMCTL" start fortigate-backup-worker.service
run_root "$SYSTEMCTL" is-active --quiet fortigate-backup-worker.service

echo "Setup complete. Use the one-time setup path printed above."
