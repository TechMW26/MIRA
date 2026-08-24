#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

for command in systemctl curl ollama; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 1
  fi
done

if ! systemctl cat ollama.service >/dev/null 2>&1; then
  echo "ollama.service is not installed. Install Ollama before this watchdog." >&2
  exit 1
fi

install -d -m 0755 /etc/mira /etc/systemd/system/ollama.service.d
install -m 0755 "$SCRIPT_DIR/ollama-watchdog.sh" /usr/local/sbin/mira-ollama-watchdog
install -m 0644 "$SCRIPT_DIR/systemd/ollama-mira.conf" /etc/systemd/system/ollama.service.d/mira.conf
install -m 0644 "$SCRIPT_DIR/systemd/mira-ollama-watchdog.service" /etc/systemd/system/mira-ollama-watchdog.service
install -m 0644 "$SCRIPT_DIR/systemd/mira-ollama-watchdog.timer" /etc/systemd/system/mira-ollama-watchdog.timer

if [[ ! -f /etc/mira/ollama-watchdog.env ]]; then
  install -m 0644 "$SCRIPT_DIR/ollama-watchdog.env.example" /etc/mira/ollama-watchdog.env
fi

systemctl daemon-reload
systemctl enable --now ollama.service
systemctl enable --now mira-ollama-watchdog.timer
systemctl start mira-ollama-watchdog.service

systemctl --no-pager --full status ollama.service mira-ollama-watchdog.timer
