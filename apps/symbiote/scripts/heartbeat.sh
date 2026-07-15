#!/usr/bin/env bash
# heartbeat.sh — run ONE M4 self-edit heartbeat (sandbox-only) and print the phased trace.
# OBSERVER: this runs the loop and reports it. It applies ONLY to a throwaway temp dir (appliedLive=false),
# touches no live file, mutates no Convex, uses no memory authority, and promotes nothing. Watch it beat.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.bun/bin"
cd "$REPO/core"
[ -d node_modules ] || bun install >/dev/null 2>&1

if [ "${1:-}" = "--json" ]; then
  bun -e 'import {runSelfEditHeartbeat, demoHeartbeatProposal} from "./src/selfEditLoop"; console.log(JSON.stringify(runSelfEditHeartbeat({proposal: demoHeartbeatProposal()}), null, 2));'
  exit 0
fi

bun -e '
import {runSelfEditHeartbeat, demoHeartbeatProposal} from "./src/selfEditLoop";
const h = runSelfEditHeartbeat({proposal: demoHeartbeatProposal()});
console.log("🫀 Aukora Symbiote — self-edit heartbeat (sandbox-only)\n");
for (const p of h.phases) {
  if (p.phase==="proposal") console.log(`  1. PROPOSE   ${p.goal}\n               target: ${p.targetFiles.join(", ")}`);
  if (p.phase==="gate")     console.log(`  2. GATE      risk=${p.risk} · class=${p.actionClass} · ${p.admitted?"ADMITTED":"REFUSED ("+p.refusedReason+")"}`);
  if (p.phase==="sandbox")  console.log(`  3. SANDBOX   appliedSandbox=${p.appliedSandbox} · appliedLive=${p.appliedLive} · liveRepoUnchanged=${p.liveRepoUnchanged}`);
  if (p.phase==="test")     console.log(`  4. TEST      ${p.passed?"PASS":"FAIL"} · ${p.detail}`);
  if (p.phase==="receipt")  console.log(`  5. RECEIPT   verdict=${p.verdict} · ${p.receiptHash.slice(0,16)}…`);
  if (p.phase==="rollback") console.log(`  6. ROLLBACK  sandboxRemoved=${p.sandboxRemoved} · restored=${p.restored} · liveRepoTouched=${p.liveRepoTouched}`);
}
console.log(`\n  OUTCOME: ${h.outcome}  ·  appliedLive=${h.appliedLive}  ·  promotionReady=${h.promotionReady}  ·  grantsAuthority=${h.grantsAuthority}`);
console.log("  (sandbox-green is NOT promotion-ready — promotion is a separate, later, proven lane.)");
'
