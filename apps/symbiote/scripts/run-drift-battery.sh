#!/usr/bin/env bash
# Manual owner-invoked drift battery runner. This script can make billed
# OpenRouter calls only when both --live and AUKORA_DRIFT_SPEND=1 are present.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found on PATH" >&2
  exit 127
fi

exec bun scripts/run-drift-battery.ts "$@"
