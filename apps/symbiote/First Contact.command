#!/usr/bin/env bash
# First Contact.command — double-click launcher. It runs the ONE canonical runtime entry point,
# `bun run start` (scripts/start-node.ts): brings up the local brain + servers and opens the
# Spatial app at http://127.0.0.1:7090, where First Contact plays. There is no second console:
# the old read-only 7071 dashboard is not started here. Live promotion stays LOCKED regardless —
# this only starts the app, nothing more.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh, then run this again."
  echo "(Tip: run 'bun run doctor' once Bun is installed for a full preflight.)"
  exit 1
fi
exec bun run start
