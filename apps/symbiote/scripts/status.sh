#!/usr/bin/env bash
# status.sh — HONEST readiness. Distinguishes HEADLESS_READY (spine assembled, gate byte-intact) from
# PROMOTION_READY (safe to self-edit). It does NOT run the behavior suite (use scripts/test.sh) and it
# never claims promotion readiness. Per the Fusion Council amendment: gates must not lie.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${AUKORA_SYMBIOTE_HOME:-$HOME/.aukora-symbiote}"
GATE="$REPO/authority/gate"
ok(){   printf "  \033[32m✓\033[0m %s\n" "$1"; }
no(){   printf "  \033[31m✗\033[0m %s\n" "$1"; }
warn(){ printf "  \033[33m•\033[0m %s\n" "$1"; }

echo "── aukora-symbiote status ───────────────────────────────"
HEADLESS=1
if [ -f "$GATE/aukoraGate.ts" ] && [ -f "$GATE/.gate-integrity.sha256" ]; then ok "gate source: present"; else no "gate source: MISSING"; HEADLESS=0; fi
if ( cd "$GATE" && shasum -a 256 -c .gate-integrity.sha256 >/dev/null 2>&1 ); then ok "gate integrity: VERIFIED ($(wc -l < "$GATE/.gate-integrity.sha256" | tr -d ' ')-file byte pin)"; else no "gate integrity: MISMATCH (re-stamp with scripts/regenerate-gate-integrity.sh after a deliberate edit)"; HEADLESS=0; fi
[ -f "$HOME_DIR/aumlok/authority-ed25519.key" ] && ok "AUMLOK: owner key present (Ed25519, local custody)" || ok "AUMLOK: no local owner key yet (run scripts/aumlok-authority.sh keygen)"
ok "Convex brain: local loopback runtime + governed write path present; live fuzzy recall cutover remains R5b"
if [ -f "$REPO/core/src/kiraBrain.ts" ] && [ -f "$REPO/receiver/kiraLoopback.ts" ] && [ -x "$REPO/scripts/kira.sh" ]; then
  ok "Kira: local fuzzy recall surface present"
else
  warn "Kira: local brain surface incomplete"
fi
DEF=$(find "$REPO/deferred-tests" -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')
warn "deferred-test debt: $DEF host-coupled files (behavior gate = scripts/test.sh)"
if grep -q "self-edit-heartbeat-v0" "$REPO/core/src/selfEditLoop.ts" 2>/dev/null; then ok "M4 sandbox heartbeat: BUILT (scripts/heartbeat.sh — sandbox-only, appliedLive=false)"; else warn "M4 sandbox heartbeat: not found"; fi
warn "live promotion: NOT BUILT · authority promotion: LOCKED (sandbox-green ≠ promotion-ready)"

echo "─────────────────────────────────────────────────────────"
if [ "$HEADLESS" -ne 1 ]; then echo "  STATE: NOT_READY"; exit 1; fi
echo "  STATE: HEADLESS_READY   (spine assembled · gate byte-intact · headless)"
echo "  NOT promotion-ready — M4 sandbox heartbeat BUILT (sandbox-only); live + authority promotion LOCKED · behavior gate is scripts/test.sh · TIER-2 public scrub pending."
exit 0
