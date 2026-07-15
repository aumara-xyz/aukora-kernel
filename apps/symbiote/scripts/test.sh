#!/usr/bin/env bash
# test.sh — the TRUTHFUL behavior gate. Exits non-zero if EITHER the typecheck OR the headless behavior
# suite fails. (It used to exit on tsc errors only — a lying gate; fixed per the Fusion Council amendment.)
# Host-integration tests live in ../deferred-tests/ and are visible debt, not part of this gate.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.bun/bin"
cd "$REPO/core"
[ -d node_modules ] || bun install

echo "── typecheck (tsc --noEmit) ─────────────────────────────"
tsc_out="$(bun x tsc --noEmit 2>&1)"; tsc_rc=$?   # EXIT CODE is the source of truth — a grep count "passes" if tsc never runs
tsc_err="$(echo "$tsc_out" | grep -c 'error TS' || true)"
echo "  tsc: exit=$tsc_rc · error-lines=$tsc_err   (exit MUST be 0 — if tsc can't run, the gate fails)"
[ "$tsc_rc" -ne 0 ] && echo "$tsc_out" | grep -iE 'error TS|error|not found|cannot' | head -10 | sed 's/^/    /'

# Issue #68: gate the spatial/ door code too. core/tsconfig only covers src/**/tests/**, so spatial/*.ts
# (the chat door, voice lane) was never typechecked — a bug class that bit twice in chat-serve.ts
# (an undefined `input` var, a dropped `VoiceAttachment` import) slipped past both tsc and vitest. A
# minimal Bun shim (spatial/bun-env.d.ts) lets this run without the full @types/bun dependency.
echo "── spatial typecheck (tsc -p spatial/tsconfig.json) ─────"
# Run from core/ (already cd'd here) so it uses core's INSTALLED tsc — no network fetch in a fresh clone.
sp_out="$(bun x tsc --noEmit -p "$REPO/spatial/tsconfig.json" 2>&1)"; sp_rc=$?
sp_err="$(echo "$sp_out" | grep -c 'error TS' || true)"
echo "  spatial tsc: exit=$sp_rc · error-lines=$sp_err"
[ "$sp_rc" -ne 0 ] && echo "$sp_out" | grep -iE 'error TS' | head -10 | sed 's/^/    /'

echo "── release package check (fresh-clone assets) ───────────"
pkg_out="$(bun "$REPO/scripts/verify-release-package.ts" 2>&1)"; pkg_rc=$?
echo "  release package: exit=$pkg_rc"
[ "$pkg_rc" -ne 0 ] && echo "$pkg_out" | sed 's/^/    /'

echo ""
echo "── headless behavior tests (vitest under node) ──────────"
vt_exit=0
if command -v node >/dev/null 2>&1; then
  node ./node_modules/vitest/vitest.mjs run --pool=forks > /tmp/aukora-vitest.txt 2>&1; vt_exit=$?
  grep -E "Test Files|Tests " /tmp/aukora-vitest.txt | tail -2 | sed 's/^/  /'
  [ "$vt_exit" -ne 0 ] && grep -E "FAIL " /tmp/aukora-vitest.txt | head -10 | sed 's/^/  /'
else
  echo "  node not found — cannot run behavior tests"; vt_exit=1
fi

DEF=$(find "$REPO/deferred-tests" -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "  deferred (host-coupled) test debt: $DEF files — visible in deferred-tests/README.md"

echo ""
if [ "$tsc_rc" -eq 0 ] && [ "$sp_rc" -eq 0 ] && [ "$pkg_rc" -eq 0 ] && [ "$vt_exit" -eq 0 ]; then
  echo "  GATE: ✓ headless suite GREEN (core typecheck + spatial typecheck + release package + behavior)."
  exit 0
fi
echo "  GATE: ✗ NOT GREEN — a typecheck, release package check, or behavior test failed."
exit 1
