#!/usr/bin/env sh
set -u

# Run from this script's directory so relative paths always work.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Default to OpenRouter by reading API key from local key file when needed.
OPENROUTER_KEY_FILE="$SCRIPT_DIR/open-router.key"
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f "$OPENROUTER_KEY_FILE" ]; then
  OPENROUTER_API_KEY="$(tr -d '\r\n' < "$OPENROUTER_KEY_FILE")"
  export OPENROUTER_API_KEY
fi

RAW_DATE="$(date +%F)"

echo "[1/3] Pulling all projects..."
if node pull.js; then
  echo "Pull step finished successfully."
else
  echo "Pull step finished with some errors; continuing to summarization."
fi

echo "[2/3] Collecting raw logs only (last 7 days)..."
node summarize.js --days 7 --raw-only "$@"

echo "[3/3] Summarizing from raw logs with OpenRouter..."
node summarize.js --ai-only --raw-date "$RAW_DATE" --provider openrouter "$@"
