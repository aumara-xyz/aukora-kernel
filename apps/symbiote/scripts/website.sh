#!/usr/bin/env bash
# website.sh — starts the Aukora OS landing page server on port 7080
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
PORT="${AUKORA_WEB_PORT:-7080}"

echo "🌱 Starting Aukora OS Web Preview on http://localhost:$PORT"
exec bun "$REPO/website/serve.ts"
