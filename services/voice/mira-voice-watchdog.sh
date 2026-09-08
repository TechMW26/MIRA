#!/usr/bin/env bash
set -u

state_file=/run/mira-voice-watchdog.failures
failures=0
if [[ -r "$state_file" ]]; then
  read -r failures < "$state_file" || failures=0
fi

if curl --fail --silent --show-error --max-time 8 http://127.0.0.1:8765/health >/dev/null; then
  printf '0\n' > "$state_file"
  exit 0
fi

failures=$((failures + 1))
printf '%s\n' "$failures" > "$state_file"
if (( failures >= 3 )); then
  systemctl restart mira-voice.service
  printf '0\n' > "$state_file"
fi
