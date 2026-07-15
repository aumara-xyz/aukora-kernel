#!/bin/bash
# Zero-cloud Convex probe (Codex directive, 2026-07-05): fail if any hosted Convex
# URL appears in the brain path, or if a Convex client URL is non-loopback.
# Guard/deny-list/test files that BAN these strings are allowlisted by name.
#
# 2026-07-05 (Codex feedback): scan only GIT-TRACKED files under the brain dirs, enumerated via
# `git ls-files`. This is both more correct for a commit gate (only tracked files can be committed)
# and fixes a false-positive: an untracked local dependency dir like spatial/voice/.venv (a Python
# venv shipping SymPy docs whose text merely uses the English word "convex", e.g. a wikipedia URL
# about "convex functions") is not tracked, so it is no longer walked. Mirrors the ring-coverage
# checker, which is also git-ls-files-based.
set -uo pipefail
cd "$(dirname "$0")/.."
ALLOW='core/src/forbiddenContent.ts|core/src/convexBrainReadonly.ts|core/src/convexTopology.ts|docs/|deferred-tests/|core/tests/|node_modules/|_generated/|package-lock.json|bun.lock'
DIRS='core/src spatial memory convex scripts'
FAIL=0

# Tracked, text files under the brain dirs (NUL-safe), minus the allowlisted guard files.
FILES=$(git ls-files -z -- $DIRS | tr '\0' '\n' | grep -vE "$ALLOW" || true)
[ -z "$FILES" ] && { echo "OK: no tracked brain-path files to scan"; exit 0; }

HITS=$(printf '%s\n' "$FILES" | xargs -I{} grep -HnE '\.convex\.(cloud|dev|site)' {} 2>/dev/null || true)
if [ -n "$HITS" ]; then echo "HOSTED CONVEX REFERENCE FOUND:"; echo "$HITS"; FAIL=1; fi

URLS=$(printf '%s\n' "$FILES" | xargs -I{} grep -HnoE 'https?://[^"'\''  ]*convex[^"'\''  ]*' {} 2>/dev/null \
  | grep -vE '127\.0\.0\.1|localhost' \
  | grep -vE 'github\.com/get-convex/convex-backend/releases/download' || true)
if [ -n "$URLS" ]; then echo "NON-LOOPBACK CONVEX URL FOUND:"; echo "$URLS"; FAIL=1; fi

if [ "$FAIL" -eq 0 ]; then echo "OK: no hosted Convex dependency in the brain path (loopback only)"; fi
exit $FAIL
