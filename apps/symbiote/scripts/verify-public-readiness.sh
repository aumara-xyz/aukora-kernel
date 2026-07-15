#!/usr/bin/env bash
# verify-public-readiness.sh — the seed's leak gate.
# Ported (tiered) from aukora-os/PUBLISH_DENYLIST.md. Run BEFORE any commit and before any remote.
#
# TIER 1 (HARD FAIL → exit 1): genuine secrets, PII, prod/demo slugs, patent IP, personal paths,
#                              private-lane FILES. These must NEVER appear in the seed.
# TIER 2 (REPORT ONLY → exit 0 but loud): private research-lane codenames + provider strings that
#                              legitimately appear inside DEFENSIVE scrubber/denylist code. These are
#                              the pre-PUBLIC-release scrub worklist, not a private-commit blocker.
#
# Scope: the seed working tree, excluding .git, node_modules, lab_only, state, and the scan scripts
# themselves (which necessarily contain every pattern).
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Scan ONLY the committable set when inside Git (git-tracked + untracked-but-not-ignored). This makes the
# normal gate judge exactly what git would PUBLISH — so gitignored, regenerable artifacts (graphify-out/,
# node_modules/, state/, lab_only/) are never flagged, and the scan can never false-positive on something
# git won't ship.
#
# Outside Git (e.g. a GitHub ZIP), the old git ls-files path could scan nothing and falsely print "clean".
# Default behavior is now fail-closed. Release/archive scanners may opt into the audited find fallback by
# setting AUKORA_PUBLIC_READINESS_ALLOW_FIND=1 after extracting a package.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SCAN_MODE="git"
elif [ "${AUKORA_PUBLIC_READINESS_ALLOW_FIND:-}" = "1" ]; then
  SCAN_MODE="find"
else
  echo "RESULT: ✗ NOT READY — not a Git worktree; cannot determine publish set."
  echo "Use a real clone for development/live apply, or scan a release archive via scripts/scan-release-archive.sh."
  exit 1
fi

_files_git() { git ls-files --cached --others --exclude-standard 2>/dev/null | grep -vE 'verify-public-readiness\.sh|scan-secrets\.sh'; }
_files_find() {
  find . \
    \( -path './.git' -o -path './.git/*' \
       -o -path './node_modules' -o -path './node_modules/*' \
       -o -path './lab_only' -o -path './lab_only/*' \
       -o -path './state' -o -path './state/*' \
       -o -path './graphify-out' -o -path './graphify-out/*' \) -prune \
    -o -type f -print \
    | sed 's#^\./##' \
    | grep -vE 'verify-public-readiness\.sh|scan-secrets\.sh'
}
_files() {
  if [ "$SCAN_MODE" = "git" ]; then _files_git; else _files_find; fi
}
FILES_ALL="$(_files)"
FILES_KEY="$(_files | grep -vE '\.test\.ts$|risk-vectors\.json$')"  # keys: skip the detector's own fake fixtures

scan()  { [ -n "$FILES_ALL" ] && printf '%s\n' "$FILES_ALL" | tr '\n' '\0' | xargs -0 grep -nIE "$1" /dev/null 2>/dev/null; }
# scank: real-KEY scan that skips the secret-detector's own fake fixtures (*.test.ts + risk-vectors.json).
scank() { [ -n "$FILES_KEY" ] && printf '%s\n' "$FILES_KEY" | tr '\n' '\0' | xargs -0 grep -nIE "$1" /dev/null 2>/dev/null; }

FAIL=0
echo "═══════════════════════════════════════════════════════════"
echo " TIER 1 — HARD FAIL (genuine leaks; must be empty to commit)"
echo "═══════════════════════════════════════════════════════════"

# Real-key patterns: skip detector fixtures. (A REAL key landing in a fixture is a different problem.)
declare -a T1KEYS=(
  "private key PEM|-----BEGIN[A-Z ]*PRIVATE KEY-----"
  "real OpenRouter key|sk-or-v1-[A-Za-z0-9_-]{20,}"
  "real Anthropic key|sk-ant-[A-Za-z0-9_-]{20,}"
  "real GitHub PAT|ghp_[A-Za-z0-9]{36}"
  "AWS access key (non-EXAMPLE)|AKIA[A-Z0-9]{16}"
)
for entry in "${T1KEYS[@]}"; do
  label="${entry%%|*}"; rx="${entry#*|}"
  hits="$(scank "$rx" | grep -vE 'EXAMPLE|TESTONLY|leaked|MOCK|DEMO')"
  if [ -n "$hits" ]; then echo "  ✗ $label"; echo "$hits" | sed 's/^/      /'; FAIL=1; fi
done

# PII / path / slug / patent: scan EVERYTHING (these must not appear even in fixtures).
# The owner's identity anchors, prod slugs, and patent refs live OUTSIDE git (scripts/scan-vectors.local.sh,
# gitignored) so the committed/published scanner contains NO real names or host paths — the detector must not
# be the leak. Without the local file (e.g. a fresh public clone) these owner-private checks are skipped; a
# clone has no reason to scan for the owner's identity. See scan-vectors.local.sh.example for the shape.
declare -a T1PII=()
VECTORS_FILE="${AUKORA_SCAN_VECTORS_FILE:-$REPO/scripts/scan-vectors.local.sh}"
if [ -f "$VECTORS_FILE" ]; then
  # shellcheck disable=SC1091
  source "$VECTORS_FILE"   # appends owner-private vectors to T1PII
else
  echo "  • owner-private PII/slug/patent vectors not loaded (scripts/scan-vectors.local.sh absent) — those checks skipped"
fi
set +u
for entry in "${T1PII[@]}"; do
  label="${entry%%|*}"; rx="${entry#*|}"
  hits="$(scan "$rx")"
  if [ -n "$hits" ]; then echo "  ✗ $label"; echo "$hits" | sed 's/^/      /'; FAIL=1; fi
done
set -u

# Private-lane FILES must not exist in the committable set.
# ONE ratified exception: docs/NEBIUS_DEPLOY_PRACTICE.md shipped deliberately on main via PR #123
# (ledger-first deploy practice; content-reviewed, no secrets/slugs — the LANE was private, this
# operational doc is not). Every other /nebius/i path still hard-fails. If the owner prefers a
# rename over this exception, delete this allowlist line with the rename.
NEB="$(printf '%s\n' "$FILES_ALL" | grep -iE '(^|/)nebius' | grep -vxF 'docs/NEBIUS_DEPLOY_PRACTICE.md')"
if [ -n "$NEB" ]; then echo "  ✗ private-lane file present:"; echo "$NEB" | sed 's/^/      /'; FAIL=1; fi

[ "$FAIL" -eq 0 ] && echo "  ✓ clean — no TIER 1 leaks"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " TIER 2 — REPORT ONLY (pre-public-release scrub worklist)"
echo "═══════════════════════════════════════════════════════════"
declare -a T2=(
  "research lane: vymakira/vyomakira|[Vv]y\.?o?makira"
  "research lane: kronos|[Kk]ronos"
  "research lane: b5lite/babyModel|b5lite|babyModel"
  "research lane: dojo|[^a-z]dojo"
  "research lane: feral|feral"
  "research lane: harvester|harvester"
  "research lane: Lightseed/saber/aukora_blade|[Ll]ightseed|aukora_blade"
  "banned: paladin|[Pp]aladin"
  "provider: Nebius|Nebius"
  "provider: OpenRouter|[Oo]penrouter|openrouter\.ai"
  "old shell name: trinity|aukora-trinity"
  "owner first-name: Peter (rename awaiting-peter->owner)|[^a-z]Peter[^a-z]"
)
for entry in "${T2[@]}"; do
  label="${entry%%|*}"; rx="${entry#*|}"
  n="$(scan "$rx" | wc -l | tr -d ' ')"
  [ "$n" -gt 0 ] && printf "  • %-45s %s hit(s)\n" "$label" "$n"
done
echo "    (TIER 2 are mostly defensive scrubber definitions + the convex inventory file;"
echo "     scrub/generalize before any PUBLIC release — not a private-commit blocker.)"

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "RESULT: ✗ NOT READY — TIER 1 leaks present. Do not commit."
  exit 1
fi
echo "RESULT: ✓ TIER 1 CLEAN — safe for a private (no-remote) commit. TIER 2 worklist remains for public release."
exit 0
