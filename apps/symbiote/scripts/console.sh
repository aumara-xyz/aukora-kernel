#!/usr/bin/env bash
# console.sh — the Builder Console (dev tooling; NOT the organism). Split-screen:
#   left = source of truth (Path · Inbox · Laws · Status), right = the brain import-graph.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
PORT="${AUKORA_CONSOLE_PORT:-7070}"

# build the brain graph if it's missing and graphify is available
if [ ! -f "$REPO/graphify-out/graph.html" ] && command -v graphify >/dev/null 2>&1; then
  echo "building brain graph (offline)…"
  ( cd "$REPO" && graphify update . >/dev/null 2>&1 ) || true
fi

echo "🌱 Aukora Symbiote console → http://localhost:$PORT"
echo "🎙  First Contact console → http://localhost:$PORT/first-contact"
exec bun "$REPO/dashboard/serve.ts"
