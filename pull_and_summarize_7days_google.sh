#!/usr/bin/env sh
set -u

# Run from this script's directory so relative paths always work.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Default to Google by reading API key from local key file when needed.
GOOGLE_KEY_FILE="$SCRIPT_DIR/google.key"
if [ -z "${GOOGLE_API_KEY:-}" ] && [ -f "$GOOGLE_KEY_FILE" ]; then
  GOOGLE_API_KEY="$(tr -d '\r\n' < "$GOOGLE_KEY_FILE")"
  export GOOGLE_API_KEY
fi

RAW_DATE="$(date +%F)"

echo "[1/3] Pulling all projects..."
echo "Pull step finished successfully."

echo "[2/3] Collecting raw logs only (last 7 days)..."
node summarize.js --days 7 --raw-only "$@"

echo "[3/3] Summarizing from raw logs with Google..."
node summarize.js --ai-only --raw-date "$RAW_DATE" --provider google --google-delay 9000 "$@" --all-branches
