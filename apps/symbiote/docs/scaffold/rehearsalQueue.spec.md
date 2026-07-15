# Integration Spec — rehearsal-queue planner → CLI runner (for Fable)

## What landed (this brick, pure + tested)
`core/src/rehearsalQueue.ts` — a PURE PLANNER. It reads the rehearsal queue and decides *which* orders to rehearse this run. It runs nothing, applies nothing, grants nothing. Isolated typecheck (`core/tsconfig.json`) clean; 14/14 vitest green.

### Exact interface Fable wires against
```ts
// core/src/rehearsalQueue.ts
export interface QueuedOrder {
  file: string;                 // basename read from (for dry-run listing only)
  order: GovernedWorkOrderV1;   // the validated core work order
  intentId: string;             // validated 64-hex; the ONLY thing the command is built from
  ring: Ring;                   // 0..4, mirrors order.ring
}
export interface PlannedRehearsal {
  orderId: string;
  intentId: string;
  ring: Ring;
  file: string;
  command: string;              // EXACTLY `run: --from-proposal <intentId>`
}
export interface RehearsalPlan {
  planned: PlannedRehearsal[];
  deferred: QueuedOrder[];      // over-cap + ceiling-excluded; nothing silently dropped
  advisoryOnly: true;
  grantsAuthority: false;
}
export interface PlanRehearsalsOpts { maxPerRun: number; ringCeiling?: Ring }

export function readRehearsalQueue(dir: string): { orders: QueuedOrder[]; skipped: {file:string; reason:string}[] };
export function planRehearsals(orders: QueuedOrder[], opts: PlanRehearsalsOpts): RehearsalPlan;
```

### On-disk shape this reader consumes (verified against the real writer)
`spatial/voiceReadToolBridge.ts::dispatchVoiceRehearseTool` writes, per queued rehearsal, to
`~/.aukora-symbiote/aumlok/rehearsal-queue/<orderId>.json`:
```jsonc
{ ...GovernedWorkOrderV1, "intentId": "<64-hex proposal-intent id>" }
```
CRITICAL DETAIL Fable must not undo: `validateWorkOrder` (governedWorkOrder.ts) **rejects unknown keys** as tampering. The writer appends `intentId`, an unknown key. So the reader **splits `intentId` off** and validates only the core order body, then validates `intentId` as a bare 64-hex separately. Any wrapper that re-validates the whole parsed object would reject every real order.

## How Fable wires it (the SEPARATE `scripts/` CLI — DO NOT put this in core)
Add e.g. `scripts/rehearse-queue.ts`. It is the ONLY place execution lives.

1. Resolve the queue dir the SAME way the writer does:
   `path.join(process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME||'', '.aukora-symbiote'), 'aumlok', 'rehearsal-queue')`.
   (Export this from the bridge or a shared paths module rather than re-hardcoding, to keep one source of truth.)
2. `const { orders, skipped } = readRehearsalQueue(dir)` — print `skipped` (file + reason) so a bad/tampered order is visible, never silent.
3. `const plan = planRehearsals(orders, { maxPerRun, ringCeiling })` where `maxPerRun` comes from a flag (default small, e.g. 3) and `ringCeiling` is optional.
4. **DRY-RUN by default**: print `plan.planned[].command` and the deferred list. Exit. Nothing runs.
5. **`--execute` flag only**: for each planned item, invoke the EXISTING workbench with its `command`
   (`run: --from-proposal <intentId>`), honoring `maxPerRun` as a hard cap. The workbench re-reads the real
   files from disk, sandboxes, tests, Fusion-reviews, and **stops at AWAITING_OWNER_SIGNATURE**.
   **Execution NEVER applies anything** — only Peter's AUMLOK signature applies, and that is a separate, owner-only act the CLI must not touch. State this in the CLI's help text and its per-run banner.

### Tests to ADD when wiring (in the scripts/ layer, not core)
- `--execute` respects `maxPerRun` (never spawns more than the cap, even with N>cap eligible orders).
- Default run performs ZERO workbench invocations (assert the spawn/exec is not called).
- Each spawned command is exactly `run: --from-proposal <64-hex>` (assert on the string; catch arg injection).
- The executor path asserts the workbench return state is AWAITING_OWNER_SIGNATURE (or refuses) and never reaches an apply.
- A queue with a mix of valid + tampered + non-JSON files: only valid ones are ever offered to `--execute`; skipped ones are surfaced.

## Ring semantics Fable must preserve in flags/help (easy to get backwards)
LOWER ring number = HIGHER risk (Ring 0 = gate/signer/policy). `ringCeiling` is a FLOOR on the ring *number*: eligible iff `order.ring >= ringCeiling`. `ringCeiling: 2` defers the riskier Ring 0/1 orders. Planning order is riskiest-first (lowest ring first) so a capped run puts eyes on dangerous targets soonest. Deferred orders are still returned, never dropped.
