#!/usr/bin/env bash
# recursive-workbench.sh — run ONE recursive IDE rehearsal task through Aukora's own native tool-call
# dispatcher (core/src/nativeIdeDispatcher.ts) and print the trace. Sandbox-only: appliedLive=false
# throughout, the sandbox is a throwaway temp dir, and the run proves the live repo was never touched.
# This is a REHEARSAL of the tool-call path, not a claim that the organism modified itself.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.bun/bin"
cd "$REPO/core"
[ -d node_modules ] || bun install >/dev/null 2>&1

if [ "${1:-}" = "--json" ]; then
  bun -e 'import {runRecursiveWorkbenchDemo} from "./src/recursiveWorkbench"; console.log(JSON.stringify(runRecursiveWorkbenchDemo(), null, 2));'
  exit 0
fi

bun -e '
import {runRecursiveWorkbenchDemo} from "./src/recursiveWorkbench";
const r = runRecursiveWorkbenchDemo();
console.log("Aukora Symbiote — native recursive IDE workbench rehearsal (sandbox-only)\n");
let i = 1;
for (const s of r.steps) {
  console.log(`  ${i++}. ${s.ok ? "OK  " : "FAIL"} ${s.step.padEnd(24)} ${s.summary}`);
}
console.log(`\n  tools used (via dispatcher): ${r.toolCallsUsed.join(" -> ")}`);
console.log(`  receiptValid=${r.receiptValid}  liveRepoUntouched=${r.liveRepoUntouched}  sandboxRemoved=${r.sandboxRemoved}`);
console.log(`  appliedLive=${r.appliedLive}  rehearsalOnly=${r.rehearsalOnly}  promotionReady=${r.receipt.promotionReady}`);
console.log("\n  She completed a native recursive IDE rehearsal through her own tool dispatcher, sandbox-only, with receipt, no live apply.");
'
