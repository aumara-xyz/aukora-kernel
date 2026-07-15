#!/usr/bin/env bash
# self-mod-readiness.sh — the honest self-modification readiness ladder. Shows EXACTLY what stands between
# "she can rehearse changing herself in a padded room" (built) and "she can change her real body after a
# human signature" (NOT built). Advisory only: grants no authority, wires nothing, applies nothing live.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.bun/bin"
cd "$REPO/core"
[ -d node_modules ] || bun install >/dev/null 2>&1

if [ "${1:-}" = "--json" ]; then
  bun -e 'import {collectSelfModReadiness} from "./src/selfModReadiness"; console.log(JSON.stringify(collectSelfModReadiness(), null, 2));'
  exit 0
fi

bun -e 'import {collectSelfModReadiness, formatSelfModReadiness} from "./src/selfModReadiness"; console.log(formatSelfModReadiness(collectSelfModReadiness()).join("\n"));'
