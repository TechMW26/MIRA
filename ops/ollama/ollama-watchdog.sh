#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${MIRA_OLLAMA_ENV_FILE:-/etc/mira/ollama-watchdog.env}"
if [[ -r "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

OLLAMA_BASE_URL="${MIRA_OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
OLLAMA_MODEL="${MIRA_OLLAMA_MODEL:-mira:latest}"
HEALTH_ATTEMPTS="${MIRA_OLLAMA_HEALTH_ATTEMPTS:-3}"
RESTART_DELAY_SECONDS="${MIRA_OLLAMA_RESTART_DELAY_SECONDS:-4}"

if [[ ! "$OLLAMA_MODEL" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
  echo "Invalid MIRA_OLLAMA_MODEL value." >&2
  exit 2
fi

healthy() {
  curl --fail --silent --show-error --max-time 5 \
    "${OLLAMA_BASE_URL}/api/tags" >/dev/null
}

for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
  if healthy; then
    exit 0
  fi
  if (( attempt < HEALTH_ATTEMPTS )); then
    sleep 2
  fi
done

echo "Ollama health check failed; restarting ollama.service." >&2
systemctl restart ollama.service
sleep "$RESTART_DELAY_SECONDS"

if ! healthy; then
  echo "Ollama did not recover after restart." >&2
  exit 1
fi

# Load the configured model into GPU memory so the next user request does not
# pay the cold-start cost. A single token is enough to validate the runner.
curl --fail --silent --show-error --max-time 180 \
  --header 'Content-Type: application/json' \
  --data-binary "{\"model\":\"${OLLAMA_MODEL}\",\"prompt\":\"health\",\"stream\":false,\"keep_alive\":-1,\"options\":{\"num_predict\":1}}" \
  "${OLLAMA_BASE_URL}/api/generate" >/dev/null

echo "Ollama recovered and ${OLLAMA_MODEL} is warm."
