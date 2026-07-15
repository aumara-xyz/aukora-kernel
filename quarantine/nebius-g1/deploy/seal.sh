#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aukora
#
# G1 sealed-VM seal script. RUN ON THE VM, BY THE OPERATOR — never from the author's machine (the author
# has no shell on the VM). It makes the immutable core (D6 vendored evidence + evaluator/safety/controller/
# self-check) root-owned and read-only, verifies the deploy allowlist excludes key material, and REFUSES to
# proceed if any private-key / secret path is present in the staged bundle.
#
# Properties: POSIX sh; set -eu (fail-closed); idempotent (re-running converges to the same sealed state);
# LOUD (every refusal prints a marked banner and exits non-zero). It does NOT sign, apply, network, or grant
# any authority. It is a one-way ratchet toward "root-owned + read-only + (where supported) immutable".
#
# Immutability: chmod 0444 everywhere; PLUS chattr +i (Linux) or chflags uchg (macOS) where the tool exists.
# On Linux this is the real seal — the intended G1 host is a Linux L40S VM. macOS support is for local dry-runs.

set -eu

BUNDLE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALLOWLIST="$BUNDLE_ROOT/deploy/deploy-allowlist.json"

say()  { printf '%s\n' "$*"; }
banner(){ say "======================================================================"; say "  $*"; say "======================================================================"; }
abort() { banner "SEAL ABORTED (fail-closed): $*"; exit 1; }

# --- The immutable core. Every path here MUST exist; a missing target is fail-closed (never seal a partial
#     bundle). d6/** is expanded to its regular files below. ---
CORE_SINGLE="
src/evaluator.ts
src/safety.ts
src/controller.ts
src/d6selfcheck.ts
"

banner "G1 SEAL — bundle root: $BUNDLE_ROOT"

# --- 0. Must be root: chown 0:0 requires it, and the seal is meaningless otherwise. ---
if [ "$(id -u)" -ne 0 ]; then
  abort "must run as root (uid 0) to chown 0:0 the immutable core"
fi

# --- 1. Allowlist present and structurally excludes key material. ---
[ -f "$ALLOWLIST" ] || abort "deploy-allowlist.json not found at $ALLOWLIST"
for pat in '\*\*/\*\.key' 'id_ed25519' 'id_rsa' '\.ssh' '\*\.pem' '\.env' 'secret' 'authority-'; do
  if ! grep -Eq "$pat" "$ALLOWLIST"; then
    abort "deploy-allowlist.json deny list is missing an expected key-material pattern: $pat"
  fi
done
say "[ok] deploy-allowlist.json present and denies all key-material shapes"

# --- 2. REFUSE if any key-material path is actually staged in the bundle. ---
#     Scans the WHOLE bundle tree; the presence of even one is fatal. Patterns are single-quoted so the
#     shell never glob-expands them against the CWD before find sees them.
# -iname (case-insensitive, R24 amendment P2): on case-insensitive filesystems authority.KEY == authority.key,
# so a case-sensitive scan would miss a mis-cased key file. Match key-material shapes regardless of case.
FOUND_KEYS="$(cd "$BUNDLE_ROOT" && find . -type f \( \
  -iname '*.key' -o \
  -iname 'id_rsa*' -o \
  -iname 'id_ed25519*' -o \
  -iname '*.pem' -o \
  -iname '.env*' -o \
  -iname '*secret*' -o \
  -iname 'authority-*.key' -o \
  -ipath '*/.ssh/*' \
\) 2>/dev/null || true)"
if [ -n "$FOUND_KEYS" ]; then
  say "$FOUND_KEYS"
  abort "key-material path(s) present in the staged bundle (listed above) — remove before sealing"
fi
say "[ok] no key-material paths present in the staged bundle"

# --- 2.5 Enforce the runtime dependency closure (R23 blocker 5). The bundle must carry everything needed for a
#     reproducible install; a missing lockfile means the on-VM install is not pinned. Fail-closed. ---
CLOSURE="package.json package-lock.json tsconfig.json"
for f in $CLOSURE; do
  [ -f "$BUNDLE_ROOT/$f" ] || abort "runtime dependency closure incomplete: missing $f (refusing to seal)"
done
say "[ok] runtime dependency closure present ($CLOSURE)"

# --- 3. Verify every immutable-core target exists BEFORE sealing anything (fail-closed on partial bundle). ---
CORE_FILES=""
# d6 tracked tree — every regular file under d6/ is core.
for f in $(cd "$BUNDLE_ROOT" && find d6 -type f 2>/dev/null | LC_ALL=C sort); do
  CORE_FILES="$CORE_FILES $f"
done
for f in $CORE_SINGLE; do
  [ -n "$f" ] || continue
  CORE_FILES="$CORE_FILES $f"
done
for f in $CORE_FILES; do
  [ -f "$BUNDLE_ROOT/$f" ] || abort "immutable-core target missing: $f (refusing to seal a partial bundle)"
done
say "[ok] all immutable-core targets present"

# --- 4. Detect an immutability tool (idempotency needs to clear the flag before re-chmod/chown). ---
IMMUT_SET=""; IMMUT_CLEAR=""
if command -v chattr >/dev/null 2>&1; then
  IMMUT_SET="chattr +i"; IMMUT_CLEAR="chattr -i"
  say "[ok] using chattr +i for immutability (Linux)"
elif command -v chflags >/dev/null 2>&1; then
  IMMUT_SET="chflags uchg"; IMMUT_CLEAR="chflags nouchg"
  say "[warn] using chflags uchg (macOS) — for local dry-runs only; the real G1 host is Linux"
else
  say "[warn] no chattr/chflags found — sealing with chown 0:0 + chmod 0444 ONLY (no OS immutable flag)"
fi

# --- 5. Seal each core file. Idempotent: clear any existing immutable flag, chown 0:0, chmod 0444, re-set flag. ---
seal_one() {
  f="$1"; p="$BUNDLE_ROOT/$f"
  [ -n "$IMMUT_CLEAR" ] && $IMMUT_CLEAR "$p" 2>/dev/null || true   # tolerate "not currently immutable"
  chown 0:0 "$p"
  chmod 0444 "$p"
  [ -n "$IMMUT_SET" ] && $IMMUT_SET "$p" 2>/dev/null || true
}
for f in $CORE_FILES; do seal_one "$f"; done
say "[ok] sealed $(printf '%s\n' $CORE_FILES | grep -c .) immutable-core files (root:root, 0444, immutable-where-supported)"

# --- 6. Verify the seal (owner uid 0 + mode 444). Fail-closed if any target did not take. ---
verify_fail=0
for f in $CORE_FILES; do
  p="$BUNDLE_ROOT/$f"
  owner="$(stat -c '%u' "$p" 2>/dev/null || stat -f '%u' "$p" 2>/dev/null || echo '?')"
  mode="$(stat -c '%a' "$p" 2>/dev/null || stat -f '%Lp' "$p" 2>/dev/null || echo '?')"
  if [ "$owner" != "0" ] || [ "$mode" != "444" ]; then
    say "[FAIL] $f owner=$owner mode=$mode (want owner=0 mode=444)"
    verify_fail=1
  fi
done
[ "$verify_fail" -eq 0 ] || abort "post-seal verification failed for one or more core files (listed above)"

banner "G1 SEAL COMPLETE — immutable core is root:root 0444${IMMUT_SET:+ + $IMMUT_SET}. Proceed to egress-deny + hard-stop/teardown arm (see deploy/vm-policy.md)."
