#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO/core"
[ -d node_modules ] || bun install
exec bun src/kiraCli.ts "$@"
