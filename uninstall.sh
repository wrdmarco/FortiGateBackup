#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fortigate-backup}"

sudo systemctl disable --now fortigate-backup fortigate-backup-worker || true
sudo rm -f /etc/systemd/system/fortigate-backup.service /etc/systemd/system/fortigate-backup-worker.service
sudo systemctl daemon-reload
echo "Services removed. Application data remains in $APP_DIR."
