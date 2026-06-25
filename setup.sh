#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fortigate-backup}"
SERVICE_USER="${SERVICE_USER:-fortigate-backup}"

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  else
    echo "openssl or python3 is required to generate secure setup secrets." >&2
    exit 1
  fi
}

set_env_if_blank() {
  local key="$1"
  local value="$2"
  local env_file="$APP_DIR/.env"

  if sudo grep -Eq "^${key}=" "$env_file"; then
    if sudo grep -Eq "^${key}=\"?\"?$" "$env_file"; then
      sudo sed -i "s|^${key}=.*|${key}=\"${value}\"|" "$env_file"
    fi
  else
    printf '%s="%s"\n' "$key" "$value" | sudo tee -a "$env_file" >/dev/null
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  local env_file="$APP_DIR/.env"

  if sudo grep -Eq "^${key}=" "$env_file"; then
    sudo awk -v key="$key" -v value="$value" '
      BEGIN { replacement = key "=\"" value "\"" }
      $0 ~ "^" key "=" { print replacement; next }
      { print }
    ' "$env_file" | sudo tee "$env_file.tmp" >/dev/null
    sudo mv "$env_file.tmp" "$env_file"
  else
    printf '%s="%s"\n' "$key" "$value" | sudo tee -a "$env_file" >/dev/null
  fi
}

normalize_server_url() {
  local value="$1"
  value="${value%/}"
  if [ -z "$value" ]; then
    echo ""
    return
  fi
  case "$value" in
    https://*) echo "$value" ;;
    http://*) echo "https://${value#http://}" ;;
    *) echo "https://$value" ;;
  esac
}


install_sudoers_rule() {
  local sudoers_file="/etc/sudoers.d/fortigate-backup-update"
  local systemctl_path
  systemctl_path="$(command -v systemctl || echo /usr/bin/systemctl)"

  sudo tee "$sudoers_file" >/dev/null <<EOF
# Allow the FortiGate Backup portal to activate completed application updates only.
$SERVICE_USER ALL=(root) NOPASSWD: $systemctl_path daemon-reload
$SERVICE_USER ALL=(root) NOPASSWD: $systemctl_path restart fortigate-backup
$SERVICE_USER ALL=(root) NOPASSWD: $systemctl_path restart fortigate-backup-worker
$SERVICE_USER ALL=(root) NOPASSWD: $systemctl_path restart fortigate-backup fortigate-backup-worker
EOF
  sudo chmod 440 "$sudoers_file"
  if command -v visudo >/dev/null 2>&1; then
    sudo visudo -cf "$sudoers_file" >/dev/null
  fi
}
prompt_server_url() {
  local env_file="$APP_DIR/.env"
  local current
  local requested

  current="$(sudo sed -n 's/^SERVER_URL=//p' "$env_file" | tail -n 1 | sed 's/^"//; s/"$//')"
  if [ -n "${SERVER_URL:-}" ]; then
    requested="$SERVER_URL"
  elif [ -t 0 ]; then
    if [ -n "$current" ]; then
      read -r -p "Publieke server URL [$current]: " requested
      requested="${requested:-$current}"
    else
      read -r -p "Publieke server URL (bijv. firewallbackup.example.nl): " requested
    fi
  else
    requested="$current"
  fi

  set_env_value "SERVER_URL" "$(normalize_server_url "$requested")"
}

if [ ! -f package.json ]; then
  echo "Run setup.sh from the APP directory."
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  sudo useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude node_modules --exclude .next ./ "$APP_DIR"/
sudo mkdir -p "$APP_DIR/data/backups" "$APP_DIR/data/self-backups" "$APP_DIR/data/logs" "$APP_DIR/data/temp"
sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  sudo cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "Created $APP_DIR/.env from .env.example."
fi

set_env_if_blank "NEXTAUTH_SECRET" "$(generate_secret)"
set_env_if_blank "ENCRYPTION_KEY" "$(generate_secret)"
prompt_server_url
sudo chown "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/.env"
sudo chmod 600 "$APP_DIR/.env"
echo "Updated SERVER_URL and generated missing NEXTAUTH_SECRET and ENCRYPTION_KEY values in $APP_DIR/.env."

cd "$APP_DIR"
sudo -u "$SERVICE_USER" corepack enable
sudo -u "$SERVICE_USER" pnpm install --frozen-lockfile
sudo -u "$SERVICE_USER" pnpm prisma migrate deploy
sudo -u "$SERVICE_USER" pnpm run build

sudo cp systemd/fortigate-backup.service /etc/systemd/system/fortigate-backup.service
sudo cp systemd/fortigate-backup-worker.service /etc/systemd/system/fortigate-backup-worker.service
install_sudoers_rule
sudo systemctl daemon-reload
sudo systemctl enable --now fortigate-backup fortigate-backup-worker

FINAL_SERVER_URL="$(sudo sed -n 's/^SERVER_URL=//p' "$APP_DIR/.env" | tail -n 1 | sed 's/^"//; s/"$//')"
if [ -n "$FINAL_SERVER_URL" ]; then
  echo "Setup complete. Open $FINAL_SERVER_URL/setup"
else
  echo "Setup complete. Open http://localhost:3000/setup"
fi
