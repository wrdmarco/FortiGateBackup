#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/fortigate-backup}"

run_root() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_root systemctl stop fortigate-backup-update.service 2>/dev/null || true
run_root systemctl stop fortigate-backup-update-maintenance.service 2>/dev/null || true
run_root systemctl disable --now fortigate-backup-worker.service fortigate-backup.service 2>/dev/null || true
run_root rm -f \
  /etc/systemd/system/fortigate-backup.service \
  /etc/systemd/system/fortigate-backup-worker.service \
  /etc/systemd/system/fortigate-backup-update.service \
  /etc/systemd/system/fortigate-backup-update-maintenance.service \
  /etc/sudoers.d/fortigate-backup-update
run_root systemctl daemon-reload
run_root systemctl reset-failed \
  fortigate-backup.service \
  fortigate-backup-worker.service \
  fortigate-backup-update.service \
  fortigate-backup-update-maintenance.service 2>/dev/null || true

echo "Services and update privileges removed. Application data remains in $APP_DIR."
