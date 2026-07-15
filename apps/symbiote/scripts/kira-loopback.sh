#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.bun/bin"
cd "$REPO/core"
[ -d node_modules ] || bun install
cd "$REPO"
exec bun scripts/kiraLoopbackCli.ts "$@"
