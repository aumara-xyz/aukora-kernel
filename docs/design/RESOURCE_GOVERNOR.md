# Resource Governor — implementation spec (for Codex)

**Status:** design spec, not built. **Author of spec:** CC (Local Opus), 2026-07-15.
**Provenance / inspiration:** the three-controller decomposition and the acute-vs-chronic
distinction are distilled from a "Borromean Bridge" note (Kimi swarm over Nila Padma's
*Topology of Healing Bk 2* + Peter's `ENERGY_SENSING_V3`). **The topology/biology framing is
inspiration only and MUST NOT appear in code, comments, README, site, or investor copy.** See
§8. This spec keeps only the engineering.

---

## 0. One-paragraph purpose

Aukora is a long-running local organism that hits real limits — per-run model **call budgets**,
per-day **rehearsal caps**, provider **429s**, memory, and a **backlog of proposals awaiting the
owner's signature**. Today it copes ad hoc ("lean roster, disclose cost"; stop at
`AWAITING_OWNER_SIGNATURE`). The Resource Governor formalizes that into one small, **advisory,
pure** module set that (a) reads existing pressure signals, (b) *recommends* whether to admit new
expensive work and at what roster size, (c) classifies a failure cluster as acute-cascade vs
chronic-interlocked, and (d) reports whether the system's feedback loops still respond to load.
It **enforces nothing new** — existing budgets and the policy kernel remain the only enforcers.

---

## 1. Hard constraints (non-negotiable; mirror the existing discipline)

1. **Advisory-only, grants no authority.** Every public type carries the literal firewall fields
   `advisoryOnly: true; grantsAuthority: false`. The governor returns *recommendations*; callers
   and the existing gates (`externalReview` call budget, `drainBudget`, `policyKernel`) decide.
   It never applies, signs, promotes, spawns, or mutates.
2. **Pure functions + interfaces**, matching `core/src/*`. No ambient clock or fs: pass `nowIso`,
   `homeDir`, and pre-read snapshots/state **in** as args. Return `{ ok, ... }`, **fail closed**
   (on any missing/invalid input, recommend the most conservative action — `refuse`/`critical`).
3. **Containment.** The governor must never import a signer/authority/apply module. Add a test
   that mirrors `core/tests/advisoryContainment.test.ts` using
   `core/src/importGraphVerifier.ts` (`parseModuleEdges`) to prove no governor module reaches
   `aumlokSigner`, `patchApproval` apply-paths, `convexExecutionApproval`, or any promote/unlock
   sink. Advisory in, never authority out.
4. **Determinism + KAT-style tests.** vitest, one file per module at
   `core/tests/<name>.test.ts`; `core/package.json` runs `tsc --noEmit && vitest run`. No
   wall-clock assertions — if you need a complexity/liveness claim, assert on a **deterministic
   counted metric or on injected samples**, never on elapsed ms. (See the Fu-repo D5/D6 lesson:
   a wall-clock ratio test flakes and a metric that is structurally 0 passes vacuously.)
5. **Boring names in code.** `resourceSignal`, `admissionControl`, `incidentShape`,
   `responsiveness`. No `metabolism` / `organism` / `healing` / `observer-slot` / Borromean /
   AMPK-mTOR-GLP1R anywhere in the tree. (The repo already tolerates `proprioception`/`organs`;
   if you want one evocative umbrella noun for the folder, `homeostasis/` is the ceiling — but the
   module names stay functional.)

---

## 2. Corrected mental model (the anchors, from the real repo)

| Doc's mystified concept | Honest reality in THIS repo | Real anchor |
|---|---|---|
| RPM "fuel gauge" | remaining **call budget** + remaining **per-day rehearsal budget** + 429 state + health snapshot | `externalReview.ts` (`getCallCount`/`getEffectiveCallBudget`, 429 at `:333`), `drainBudget.ts` (`consumeDrainBudget`, `DEFAULT_DRAIN_BUDGET_PER_DAY=12`), `proprioceptionSnapshot.ts` |
| "spend / money" | **there is no USD ledger** — spend == call/rehearsal COUNTS | (no `costUsd` anywhere) |
| NWAC "growth switch" | admit / shrink-roster / defer / refuse a Fusion round or paid call | `fractalFusion.runFractalFusionReview` (roster = `config.models`, `maxScheduled`), `run-council.ts` (`COUNCIL_BUDGET`, `DEFAULT_MODELS`), `externalReview.performExternalReview` |
| CSC "environment" | provider health (429/`provider_rate_limited`) + **owner-signature backlog** (NOT a presence sensor) | `fusionSelfOpt.ts` reasons, `workbenchRunReport.ts` (`AWAITING_OWNER_SIGNATURE`, `signCommand`), `appliedProposalLedger.ts` |
| DHFI "health index" | does a pressure metric still rise under load and recover? | derived, new (`responsiveness.ts`) |
| topology discriminant | correlated-simultaneous vs gradual-interlocked failure cluster | over `flightRecorder.readFlightLog` events |
| receipts / audit | hash-chained JSONL event log | `flightRecorder.recordCapabilityEvent(dir, event, nowIso)` |

---

## 3. Module layout

```
core/src/governor/
  resourceSignal.ts      # read pressure → structured levels (pure)
  admissionControl.ts    # recommend admit/shrink/defer/refuse (pure)
  incidentShape.ts       # classify a failure cluster (pure)
  responsiveness.ts      # responsiveness-of-feedback probe (pure)
  reliefPlan.ts          # ordered advisory relief steps (pure, optional)
  types.ts               # shared types + the advisoryOnly/grantsAuthority firewall
core/tests/
  governorResourceSignal.test.ts
  governorAdmissionControl.test.ts
  governorIncidentShape.test.ts
  governorResponsiveness.test.ts
  governorContainment.test.ts   # importGraphVerifier firewall (mirror advisoryContainment)
```
(If a flat `core/src/` is preferred over a subfolder, prefix files `governor*.ts`. Match whatever
the maintainer prefers; the subfolder is cleaner for the containment test's allowlist.)

---

## 4. Component specs (exact signatures)

### 4.1 `resourceSignal.ts` — read pressure (pure)

```ts
export type Pressure = 'ok' | 'warn' | 'critical';

export interface ResourceSignalInput {
  readonly advisoryOnly: true; readonly grantsAuthority: false;
  readonly nowIso: string;
  // budgets (COUNTS, not money) — pass current values read at the edge:
  readonly callsUsed: number;            // externalReview.getCallCount()
  readonly callsBudget: number;          // externalReview.getEffectiveCallBudget()
  readonly rehearsalsUsedToday: number;  // drainBudget state.used
  readonly rehearsalsMaxToday: number;   // effectiveDrainMax()
  readonly recentRateLimited: number;    // count of 429/provider_rate_limited in the last window
  // health (from buildProprioceptionSnapshot / localEndpointReadiness), already read:
  readonly endpointsReady: boolean;
  readonly convexReadOnly: boolean;      // brain reachable & read-only mount ok
  readonly deferredTestDebt: number;
  // owner-signature backlog (NOT presence): how many governed runs are parked, and staleness
  readonly awaitingSignatureCount: number;   // runs at terminalState AWAITING_OWNER_SIGNATURE
  readonly oldestAwaitingAgeMs: number | null;
}

export interface ResourceSignal {
  readonly advisoryOnly: true; readonly grantsAuthority: false;
  readonly at: string;                   // = nowIso
  readonly axes: {
    readonly callBudget: Pressure;       // used/budget ratio → warn ≥0.7, critical ≥0.95 or ≥budget
    readonly rehearsalBudget: Pressure;  // used/max ratio, same thresholds; critical when exhausted
    readonly rateLimit: Pressure;        // recentRateLimited: warn ≥1, critical ≥3 in window
    readonly health: Pressure;           // !endpointsReady||!convexReadOnly → critical; debt→warn
    readonly signatureBacklog: Pressure; // awaitingSignatureCount: warn ≥3, critical ≥8; staleness bumps
  };
  readonly overall: Pressure;            // = max() over axes (critical dominates)
  readonly worstAxis: keyof ResourceSignal['axes'] | null;
}

export function readResourceSignal(input: ResourceSignalInput): ResourceSignal;
```
Thresholds are module consts (exported for tests). Fail-closed: any `NaN`/negative/missing →
that axis is `critical`. Pure; no fs/clock.

### 4.2 `admissionControl.ts` — recommend (pure, the one real lever)

```ts
export type WorkKind = 'fusion_council' | 'rehearsal_batch' | 'single_model_call' | 'other';
export type AdmissionDecision = 'admit' | 'shrink' | 'defer' | 'refuse';

export interface WorkRequest {
  readonly kind: WorkKind;
  readonly requestedRoster: number;   // e.g. config.models.length for a council
  readonly estimatedCalls: number;    // e.g. models.length * SHARD_NAMES.length
  readonly reversible: boolean;       // advisory hint from caller
  readonly urgent: boolean;           // owner-flagged / incident response
}

export interface AdmissionVerdict {
  readonly advisoryOnly: true; readonly grantsAuthority: false;
  readonly decision: AdmissionDecision;
  readonly rosterCap: number | null;  // when 'shrink': the recommended max roster (≥1)
  readonly reasonCode: string;        // e.g. 'call_budget_critical', 'rate_limited', 'signature_backlog', 'ok'
  readonly reason: string;            // one honest human line for disclosure
}

export function admitWork(
  req: WorkRequest,
  signal: ResourceSignal,
  opts?: { readonly hardMaxCalls?: number }  // default externalReview.HARD_MAX_CALLS_PER_RUN
): AdmissionVerdict;
```
**Decision policy (advisory, deterministic):**
- `overall === 'ok'` → `admit`.
- `estimatedCalls` would exceed the remaining call budget or `hardMaxCalls` → `shrink` with
  `rosterCap` sized to fit the remaining budget (never below 1; if 1 still overflows → `defer`).
- `rehearsalBudget === 'critical'` (exhausted) and `kind==='rehearsal_batch'` → `defer`.
- `rateLimit === 'critical'` → `defer` (let the provider recover) unless `urgent`.
- `signatureBacklog === 'critical'` and `kind` generates new proposals → `defer` with reason
  "owner has N unsigned proposals; not generating more until the queue drains" (this is the honest
  CSC/human-coordination lever — don't manufacture work the human can't ratify).
- `health === 'critical'` → `refuse` (sense before you build; see §5 relief order).
- `urgent` upgrades `defer`→`shrink` (never `refuse`→anything for health-critical: still refuse).
- **This is a recommendation.** `fractalFusion`/`run-council` still pass their own `maxScheduled`;
  the existing budget cap remains authoritative (see `fusionRosterConcurrency.test.ts`).

### 4.3 `incidentShape.ts` — acute vs chronic (pure)

```ts
export interface FailureEvent { readonly axis: string; readonly atMs: number; readonly rootId?: string; }
export type IncidentShape = 'cascade' | 'interlocked' | 'none';

export interface IncidentClassification {
  readonly advisoryOnly: true; readonly grantsAuthority: false;
  readonly shape: IncidentShape;
  readonly correlatedWithinMs: number | null;  // tightest cluster span, if cascade
  readonly axes: readonly string[];            // distinct axes involved
  readonly recommendedMode: 'coordinated' | 'sequential' | 'none';
}

export function classifyIncident(
  events: readonly FailureEvent[],
  opts?: { readonly correlationWindowMs?: number; readonly chronicSpanMs?: number }
): IncidentClassification;
```
- **cascade** (acute): ≥2 distinct axes failing within `correlationWindowMs` (default 60_000) AND
  (same `rootId` if present) → `recommendedMode: 'coordinated'` (address together).
- **interlocked** (chronic): distinct axes degrading over `> chronicSpanMs` (default 3_600_000),
  different/absent roots → `sequential`.
- Ambiguous/empty → `none`. **Default toward `interlocked`/`sequential`** (the safer, gentler
  response) when it's genuinely unclear. Feed it from `flightRecorder.readFlightLog(dir, nowIso)`
  (map `FlightEvent.kind` failures → `FailureEvent`), read at the edge; the classifier itself is pure.

### 4.4 `responsiveness.ts` — do the loops still work? (pure)

```ts
export interface Sample { readonly atMs: number; readonly load: number; readonly pressure: number; }
export interface ResponsivenessVerdict {
  readonly advisoryOnly: true; readonly grantsAuthority: false;
  readonly responsive: boolean;   // pressure tracks load (rises under load, falls after)
  readonly flatlined: boolean;    // pressure ~constant regardless of load → dead sensor / stuck loop
  readonly correlation: number;   // signed, load↔pressure over the window
  readonly note: string;
}
export function probeResponsiveness(
  samples: readonly Sample[],
  opts?: { readonly minSamples?: number; readonly flatEpsilon?: number }
): ResponsivenessVerdict;
```
Start with **one** real pair (e.g. queue depth as `load`, call-budget-consumption rate as
`pressure`) — not "10 components." `flatlined === true` is the alert-worthy state. Deterministic
over injected samples; **no timers in the test**.

### 4.5 `reliefPlan.ts` — ordered advisory steps (pure, optional/last)

```ts
export interface ReliefStep { readonly order: number; readonly axis: string; readonly action: string; }
export interface ReliefPlan {
  readonly advisoryOnly: true; readonly grantsAuthority: false;
  readonly mode: 'coordinated' | 'sequential';
  readonly steps: readonly ReliefStep[];   // text only — a runbook, not an executor
}
export function buildReliefPlan(signal: ResourceSignal, incident: IncidentClassification): ReliefPlan;
```
Default order (heuristic, not law): **verify sensing → stop admitting new expensive work →
re-sync caps/wait for owner signature.** `mode` = `coordinated` for cascade, `sequential` for
interlocked. Emits **text**; a human or an existing gate acts on it.

---

## 5. Integration points (exact, minimal)

1. **`core/run-council.ts` / `core/src/fractalFusion.ts`**: before building the swarm plan,
   construct a `WorkRequest` (`requestedRoster = models.length`, `estimatedCalls =
   models.length * SHARD_NAMES.length`) and call `admitWork`. If `shrink`, cap `config.models` /
   `maxScheduled` to `rosterCap` and **disclose the reason in the run output** (matches the existing
   "lean roster, disclose cost" habit). If `defer`/`refuse`, print the reason and exit 0 without
   spawning. The existing budget cap still wins — the governor only makes the shrink *deliberate and
   receipted*.
2. **`core/src/drainBudget.ts` drainer**: consult `admitWork({kind:'rehearsal_batch',...})` before
   `consumeDrainBudget`; on `defer`, skip the tick.
3. **Emit audit**: after each `admitWork`/`classifyIncident` at a real decision point, call
   `flightRecorder.recordCapabilityEvent(dir, { kind: 'governor.admission', detail, meta }, nowIso)`.
   The governor modules stay pure; the *caller* does the recording at the edge.
4. **Signals in** are read at the edge from `externalReview` (counts), `drainBudget` (state),
   `buildProprioceptionSnapshot` / `evaluateEndpointReadiness` (health), and the
   `AWAITING_OWNER_SIGNATURE` run reports (backlog) — then passed as plain values into the pure
   functions. Do **not** have the governor import those modules if it would pull an authority edge;
   pass snapshots in.

---

## 6. Invariants to assert (tests)

- `governorContainment.test.ts`: `parseModuleEdges` over `core/src/governor/*` → **zero** edges to
  any signer/apply/promote/unlock module (allowlist: `types`, node stdlib, other governor files,
  and pure read-only helpers only). This is the load-bearing test.
- Every public return object has `advisoryOnly === true && grantsAuthority === false`.
- Fail-closed: malformed/negative/NaN inputs → most-conservative output (`critical`/`refuse`).
- `admitWork` never returns `rosterCap < 1`; never recommends more calls than the remaining budget.
- `classifyIncident` defaults to `sequential`/`interlocked` on ambiguity; empty → `none`.
- Determinism: identical inputs → identical outputs across Node + Bun (the repo already runs Bun).
- **No wall-clock assertions anywhere.** Liveness/complexity claims assert on counted metrics or
  injected sample series only.

---

## 7. Build order (small; each independently shippable)

1. `types.ts` + `resourceSignal.ts` + test.
2. `admissionControl.ts` + test; wire the *disclosure-only* path into `run-council.ts` behind an
   env flag (`AUKORA_GOVERNOR=1`) so it's observe-first before it shrinks anything.
3. `incidentShape.ts` + test (reads flight log at the edge).
4. `responsiveness.ts` + test (one real signal pair).
5. `governorContainment.test.ts`.
6. `reliefPlan.ts` last, if wanted.

Ship 1–2 first, run it in **observe/disclose mode** for a while (it only prints what it *would*
recommend), confirm the recommendations match what you'd do by hand, then let it actually cap the
roster.

---

## 8. Explicit non-goals (do NOT build / do NOT claim)

- No Borromean/trefoil topology, AMPK/mTOR/GLP-1R biology, "observer-slot", or "metabolism/organism/
  healing" naming **in the tree**. Keep the source note as a private inspiration doc only.
- No new enforcement authority: the governor **recommends**; `externalReview`/`drainBudget`/
  `policyKernel` **enforce**. It must pass containment.
- No "owner presence" sensor. Human coordination = the **signature backlog**, nothing more.
- No money/cost accounting (there is no USD ledger; don't invent one — budgets are counts).
- No external/public claim beyond the honest one: *"Aukora degrades gracefully under pressure —
  resource-aware admission control plus a responsiveness health signal."* Anything stronger (a
  "topologically verified organism") is the overclaim this project exists to avoid.

---

## 9. Honest limitations (put a short version in each module's header)

Advisory heuristics over counted budgets and a hash-chained event log. It cannot *guarantee* the
system recovers, does not model true resource cost in money, and its acute/chronic classification is
a timing heuristic, not a proof. It makes the shrink/defer decisions Aukora already makes by hand
**deliberate, thresholded, and receipted** — nothing more.
