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
sudo chown "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/.env"
sudo chmod 600 "$APP_DIR/.env"
echo "Generated missing NEXTAUTH_SECRET and ENCRYPTION_KEY values in $APP_DIR/.env."

cd "$APP_DIR"
sudo -u "$SERVICE_USER" corepack enable
sudo -u "$SERVICE_USER" pnpm install --frozen-lockfile
sudo -u "$SERVICE_USER" pnpm prisma migrate deploy
sudo -u "$SERVICE_USER" pnpm run build

sudo cp systemd/fortigate-backup.service /etc/systemd/system/fortigate-backup.service
sudo cp systemd/fortigate-backup-worker.service /etc/systemd/system/fortigate-backup-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now fortigate-backup fortigate-backup-worker

echo "Setup complete. Open http://localhost:3000/setup"
