#!/usr/bin/env bash
# regenerate-gate-integrity.sh — DELIBERATE operator re-stamp of the gate byte-pin.
#
# The pin (authority/gate/.gate-integrity.sha256) is tamper-EVIDENCE: `scripts/status.sh` verifies it and
# reports MISMATCH if any pinned file's bytes changed. It covers two gate surfaces:
#   • the external Claude-gate files that live in authority/gate/ (stable), and
#   • the live-apply gate ENFORCEMENT CLOSURE in core/src/ (actively developed) — added 2026-07-04 to close
#     the "one-signature gate self-unlock" finding (the hardcoded fence in nativeLiveApply.ts is the actual
#     prevention; this pin is the witness).
#
# Because the second set changes on legitimate edits, this script re-stamps the pin — run it ONLY after a
# deliberate, reviewed edit to one of these files (mirrors the execs-manifest re-stamp model). An attacker
# cannot re-stamp: a signed proposal can write NEITHER these files (fenced in nativeLiveApply.ts) NOR this pin
# (authority/ is fenced), so a status MISMATCH is a real unauthorized-edit signal, not routine drift.
#
# NOTE: this is DETECTION (status witness), not launch-blocking prevention. Nothing gates execution on the pin.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$REPO/authority/gate"

# Paths are stored RELATIVE TO $GATE (status.sh runs `cd "$GATE" && shasum -c`): the external files are bare
# names; the core/src enforcement closure is reached via ../../ so the same relative form round-trips on verify.
GATE_LOCAL=(risk.ts aukoraGate.ts opencodeAskBridge.ts governedToolBoundary.ts types.ts risk-vectors.json sensitivePolicy.ts)
LIVE_APPLY_CLOSURE=(
  ../../core/src/nativeLiveApply.ts
  ../../core/src/kernelActionClassifier.ts
  ../../core/src/appliedProposalLedger.ts
  ../../core/src/policyKernel.ts
  ../../core/src/proposalHash.ts
  ../../core/src/aumlokAuthorityRoot.ts
  ../../core/src/sandboxApply.ts
)

cd "$GATE"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
for f in "${GATE_LOCAL[@]}" "${LIVE_APPLY_CLOSURE[@]}"; do
  if [ ! -f "$f" ]; then echo "MISSING pinned file: $f" >&2; exit 1; fi
  shasum -a 256 "$f" >> "$tmp"
done
mv "$tmp" .gate-integrity.sha256
trap - EXIT
echo "re-stamped authority/gate/.gate-integrity.sha256 ($(wc -l < .gate-integrity.sha256 | tr -d ' ') files)"
