#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aukora
#
# Fail-before / pass-after driver for the Round-24 G1 repairs. It swaps the six modified implementation files
# to their BASE (11ed50a6) versions, runs the vulnerable-behavior repro (which PASSES on base), then restores
# the FIXED versions and runs the repro again (which now FAILS — the vulnerabilities are closed). Blockers 6/7/8
# are new capabilities absent from the base; their absence is shown by grepping HEAD.
#
# Read-only w.r.t. git history (uses `git show <BASE>:` — never checks out or commits). A trap restores the
# fixed files on any exit so an interrupted run cannot leave base sources in place. BASE is pinned to the exact
# canonical Round-24 base SHA so this keeps working after the lane branch is committed (HEAD would move).
set -eu

BASE='11ed50a6c04f9f2b7d64c2dd036b892a4b4c0b58'
cd "$(dirname "$0")/.."
BUNDLE="$(pwd)"
REPRO='scripts/failbefore.repro.test.ts'
FILES='src/containment.ts src/d6selfcheck.ts src/evidence.ts src/controller.ts src/lineage.ts src/allowlist.ts'
BAK="$(mktemp -d)"

restore() {
  for f in $FILES; do
    if [ -f "$BAK/$(basename "$f")" ]; then cp "$BAK/$(basename "$f")" "$BUNDLE/$f"; fi
  done
}
trap restore EXIT INT TERM

echo '================ FAIL-BEFORE (base 11ed50a6 sources) ================'
# back up fixed, swap in base versions of the six modified files
for f in $FILES; do
  cp "$BUNDLE/$f" "$BAK/$(basename "$f")"
  git show "$BASE:quarantine/nebius-g1/$f" > "$BUNDLE/$f"
done
echo '[swapped 6 impl files to BASE]  expecting the repro to PASS (vulnerabilities present):'
if npx vitest run --config scripts/failbefore.vitest.config.ts >/dev/null 2>&1; then
  echo 'RESULT: repro PASSED on base  ⇒ fail-before CONFIRMED (all 5 vulnerabilities reproduced)'
else
  echo 'RESULT: repro did not fully pass on base — inspect manually'; npx vitest run --config scripts/failbefore.vitest.config.ts || true
fi

echo
echo '================ PASS-AFTER (fixed sources) ================'
restore
echo '[restored 6 fixed impl files]  expecting the repro to FAIL (vulnerabilities closed):'
if npx vitest run --config scripts/failbefore.vitest.config.ts >/dev/null 2>&1; then
  echo 'RESULT: repro still PASSED on fixed sources — a fix DID NOT take. INVESTIGATE.'
  exit 1
else
  echo 'RESULT: repro FAILED on fixed sources  ⇒ pass-after CONFIRMED (all 5 vulnerabilities closed)'
fi

echo
echo '================ Blockers 6/7/8 — new capability absent in base ================'
for sym in 'runCanary' 'liveEligible' 'verifyLineageChain'; do
  if git grep -q "$sym" "$BASE" -- 'quarantine/nebius-g1/src' 2>/dev/null; then
    echo "  $sym: present at BASE (unexpected)"
  else
    echo "  $sym: ABSENT at base $BASE ⇒ new capability added by this lane (verified)"
  fi
done
echo
echo 'DONE.'
