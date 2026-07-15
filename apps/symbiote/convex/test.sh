#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aukora
# S1a — standalone test runner for the vendored kernel slice. No deployment, no real keys:
#   ./test.sh   (from anywhere; exits nonzero on any failure)
set -eu
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  if command -v bun >/dev/null 2>&1; then bun install; else npm install --no-audit --no-fund; fi
fi

# _generated/: replicated from the donor repo, which COMMITS _generated (the donor flow). `npx convex codegen`
# refuses to run without a configured deployment (CONVEX_DEPLOYMENT), and this slice is deliberately standalone,
# so codegen is only attempted as a fallback if the checked-in _generated ever goes missing.
if [ ! -f _generated/api.js ]; then
  npx convex codegen
fi

npx vitest run
