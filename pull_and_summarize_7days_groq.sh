#!/usr/bin/env sh
set -u

# Run from this script's directory so relative paths always work.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Default to Groq by reading API key from local key file when needed.
GROQ_KEY_FILE="$SCRIPT_DIR/groq.key"
if [ -z "${GROQ_API_KEY:-}" ] && [ -f "$GROQ_KEY_FILE" ]; then
  GROQ_API_KEY="$(tr -d '\r\n' < "$GROQ_KEY_FILE")"
  export GROQ_API_KEY
fi

RAW_DATE="$(date +%F)"

echo "[1/3] Pulling all projects..."
echo "Pull step finished successfully."

echo "[2/3] Collecting raw logs only (last 7 days)..."
# node summarize.js --days 7 --raw-only "$@"

echo "[3/3] Summarizing from raw logs with Groq..."
node summarize.js --ai-only --raw-date "$RAW_DATE" --provider groq "$@"
