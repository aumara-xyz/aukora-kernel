# AUKORA DIGITAL METABOLISM SPECIFICATION

## A Resource-Management State Machine with Biological Inspiration

**Document:** `AUKORA_DIGITAL_METABOLISM_SPEC.md`  
**Version:** 1.0.0  
**Date:** 2026-07-14  
**Status:** Specification — ready for implementation review  
**Author:** Aukora Systems Architecture  

---

## 0. WHAT THIS DOCUMENT IS AND IS NOT

**This IS:**
- A resource-management layer that tracks measurable system quantities (CPU, memory, API quotas, error rates, financial balance) and uses them to select among seven operating modes.
- A state machine with explicit transition guards, hysteresis to prevent flapping, and receipts for every state change.
- An engineering specification with exact TypeScript types, Convex table schemas, and measurable thresholds.

**This is NOT:**
- A claim that Aukora is "alive," "conscious," or "biologically alive in software."
- A control-theory proof that these seven states are optimal.
- A substitute for infrastructure-level autoscaling, Kubernetes health probes, or cloud provider alerts.
- A biological simulation. The inspiration is structural (homeostasis, feedback, hysteresis), not mechanistic (no ATP, no AMPK, no mitochondria).

**The metaphor's honest scope:**
A cell maintains homeostasis by sensing resources and switching between growth, maintenance, stress, and repair. A software system can use the same *control-structure*—sensing, state transition, hysteresis, recovery—without claiming the *mechanism* is biological. Where the metaphor breaks, we say so explicitly (see Section 7).

---

## 1. DATA STRUCTURES

### 1.1 OrganismEnergyState — The State Vector

Every sensor contributes a normalized reading to a single state vector. All values are normalized to `[0, 1]` where `1.0` = fully available/healthy and `0.0` = fully exhausted/critical. This normalization makes the Flexibility Index computation dimensionless and allows sensors of different units to coexist.

```typescript
// convex/aukoraMetabolism.ts

/** Normalized dimensionless reading: 1.0 = healthy/abundant, 0.0 = critical/exhausted.
 *  Computed from raw sensor value + sensor-specific normalization function.
 *  Stored as a 2-decimal fixed-point number (0.00–1.00) in Convex.
 */
type NormalizedReading = number; // 0.0 <= x <= 1.0

/** Raw sensor sample from a single measurement event.
 *  One row per sample — append-only audit trail. Convex `ts` is the ordering authority.
 */
export interface MetabolicSensorSample {
  sensorId: string;           // e.g., "cpu:host-a", "apiquota:openai"
  sensorFamily: SensorFamily; // grouping for aggregation queries
  rawValue: number;           // native unit (MHz, MB, ms, USD, °C, count)
  rawUnit: string;            // "percent", "mb", "ms", "usd", "celsius", "count"
  normalized: NormalizedReading;
  thresholdCrossed?: string;  // e.g., "stress_warning", "critical" — null if no crossing
  sampledAt: number;          // Unix ms
}

/** The full state vector — one row, updated in-place by the metabolism tick.
 *  Historical vectors are preserved in `aukora_metabolism_history` (one snapshot per tick).
 */
export interface OrganismEnergyState {
  // ── Compute Resources ──
  cpuUtilization: NormalizedReading;       // 1.0 = idle, 0.0 = pegged at 100%
  gpuUtilization: NormalizedReading;       // 1.0 = idle, 0.0 = pegged at 100%
  memoryPressure: NormalizedReading;       // 1.0 = plenty free, 0.0 = OOM imminent
  storagePressure: NormalizedReading;      // 1.0 = plenty free, 0.0 = disk full

  // ── Inference Expenditure ──
  tokenBudgetRemaining: NormalizedReading; // fraction of monthly token budget left
  averageLatencyHealth: NormalizedReading; // 1.0 = all p95 under target, 0.0 = catastrophic
  costPerHourTrend: NormalizedReading;     // 1.0 = under budget trend, 0.0 = burning too fast

  // ── Network / Connectivity ──
  networkAvailability: NormalizedReading;  // 1.0 = all paths up, 0.0 = total partition
  bandwidthHeadroom: NormalizedReading;    // fraction of provisioned bandwidth unused

  // ── Financial / API Quotas ──
  apiQuotaHealth: NormalizedReading;       // minimum across all API providers
  financialBalanceHealth: NormalizedReading; // 1.0 = funded, 0.0 = broke / credits zero

  // ── Thermal / Hardware ──
  thermalHeadroom: NormalizedReading;      // 1.0 = cool, 0.0 = thermal throttling active
  batteryCharge?: NormalizedReading;       // optional (mobile/edge only)

  // ── Error & Contradiction Load ──
  errorRateHealth: NormalizedReading;      // 1.0 = zero errors, 0.0 = error flood
  fuDisagreementLoad: NormalizedReading;   // 1.0 = consensus, 0.0 = persistent splits
  testFailureLoad: NormalizedReading;      // 1.0 = all green, 0.0 = widespread red

  // ── Human Attention / Operational ──
  humanAttentionLoad: NormalizedReading;   // 1.0 = no pending reviews, 0.0 = queue drowning
  openIssueLoad: NormalizedReading;        // 1.0 = manageable, 0.0 = backlog critical

  // ── Recovery Capacity / Redundancy ──
  backupHealth: NormalizedReading;         // 1.0 = fresh verified backups, 0.0 = stale/missing
  redundancyHealth: NormalizedReading;     // 1.0 = all replicas healthy, 0.0 = single point
  witnessMeshHealth: NormalizedReading;    // 1.0 = all peers responding, 0.0 = mesh partitioned

  // ── Metadata ──
  tickId: string;                          // monotonic tick counter (e.g., "tick_00004217")
  computedAt: number;                      // Unix ms
  sensorCount: number;                     // how many sensors contributed (expect 17+)
  staleSensorCount: number;                // sensors whose last sample is > 2x sampling period old
}
```

### 1.2 Convex Table Schema Additions

Three new tables. All metabolism data is isolated to these tables — no modification to existing kernel tables.

```typescript
// Additions to convex/schema.ts

aukora_metabolism_state: defineTable({
  // Singleton row — stateKey = "metabolism:active" for the current vector.
  // Additional rows may store "metabolism:projected" for what-if analysis.
  stateKey: v.string(),
  // ── 17 normalized readings (0.00–1.00) ──
  cpuUtilization: v.number(),
  gpuUtilization: v.number(),
  memoryPressure: v.number(),
  storagePressure: v.number(),
  tokenBudgetRemaining: v.number(),
  averageLatencyHealth: v.number(),
  costPerHourTrend: v.number(),
  networkAvailability: v.number(),
  bandwidthHeadroom: v.number(),
  apiQuotaHealth: v.number(),
  financialBalanceHealth: v.number(),
  thermalHeadroom: v.number(),
  batteryCharge: v.optional(v.number()),
  errorRateHealth: v.number(),
  fuDisagreementLoad: v.number(),
  testFailureLoad: v.number(),
  humanAttentionLoad: v.number(),
  openIssueLoad: v.number(),
  backupHealth: v.number(),
  redundancyHealth: v.number(),
  witnessMeshHealth: v.number(),
  // ── Metadata ──
  tickId: v.string(),
  computedAt: v.number(),
  sensorCount: v.number(),
  staleSensorCount: v.number(),
  // ── State linkage ──
  operatingState: v.string(), // current OperatingState name
  flexibilityIndex: v.number(), // 0.00–1.00
}).index("by_stateKey", ["stateKey"]),

aukora_metabolism_history: defineTable({
  // Append-only snapshots — one row per metabolism tick.
  // Same fields as aukora_metabolism_state, plus:
  tickSeq: v.number(),          // monotonic integer for ordering (not wall-clock)
  triggerReason: v.string(),    // why this snapshot was taken ("scheduled", "threshold_crossed", "state_transition", "manual")
}).index("by_tickSeq", ["tickSeq"]).index("by_computedAt", ["computedAt"]),

aukora_metabolism_sensors: defineTable({
  // Per-sensor configuration + latest reading.
  sensorId: v.string(),
  family: v.string(),           // "compute" | "inference" | "network" | "financial" | "thermal" | "error" | "human" | "recovery"
  rawValue: v.number(),
  rawUnit: v.string(),
  normalized: v.number(),
  samplingPeriodMs: v.number(), // how often this sensor is expected to report
  lastSampledAt: v.number(),
  thresholdStress: v.number(),  // normalized value below which triggers STRESS consideration
  thresholdCritical: v.number(), // normalized value below which triggers REPAIR consideration
  enabled: v.boolean(),
}).index("by_sensorId", ["sensorId"]).index("by_family", ["family"]),
```

### 1.3 OperatingState — Enum of Seven States

```typescript
// convex/aukoraMetabolism.ts

export type OperatingState =
  | "GROWTH"       // building, learning, expanding features
  | "MAINTENANCE"  // indexing, testing, auditing, receipts
  | "STRESS"       // reducing optional activity, preserving core
  | "REPAIR"       // diagnosing corruption, running recovery
  | "DORMANCY"     // minimal expenditure, identity preservation only
  | "RECOVERY"     // cautiously restoring after failure
  | "REPRODUCTION"; // spawning descendant nodes (rare, gated)

/** Human-readable state descriptions for the operator console. */
export const OPERATING_STATE_META: Record<OperatingState, { label: string; description: string; ringCeiling: AukoraRing }> = {
  GROWTH:       { label: "Growth",       description: "All resources healthy. Building applications, learning, expanding.", ringCeiling: "self-modify" },
  MAINTENANCE:  { label: "Maintenance",  description: "Routine care: indexing memory, testing backups, running audits.", ringCeiling: "self-modify" },
  STRESS:       { label: "Stress",       description: "Resources deteriorating. Reducing optional activity, preserving core.", ringCeiling: "external" },
  REPAIR:       { label: "Repair",       description: "Active corruption or failure detected. Diagnosing and fixing.", ringCeiling: "local-write" },
  DORMANCY:     { label: "Dormancy",     description: "Critical resource exhaustion. Preserving identity with minimal spend.", ringCeiling: "observe" },
  RECOVERY:     { label: "Recovery",     description: "Post-failure restoration. Cautiously re-enabling functions.", ringCeiling: "local-write" },
  REPRODUCTION: { label: "Reproduction", description: "Spawning descendant nodes. Requires surplus + explicit authorization.", ringCeiling: "external" },
};
```

The `ringCeiling` field is load-bearing: it caps the maximum privilege ring the kernel will allow while in that state. A DORMANCY state caps at `observe` (read-only), preventing any durable write, external call, or self-modification. STRESS caps at `external` (no self-modify). This is enforced in `evaluateAukoraIntent` — a new gate checked after sacred and salama but before the authorization gate.

### 1.4 StateTransition — What Triggers State Changes

```typescript
// convex/aukoraMetabolism.ts

export interface StateTransition {
  transitionId: string;       // e.g., "GROWTH_to_STRESS"
  fromState: OperatingState;
  toState: OperatingState;
  guardType: "threshold" | "timer" | "manual" | "receipt" | "kill_switch";

  // For threshold guards: which sensors must cross which thresholds
  thresholdConditions?: {
    sensorFamily: SensorFamily;
    below: number;              // normalized value that must be breached
    forAtLeastTicks: number;    // hysteresis: sustained for N ticks (prevents flapping)
  }[];

  // For timer guards: MAINTENANCE on a schedule, MAINTENANCE-to-GROWTH cooldown
  timerCondition?: {
    afterStateEntryMs: number;  // minimum time in fromState before transition allowed
    cronExpression?: string;    // optional: "0 2 * * *" for nightly MAINTENANCE
  };

  // For manual guards: operator-triggered (AUMLOK-authorized)
  manualCondition?: {
    requiresFounderApproval: boolean;
    requiresFlexibilityIndexAbove: number; // structural reserve: don't transition to GROWTH if index < 0.6
  };

  // For receipt guards: transition contingent on a receipt proving work done
  receiptCondition?: {
    chainKey: string;           // which receipt chain must contain the proof
    minGrade: "A" | "B" | "C";  // receipt must have at least this grade
  };

  // Structural reserve gate: minimum flexibility index required for this transition
  minFlexibilityIndex: number;

  // Receipted: every transition writes a metabolism receipt on chain "metabolism:state"
  receiptId?: string;
  executedAt?: number;
}

export type SensorFamily =
  | "compute"
  | "inference"
  | "network"
  | "financial"
  | "thermal"
  | "error"
  | "human"
  | "recovery";
```

### 1.5 DigitalHomeostaticFlexibilityIndex — The Composite Health Metric

```typescript
// convex/aukoraMetabolism.ts

/** The Digital Homeostatic Flexibility Index (DHFI) is a scalar [0,1] that measures
 *  the organism's adaptive capacity. It is NOT a linear average — it weights
 *  recovery capacity and structural reserve more heavily than transient resource
 *  availability, because a system with low current load but no backups is fragile.
 */
export interface DigitalHomeostaticFlexibilityIndex {
  value: number;              // 0.00 – 1.00, computed by weighted formula
  tickId: string;             // which tick this was computed for
  computedAt: number;

  // Decomposition: each sub-index contributes to the total
  resourceAvailability: number;   // mean of cpu, gpu, memory, storage, network, thermal
  inferenceSustainability: number; // mean of token budget, latency, cost trend
  financialHealth: number;        // mean of api quota, balance
  errorResilience: number;        // mean of error rate, Fu disagreement, test failures
  operationalClarity: number;     // mean of human attention, open issues
  structuralReserve: number;      // mean of backup health, redundancy, witness mesh
  // weighted geometric mean with structural reserve as floor
  formula: string;                // "dhfi = geo_mean(resource^0.15, inference^0.15, financial^0.10, error^0.20, operational^0.10, reserve^0.30)"
}

/** The canonical computation — pure function, testable in isolation. */
export function computeDHFI(state: OrganismEnergyState): number {
  const resource = mean([
    state.cpuUtilization, state.gpuUtilization, state.memoryPressure,
    state.storagePressure, state.networkAvailability, state.thermalHeadroom,
  ]);
  const inference = mean([
    state.tokenBudgetRemaining, state.averageLatencyHealth, state.costPerHourTrend,
  ]);
  const financial = mean([state.apiQuotaHealth, state.financialBalanceHealth]);
  const errorResilience = mean([
    state.errorRateHealth, state.fuDisagreementLoad, state.testFailureLoad,
  ]);
  const operational = mean([state.humanAttentionLoad, state.openIssueLoad]);
  const reserve = mean([
    state.backupHealth, state.redundancyHealth, state.witnessMeshHealth,
  ]);

  // Structural reserve gets 30% weight because without backups/redundancy/witnesses,
  // recovery from any failure is impossible — the "architecture" in architecture-vs-dynamics.
  // Geometric mean: any sub-index at 0 pulls the total toward 0 (no masking of critical failure
  // by averaging with healthy siblings).
  const dhfi = Math.pow(
    Math.max(resource, 0.001) ** 0.15 *
    Math.max(inference, 0.001) ** 0.15 *
    Math.max(financial, 0.001) ** 0.10 *
    Math.max(errorResilience, 0.001) ** 0.20 *
    Math.max(operational, 0.001) ** 0.10 *
    Math.max(reserve, 0.001) ** 0.30,
    1.0
  );

  return clamp(dhfi, 0.0, 1.0);
}

// ── Helpers ──
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
```

---

## 2. STATE MACHINE

### 2.1 State Diagram

```
                    ┌─────────────┐
         ┌─────────►│   DORMANCY  │◄────────┐
         │          │  (survive)  │         │
         │          └──────┬──────┘         │
         │                 │ recovery_begin │
         │                 ▼                │
         │          ┌─────────────┐         │
  stress_escalate  │   RECOVERY  │         │ critical_reserve
         │          │  (restore)  │─────────┘
         │          └──────┬──────┘ manual_override
         │                 │
         │    ┌────────────┘
         │    │ repair_complete
         │    ▼
         │  ┌─────────────┐     maintenance_schedule     ┌─────────────┐
         └──┤    STRESS   │◄─────────────────────────────┤ MAINTENANCE │
            │  (conserve) │                              │  (maintain) │
            └──────┬──────┘─────────────────────────────►└──────┬──────┘
                   │          stress_resolved                │
                   │                                         │ cooldown_complete
                   │                                         │
                   │        ┌─────────────┐                  │
                   └───────►│    GROWTH   │◄─────────────────┘
                            │   (build)   │
                            └──────┬──────┘
                                   │ reproduction_authorized
                                   ▼
                            ┌─────────────┐
                            │ REPRODUCTION│
                            │  (spawn)    │
                            └─────────────┘
                                   │
                                   ▼
                            back to GROWTH

  REPAIR can be entered from ANY state via manual override or corruption_detected.
  From REPAIR: success → RECOVERY, failure → DORMANCY (if structural reserve insufficient).
```

### 2.2 State Definitions with Entry/Exit Conditions

| State | Entry Condition | Exit Condition | Ring Ceiling | Max Duration |
|-------|----------------|----------------|-------------|--------------|
| **GROWTH** | DHFI >= 0.70; all sensors above stress thresholds; no open repairs; no pending human reviews > 48h | DHFI drops < 0.60 for 3+ ticks; OR error rate spikes; OR manual operator override | `self-modify` | Indefinite (while healthy) |
| **MAINTENANCE** | Cron schedule (default: nightly 02:00 UTC); OR operator command; OR `GROWTH` for 7 days without maintenance | Maintenance receipts meet grade threshold (B+); AND no new issues found; cooldown 30 min | `self-modify` | 4 hours max (hard cap to prevent stuck maintenance) |
| **STRESS** | DHFI < 0.60 for 3+ ticks; OR 2+ sensor families below stress threshold; OR apiQuota < 0.20 | DHFI > 0.65 for 5+ ticks (hysteresis — higher than entry to prevent flapping); AND all sensors above critical | `external` | 24 hours max (escalate to REPAIR if exceeded) |
| **REPAIR** | Corruption detected (receipt chain break, intent hash mismatch); OR test failure flood; OR operator command; OR STRESS > 24h | Repair receipts verify (grade A/B); AND DHFI > 0.40; AND manual operator clear OR auto-clear on receipt | `local-write` | 2 hours max (escalate to DORMANCY if exceeded) |
| **DORMANCY** | DHFI < 0.25; OR thermal throttling; OR kill switch adjacent; OR REPAIR timeout | DHFI > 0.50 for 3+ ticks; AND operator explicit clear; AND backup verified | `observe` | Indefinite (until conditions improve + human clear) |
| **RECOVERY** | Exited DORMANCY or REPAIR successfully; entering cautiously | DHFI > 0.60 for 5+ ticks; AND all core functions verified; THEN → GROWTH or MAINTENANCE | `local-write` | 1 hour max per recovery cycle |
| **REPRODUCTION** | DHFI >= 0.80 for 48h; AND operator explicit authorization; AND sufficient budget surplus | Spawn completes; OR authorization revoked; OR DHFI drops < 0.70 | `external` | Proportional to spawn complexity |

### 2.3 Transition Guards (Exact Logic)

Every transition must pass ALL applicable guards:

```typescript
// convex/aukoraMetabolism.ts

/** All guards must return true for the transition to proceed. */
interface TransitionGuard {
  /** 1. Hysteresis: the condition has been sustained for the required duration. */
  hysteresisSatisfied(state: OrganismEnergyState, history: OrganismEnergyState[], guard: StateTransition): boolean;

  /** 2. Structural reserve: DHFI must be above the transition's minimum. */
  structuralReserveSufficient(dhfi: DigitalHomeostaticFlexibilityIndex, minRequired: number): boolean;

  /** 3. Ring ceiling: the target state's ceiling must permit the intended activities.
   *  (Enforced by the kernel's evaluateAukoraIntent, NOT by the metabolism layer.)
   */
  ringCeilingPermitted(targetState: OperatingState, requestedRing: AukoraRing): boolean;

  /** 4. Manual authorization: transitions to DORMANCY, REPAIR, and REPRODUCTION
   *  require explicit operator approval (AUMLOK-signed command or founder token).
   */
  manualAuthorizationGranted(transition: StateTransition, operatorToken?: string): Promise<boolean>;

  /** 5. Receipt proof: for transitions contingent on completed work (REPAIR→RECOVERY, MAINTENANCE→GROWTH). */
  receiptProofPresent(ctx: MutationCtx, condition: StateTransition["receiptCondition"]): Promise<boolean>;

  /** 6. Salama/kill-switch override: if salama is active or kill switch is set, NO transition to GROWTH or REPRODUCTION.
   *  DORMANCY entry is permitted (it's a contraction, not an expansion).
   */
  noSafetyOverrideActive(ctx: MutationCtx): Promise<boolean>;
}
```

### 2.4 Hysteresis Rules (Anti-Flapping)

```
GROWTH → STRESS:   DHFI < 0.60 for 3 CONSECUTIVE ticks (≈ 3 minutes at 1-tick/min)
STRESS → GROWTH:   DHFI > 0.65 for 5 CONSECUTIVE ticks (harder to exit than enter)
STRESS → REPAIR:   STRESS persists > 24 hours OR DHFI < 0.35
REPAIR → RECOVERY: Repair receipts graded A/B AND DHFI > 0.40 for 2 ticks
REPAIR → DORMANCY: REPAIR timeout (2h) AND DHFI still < 0.30
RECOVERY → GROWTH: DHFI > 0.60 for 5 CONSECUTIVE ticks
DORMANCY → RECOVERY: DHFI > 0.50 for 3 ticks AND operator clear AND backup verified
ANY → REPAIR:      Immediate (no hysteresis) on corruption detection
GROWTH → MAINTENANCE: Cron OR 7 days in GROWTH (timer, not threshold)
MAINTENANCE → GROWTH: Maintenance receipts graded B+ AND 30-min cooldown
GROWTH → REPRODUCTION: DHFI >= 0.80 for 48h AND operator auth (both, not either)
```

The asymmetric hysteresis (easier to enter STRESS than exit) is deliberate: it mirrors biological "sickness behavior" — the system should be reluctant to resume full activity after a stress episode until conditions are clearly stable.

---

## 3. SENSORS

### 3.1 Sensor Inventory

| # | Sensor ID | Family | Raw Unit | Sampling | Stress Threshold | Critical Threshold | Normalization |
|---|-----------|--------|----------|----------|-----------------|-------------------|---------------|
| 1 | `cpu:util` | compute | percent | 10s | < 0.30 (70%+ used) | < 0.10 (90%+ used) | `1 - (util/100)` |
| 2 | `gpu:util` | compute | percent | 10s | < 0.20 (80%+ used) | < 0.05 (95%+ used) | `1 - (util/100)` |
| 3 | `mem:pressure` | compute | percent | 10s | < 0.25 (75%+ used) | < 0.05 (95%+ used) | `1 - (used/total)` |
| 4 | `disk:pressure` | compute | percent | 60s | < 0.20 (80%+ used) | < 0.05 (95%+ used) | `1 - (used/total)` |
| 5 | `tokens:budget` | inference | percent | 300s | < 0.30 (70% consumed) | < 0.05 (95% consumed) | `remaining/budget` |
| 6 | `latency:p95` | inference | ms | 60s | < 0.40 (p95 > 2x target) | < 0.10 (p95 > 5x target) | `target/p95` (clamped) |
| 7 | `cost:trend` | inference | USD/hr | 300s | < 0.40 (spend > 1.5x planned) | < 0.10 (spend > 3x planned) | `planned/actual` (clamped) |
| 8 | `net:up` | network | boolean | 10s | false (any path down) | false (all paths down) | `1` if all up, `0` if all down, `0.5` if partial |
| 9 | `net:bandwidth` | network | percent | 60s | < 0.20 (80%+ used) | < 0.05 (95%+ used) | `1 - (used/cap)` |
| 10 | `api:quota` | financial | percent | 300s | < 0.25 (75% consumed) | < 0.05 (95% consumed) | `min(remaining/limit)` across all APIs |
| 11 | `fin:balance` | financial | USD | 600s | < 0.20 (balance < 20% of monthly) | < 0.05 (balance < 5%) | `balance/monthly_budget` |
| 12 | `thermal:headroom` | thermal | celsius | 30s | < 0.25 (within 75% of throttle temp) | < 0.10 (throttling active) | `(throttle_temp - current) / (throttle_temp - ambient)` |
| 13 | `errors:rate` | error | count/min | 60s | < 0.70 (< 30 errors/min) | < 0.30 (> 70 errors/min) | `1 - (rate / max_acceptable)` |
| 14 | `fu:disagreement` | error | KL-div | 600s | < 0.50 (KL < 0.5) | < 0.20 (KL > 1.0) | `1 - min(KL, 2.0)/2.0` |
| 15 | `tests:failure` | error | percent | 300s | < 0.70 (< 30% failing) | < 0.30 (> 70% failing) | `1 - (fail_count / total_count)` |
| 16 | `human:attention` | human | queue depth | 600s | < 0.50 (> 5 pending reviews) | < 0.20 (> 20 pending) | `1 - min(queue/50, 1.0)` |
| 17 | `issues:open` | human | count | 600s | < 0.50 (> 10 open critical) | < 0.20 (> 50 open critical) | `1 - min(count/100, 1.0)` |
| 18 | `backup:health` | recovery | hours | 3600s | < 0.50 (> 12h stale) | < 0.10 (> 48h stale) | `1 - (age_hours / 72)` |
| 19 | `redundancy:health` | recovery | replica count | 300s | < 0.50 (< 50% replicas healthy) | < 0.20 (< 20% healthy) | `healthy_replicas / total_replicas` |
| 20 | `witness:mesh` | recovery | percent | 300s | < 0.50 (< 50% peers responding) | < 0.20 (< 20% responding) | `responding_peers / pinned_peers` |

### 3.2 Sensor Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTERNAL MONITORS                         │
│  (CloudWatch, Datadog, Prometheus, custom probes)           │
│  → Push or pull raw metrics every sampling period            │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│              aukoraMetabolismSensorPush                      │
│  Convex internalMutation — ONE entry point per sensor family │
│  - Validates sensorId is registered                          │
│  - Normalizes raw → [0,1] using sensor config                │
│  - Writes to aukora_metabolism_sensors (latest)              │
│  - Writes append-only sample row (audit) — optional at scale │
│  - If threshold crossed, emits metabolism_event              │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                 METABOLISM TICK (cron)                       │
│  Runs every 60s via convex/crons.ts                          │
│  1. Read all sensor latest values                            │
│  2. Assemble OrganismEnergyState                             │
│  3. Compute DHFI                                             │
│  4. Evaluate state transitions                               │
│  5. If transition triggers AND guards pass:                  │
│     - Write state change receipt on "metabolism:state"       │
│     - Update aukora_metabolism_state                         │
│  6. Archive snapshot to aukora_metabolism_history            │
│  7. If DORMANCY or STRESS: trigger Fu council review         │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Sensor Push Mutation (Convex)

```typescript
// convex/aukoraMetabolism.ts

export const pushSensorSample = internalMutation({
  args: {
    sensorId: v.string(),
    rawValue: v.number(),
    rawUnit: v.string(),
    sampledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const sensor = await ctx.db
      .query("aukora_metabolism_sensors")
      .withIndex("by_sensorId", (q) => q.eq("sensorId", args.sensorId))
      .first();
    if (!sensor) throw new Error("metabolism_sensor_unknown");
    if (!sensor.enabled) return { ok: false, reason: "disabled" };

    // Normalize using the sensor's configured thresholds
    const normalized = normalizeSensorValue(args.rawValue, sensor);

    // Determine if a threshold was crossed
    let thresholdCrossed: string | undefined;
    if (normalized < sensor.thresholdCritical) thresholdCrossed = "critical";
    else if (normalized < sensor.thresholdStress) thresholdCrossed = "stress";

    // Update the sensor's latest reading
    await ctx.db.patch(sensor._id, {
      rawValue: args.rawValue,
      rawUnit: args.rawUnit,
      normalized,
      lastSampledAt: args.sampledAt,
    });

    // Emit a threshold-crossing event for the next tick to consider
    if (thresholdCrossed) {
      // Write a metabolism_event row for the tick processor
      await ctx.db.insert("aukora_metabolism_events", {
        sensorId: args.sensorId,
        family: sensor.family,
        normalized,
        thresholdCrossed,
        sampledAt: args.sampledAt,
        processed: false,
      });
    }

    return { ok: true, normalized, thresholdCrossed: thresholdCrossed ?? null };
  },
});

function normalizeSensorValue(raw: number, sensor: Doc<"aukora_metabolism_sensors">): number {
  // Linear interpolation between stress and critical thresholds
  // Below critical → 0.0, above healthy → 1.0, between → linear
  const { thresholdStress, thresholdCritical } = sensor;
  if (raw >= thresholdStress) return 1.0;
  if (raw <= thresholdCritical) return 0.0;
  return (raw - thresholdCritical) / (thresholdStress - thresholdCritical);
}
```

---

## 4. THE FLEXIBILITY INDEX — DETAILED COMPUTATION

### 4.1 What "Challenge" Means for a Digital Organism

In biology, challenge means metabolic stress (glucose withdrawal, hypoxia, inflammatory stimulus). For the digital organism, challenge means **controlled perturbation followed by measurement of recovery dynamics**:

| Challenge Type | Implementation | Measured Response |
|---------------|----------------|-------------------|
| Load spike | Spike inference requests to 2x baseline for 60s | Latency p95 response, error rate, recovery time constant |
| Memory pressure | Allocate temporary buffers to 80% RAM | OOM behavior, swap activity, recovery after release |
| Network partition | Simulate 10s connectivity loss | Witness mesh re-convergence time, queue buildup, drain rate |
| Budget perturbation | Synthetic "budget at 5%" signal | Cost-reduction actions triggered, state transition latency |
| Error injection | Controlled bad-request flood to 5% rate | Error-rate response, Fu council activation time, recovery slope |

Challenges are **never run in DORMANCY or STRESS** — that would be like stressing an already-sick patient. They are scheduled during GROWTH or MAINTENANCE when resources are ample.

### 4.2 What "Recovery" Means

Recovery is measured as a **time-series of the DHFI after challenge onset**:

```typescript
interface ChallengeRecoveryCurve {
  challengeId: string;
  challengeType: string;
  startedAt: number;
  baselineDHFI: number;       // DHFI just before challenge
  challengeDHFI: number;      // DHFI at peak challenge (lowest point)
  recoverySamples: { ts: number; dhfi: number }[]; // sampled every 10s
  recoveryTimeConstant: number; // τ (seconds): time to recover to 63% of (baseline - challenge)
  overshoot: number;          // DHFI above baseline after recovery (inflammatory analog)
  hysteresis: number;         // |baseline - final_steady_state| / baseline
  verdict: "healthy" | "impaired" | "failed"; // classification
}
```

A healthy system shows:
- Small drop in DHFI during challenge
- Fast recovery (low τ)
- Minimal overshoot (no "inflammatory" overreaction)
- Low hysteresis (returns close to baseline)

A failing system shows:
- Large drop in DHFI
- Slow or absent recovery
- Large overshoot (e.g., over-aggressive cost cutting)
- Persistent hysteresis (never returns to baseline — a new lower attractor)

### 4.3 Dynamic Range Measurement

The Flexibility Index is not just the static DHFI. It is the **dynamic range** measured across the challenge-recovery cycle:

```typescript
function computeDynamicFlexibilityIndex(
  curve: ChallengeRecoveryCurve,
  staticDHFI: number,
): number {
  // Dynamic range = how far the system can be pushed and still recover
  const dynamicRange = curve.baselineDHFI - curve.challengeDHFI;

  // Recovery quality = speed and completeness
  const recoveryQuality = Math.max(0, 1 - (curve.recoveryTimeConstant / 300)); // normalize to 5 min

  // Hysteresis penalty = failure to return to baseline
  const hysteresisPenalty = 1 - curve.hysteresis;

  // Overshoot penalty = "inflammatory" overreaction
  const overshootPenalty = 1 - Math.max(0, curve.overshoot);

  // Combine: geometric mean so any failure drags total down
  const dynamicComponent = Math.pow(
    Math.max(dynamicRange, 0.001) *
    Math.max(recoveryQuality, 0.001) *
    Math.max(hysteresisPenalty, 0.001) *
    Math.max(overshootPenalty, 0.001),
    0.25,
  );

  // The final DFI is the static DHFI modulated by dynamic performance
  // A system can have high static DHFI but poor dynamics (fragile)
  // or low static DHFI but good dynamics (resilient under pressure)
  return clamp(staticDHFI * 0.6 + dynamicComponent * 0.4, 0, 1);
}
```

### 4.4 When to Run Challenges

- **Automated micro-challenges**: Every 4 hours during GROWTH (load spike, memory pressure) — lightweight, < 30 seconds
- **Full challenge battery**: Daily during MAINTENANCE (all 5 challenge types) — comprehensive, up to 5 minutes
- **Post-incident challenge**: Within 1 hour of exiting REPAIR or DORMANCY — validates recovery completeness
- **Never during**: STRESS, REPAIR, DORMANCY, RECOVERY (would compound existing strain)
- **Manual override**: Operator can trigger a challenge at any time via `runMetabolicChallenge` mutation

---

## 5. INTEGRATION WITH EXISTING AUKORA COMPONENTS

### 5.1 Metabolism → Kernel (Intent Evaluation)

The metabolism layer feeds into the kernel through **one additional gate** in the intent evaluation pipeline:

```
 evaluateAukoraIntent pipeline (ADDITION — new Step 3a):

   1. Salama check (unchanged)
   2. Kill switch check (unchanged)
   3. Sacred target check (unchanged)
   3a. METABOLIC STATE GATE (NEW):
       - Look up current operatingState from aukora_metabolism_state
       - If requested ring > OPERATING_STATE_META[state].ringCeiling → refuse
       - This is a HARD ceiling, not advisory
       - Example: DORMANCY caps at "observe" → any local-write/external/self-modify is refused
       - STRESS caps at "external" → self-modify is refused
   4. Self-modify clearance check (unchanged)
   5. Authorization gate (unchanged)
   6. Claim classification (unchanged)
```

```typescript
// Addition to aukoraCore.ts — evaluateAukoraIntent

// METABOLIC STATE GATE (B4.0): the operating state caps the maximum ring.
// This gate is checked AFTER sacred (so Ring-0 refusal is still the first response)
// and BEFORE self-modify clearance (so the metabolism ceiling can block self-modify
// even with human clearance, if the organism is in a resource-constrained state).
const METABOLIC_RING_CEILING: Partial<Record<OperatingState, AukoraRing>> = {
  GROWTH: "self-modify",
  MAINTENANCE: "self-modify",
  STRESS: "external",
  REPAIR: "local-write",
  DORMANCY: "observe",
  RECOVERY: "local-write",
  REPRODUCTION: "external",
};

export function metabolicRingCeiling(state: OperatingState): AukoraRing {
  return METABOLIC_RING_CEILING[state] ?? "observe"; // default fail-closed
}

// In evaluateAukoraIntent, after the sacred check:
// if (ringRank(intent.ring) > ringRank(metabolicRingCeiling(currentOperatingState))) {
//   return { decision: { status: "refused", acceptedClaim: intent.claim, errorCode: "metabolic_ceiling", proofRefs: [] }, nextState: current };
// }
```

### 5.2 Metabolism → Receipts (Health History)

Every metabolism state transition mints a receipt on the reserved `metabolism:state` chain:

```typescript
// In the metabolism tick handler:

async function recordStateTransitionReceipt(
  ctx: MutationCtx,
  transition: StateTransition,
  fromDHFI: number,
  toDHFI: number,
  state: OrganismEnergyState,
) {
  const receiptInput: ReceiptInput = {
    goal: `metabolism.transition:${transition.fromState}->${transition.toState}`,
    actorModel: "aukora.metabolism",
    lane: "local",
    risk: transition.toState === "DORMANCY" || transition.toState === "REPAIR" ? "critical" : "medium",
    grade: toDHFI > 0.6 ? "A" : toDHFI > 0.4 ? "B" : toDHFI > 0.2 ? "C" : "F",
    verdict: "kept", // the transition was executed
    actionsJson: JSON.stringify({
      transition: transition.transitionId,
      fromState: transition.fromState,
      toState: transition.toState,
      fromDHFI,
      toDHFI,
      sensorSnapshot: pick(state, [
        "cpuUtilization", "memoryPressure", "errorRateHealth",
        "backupHealth", "redundancyHealth",
      ]),
    }),
    proofJson: JSON.stringify({
      guardType: transition.guardType,
      hysteresisTicks: transition.thresholdConditions?.[0]?.forAtLeastTicks,
      minFlexibilityIndex: transition.minFlexibilityIndex,
      tickId: state.tickId,
    }),
  };

  return await appendReceiptAndSignHead(ctx, "metabolism:state", receiptInput);
}
```

These receipts are **health history** — they enable:
- Post-mortem analysis: "what was the metabolic trajectory before the incident?"
- Trend analysis: "is DHFI declining over weeks?"
- Cross-node audit: "did the peer enter DORMANCY before or after the witness mesh partitioned?"

### 5.3 Metabolism → Fu Council (Reviews)

The metabolism layer triggers Fu council reviews under three conditions:

```typescript
// convex/aukoraMetabolism.ts

async function maybeTriggerFuReview(
  ctx: MutationCtx,
  currentState: OperatingState,
  dhfi: DigitalHomeostaticFlexibilityIndex,
  state: OrganismEnergyState,
) {
  // Condition 1: Entered STRESS — Fu reviews resource-consumption recommendations
  if (currentState === "STRESS") {
    await triggerFuCouncilReview(ctx, {
      topic: "metabolic_stress_response",
      context: { dhfi: dhfi.value, stressedSensors: getStressedSensors(state) },
      advisoryOnly: true,          // Fu never grants authority
      grantsAuthority: false,
    });
  }

  // Condition 2: Entered REPAIR — Fu diagnoses root cause from receipts + traces
  if (currentState === "REPAIR") {
    await triggerFuCouncilReview(ctx, {
      topic: "metabolic_repair_diagnosis",
      context: { recentReceipts: getRecentReceipts(ctx, 10), errorTraces: getRecentErrors(ctx, 50) },
      advisoryOnly: true,
      grantsAuthority: false,
    });
  }

  // Condition 3: DHFI drops > 0.3 in a single tick — emergency review
  if (dhfi.value < 0.3) {
    await triggerFuCouncilReview(ctx, {
      topic: "metabolic_emergency",
      context: { fullState: state, dhfi },
      advisoryOnly: true,
      grantsAuthority: false,
    });
  }
}
```

**Important**: Fu council reviews are always `advisoryOnly: true` / `grantsAuthority: false`. The metabolism state machine makes its own decisions. Fu provides diagnostic input, not authority. This mirrors the biological analog: the immune system (Fu) advises, but the hypothalamus (metabolism) decides.

### 5.4 Metabolism → AUMLOK (Human Approval)

Three transitions require explicit human authorization through AUMLOK:

| Transition | Authorization Required | Why |
|------------|----------------------|-----|
| `GROWTH → REPRODUCTION` | AUMLOK ceremony + founder token | Spawning descendants is irreversible and budget-intensive |
| `DORMANCY → RECOVERY` | AUMLOK ceremony OR founder token | Exiting dormancy commits resources; human confirmation that conditions are safe |
| `ANY → REPAIR` (manual) | Founder token | Human-triggered repair is an operator action |
| `STRESS → GROWTH` (premature) | Founder token | Bypassing hysteresis requires override authority |

```typescript
// In the transition guard:

async function checkAumlokAuthorization(
  ctx: MutationCtx,
  transition: StateTransition,
  operatorToken?: string,
): Promise<boolean> {
  // Manual transitions always require founder approval
  if (transition.guardType === "manual") {
    if (!operatorToken) return false;
    const founder = await requireFounderUserIdSafe(ctx, operatorToken);
    return founder !== null;
  }

  // REPRODUCTION always requires AUMLOK ceremony
  if (transition.toState === "REPRODUCTION") {
    // Must pass the full AUMLOK PoP ceremony — not just a founder token
    return await verifyAumlokCeremonyAuthorization(ctx, "metabolism:reproduction");
  }

  // DORMANCY→RECOVERY: founder token is sufficient (lighter weight)
  if (transition.fromState === "DORMANCY" && transition.toState === "RECOVERY") {
    if (!operatorToken) return false;
    const founder = await requireFounderUserIdSafe(ctx, operatorToken);
    return founder !== null;
  }

  return true; // all other transitions: automatic (threshold/timer driven)
}
```

### 5.5 Metabolism → Kira Memory (Trend Analysis)

Kira Brain provides the memory substrate for metabolic trend analysis:

```typescript
// Integration with aukoraMemory (aukora_memory table)

async function recordMetabolicSnapshotInKira(
  ctx: MutationCtx,
  state: OrganismEnergyState,
  dhfi: DigitalHomeostaticFlexibilityIndex,
) {
  // Write a Kira memory atom tagged with "metabolism:snapshot"
  // This enables the 3-perceiver recall pattern:
  // - Perceiver 1: "What was the metabolic state N ticks ago?"
  // - Perceiver 2: "Show me the trajectory of DHFI over the past week"
  // - Perceiver 3: "What sensors were stressed before the last DORMANCY entry?"

  const memoryKey = `metabolism:${state.tickId}`;
  const memoryValue = JSON.stringify({
    dhfi: dhfi.value,
    operatingState: state,
    sensorSummary: getStressedSensors(state),
  });

  // Delegation: written by the metabolism system under its own delegation
  await writeKiraMemoryAtom(ctx, {
    ownerRootId: "metabolism", // reserved root for system processes
    key: memoryKey,
    value: memoryValue,
    tags: ["metabolism", "snapshot", state.tickId],
    receiptHash: await sha256Hex(memoryValue), // self-attested
  });
}

// Trend query (used by the tick handler to detect declining trajectories):
async function queryMetabolicTrend(
  ctx: QueryCtx,
  windowHours: number = 24,
): Promise<{ dhfiSlope: number; concerningSensors: string[] }> {
  const cutoff = Date.now() - windowHours * 3600_000;
  const snapshots = await ctx.db
    .query("aukora_metabolism_history")
    .withIndex("by_computedAt", (q) => q.gte("computedAt", cutoff))
    .collect();

  // Linear regression on DHFI over time
  const dhfiSlope = linearRegressionSlope(snapshots.map((s) => ({ x: s.computedAt, y: s.flexibilityIndex })));

  // Identify sensors with consistently declining readings
  const concerningSensors = identifyDecliningSensors(snapshots);

  return { dhfiSlope, concerningSensors };
}
```

---

## 6. THE METABOLISM TICK — CONVEX IMPLEMENTATION

### 6.1 Cron Configuration

```typescript
// convex/crons.ts — addition

import { cronJobs } from "./_generated/server";

// Metabolism tick: every 60 seconds
cronJobs.interval(
  "metabolismTick",
  { seconds: 60 },
  "aukoraMetabolism:tick",
);

// Metabolism challenge: every 4 hours (only during GROWTH)
cronJobs.interval(
  "metabolismChallenge",
  { hours: 4 },
  "aukoraMetabolism:scheduleChallenge",
);
```

### 6.2 Tick Handler

```typescript
// convex/aukoraMetabolism.ts

export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tickSeq = await getNextTickSeq(ctx);
    const tickId = `tick_${String(tickSeq).padStart(8, "0")}`;
    const now = Date.now();

    // 1. Read all sensor latest values
    const sensors = await ctx.db
      .query("aukora_metabolism_sensors")
      .collect();

    // 2. Assemble state vector
    const state = assembleStateVector(sensors, tickId, now);

    // 3. Compute DHFI
    const dhfiValue = computeDHFI(state);
    const dhfi: DigitalHomeostaticFlexibilityIndex = {
      value: dhfiValue,
      tickId,
      computedAt: now,
      resourceAvailability: mean([state.cpuUtilization, state.memoryPressure, state.storagePressure]),
      inferenceSustainability: mean([state.tokenBudgetRemaining, state.averageLatencyHealth]),
      financialHealth: mean([state.apiQuotaHealth, state.financialBalanceHealth]),
      errorResilience: mean([state.errorRateHealth, state.fuDisagreementLoad, state.testFailureLoad]),
      operationalClarity: mean([state.humanAttentionLoad, state.openIssueLoad]),
      structuralReserve: mean([state.backupHealth, state.redundancyHealth, state.witnessMeshHealth]),
      formula: "dhfi = geo_mean(resource^0.15, inference^0.15, financial^0.10, error^0.20, operational^0.10, reserve^0.30)",
    };

    // 4. Read current operating state
    const currentStateRow = await ctx.db
      .query("aukora_metabolism_state")
      .withIndex("by_stateKey", (q) => q.eq("stateKey", "metabolism:active"))
      .first();
    const currentState = (currentStateRow?.operatingState ?? "MAINTENANCE") as OperatingState;

    // 5. Evaluate transitions
    const transition = evaluateTransitions(currentState, state, dhfi, /* history loaded from aukora_metabolism_history */);

    let newState = currentState;
    let transitionExecuted: StateTransition | null = null;

    if (transition && await checkAllGuards(ctx, transition)) {
      // Execute the transition
      newState = transition.toState;
      transitionExecuted = transition;

      // Write transition receipt
      await recordStateTransitionReceipt(ctx, transition, currentStateRow?.flexibilityIndex ?? 0.5, dhfiValue, state);

      // Maybe trigger Fu review
      await maybeTriggerFuReview(ctx, newState, dhfi, state);
    }

    // 6. Update current state row
    if (currentStateRow) {
      await ctx.db.patch(currentStateRow._id, {
        ...state,
        operatingState: newState,
        flexibilityIndex: dhfiValue,
      });
    } else {
      await ctx.db.insert("aukora_metabolism_state", {
        stateKey: "metabolism:active",
        ...state,
        operatingState: newState,
        flexibilityIndex: dhfiValue,
      });
    }

    // 7. Archive snapshot
    await ctx.db.insert("aukora_metabolism_history", {
      ...state,
      operatingState: newState,
      flexibilityIndex: dhfiValue,
      tickSeq,
      triggerReason: transitionExecuted ? "state_transition" : "scheduled",
    });

    // 8. Record in Kira memory
    await recordMetabolicSnapshotInKira(ctx, state, dhfi);

    return {
      tickId,
      dhfi: dhfiValue,
      operatingState: newState,
      previousState: currentState,
      transition: transitionExecuted?.transitionId ?? null,
      sensorCount: state.sensorCount,
      staleSensorCount: state.staleSensorCount,
    };
  },
});
```

---

## 7. HONEST LIMITATIONS

### 7.1 What This IS

1. **A resource-management state machine.** It tracks measurable system resources, computes a composite health index, and selects among seven operating modes. Every metric is a real, measurable engineering quantity.

2. **A fail-closed safety layer.** The ring ceiling prevents expensive operations when resources are constrained. The hysteresis prevents flapping. The receipts provide auditability.

3. **A control-structure inspired by biology.** The seven states map approximately to biological operating modes (growth, maintenance, stress, repair, dormancy, recovery, reproduction). The DHFI maps approximately to bioenergetic flexibility. The hysteresis maps approximately to biological reluctance to resume full activity after stress.

### 7.2 What This is NOT

1. **NOT artificial life.** There is no metabolism in the biological sense. No ATP is synthesized. No proteins are folded. The "energy" is cloud credits and API quotas, not chemical bond energy. The organism is not "alive" in any biological definition.

2. **NOT consciousness or sentience.** The state machine has no subjective experience. It does not "feel" stress. STRESS is a computational state, not an emotional one. The metaphor is for human operator intuition, not for claiming machine consciousness.

3. **NOT a proven optimal controller.** The seven states, the thresholds, and the DHFI weights are engineering choices, not derived from a control-theory optimization. They should be tuned based on operational experience.

4. **NOT a replacement for infrastructure monitoring.** CloudWatch, Datadog, PagerDuty, and Kubernetes health probes still do the heavy lifting of infrastructure alerting. This layer sits above them, providing *organism-level* state awareness that individual infrastructure monitors cannot.

### 7.3 Where the Metaphor Breaks Down

| Biological Feature | Digital Analog | Breakdown Point |
|--------------------|----------------|-----------------|
| ATP/AMP ratio | CPU/memory utilization | Digital resources are not interconvertible. You cannot turn CPU cycles into memory. Biological energy currencies are fungible. |
| Autophagy (recycling damaged components) | Test-driven refactoring, log pruning | Digital "recycling" is explicit and scheduled, not emergent. There is no lysosome. |
| Inflammatory response | Error rate spike, Fu disagreement | Biological inflammation has memory (priming). Digital error rates are stateless unless we explicitly store history (which we do, but it's not cellular memory). |
| Structural reserve | Backup health, redundancy | Biological structural reserve (synapses, nephrons) cannot be recreated by software. Digital backups can be cloned. The asymmetry matters. |
| Hysteresis after stress | Asymmetric thresholds | Biological hysteresis involves epigenetic and metabolic remodeling. Digital hysteresis is just a counter. |
| Reproduction (mitosis) | Spawning descendant nodes | Biological reproduction copies the genome. Node spawning copies configuration, not runtime state. No epigenetic inheritance. |
| Death | DORMANCY is the closest analog | Biological death is irreversible. Digital dormancy is reversible (with backups). The organism can always be restarted. |
| Senescence (aging) | Receipt chain growth, technical debt | Biological aging is irreversible and universal. Digital "aging" can be reset by migration to fresh infrastructure. |

### 7.4 The Honest Claim

This specification defines a resource-aware operating state controller for the Aukora kernel. It uses biological homeostasis as a *design intuition* — the same way engineers have long used biological metaphors (neural networks, genetic algorithms, immune systems). The implementation is pure software engineering: TypeScript functions, Convex tables, SQL-like queries, and HTTP APIs.

The value of the biological framing is not that it makes the system "alive." The value is that it:
1. Suggests useful state distinctions (the seven states)
2. Suggests useful control patterns (hysteresis, fail-closed, structural reserve weighting)
3. Provides operator intuition ("the organism is stressed" is clearer than "aggregate resource utilization exceeds 0.6 threshold")

The system remains a machine. A well-designed, self-monitoring, state-aware machine — but a machine nonetheless.

---

## 8. OPERATOR INTERFACE

### 8.1 Query: Current Metabolic State

```typescript
// convex/aukoraMetabolism.ts

export const getMetabolicState = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const founder = args.token ? await requireFounderUserIdSafe(ctx, args.token) : null;
    if (!founder) return { authorized: false as const };

    const state = await ctx.db
      .query("aukora_metabolism_state")
      .withIndex("by_stateKey", (q) => q.eq("stateKey", "metabolism:active"))
      .first();
    if (!state) return { authorized: true as const, state: null };

    return {
      authorized: true as const,
      state: {
        operatingState: state.operatingState,
        flexibilityIndex: state.flexibilityIndex,
        cpuUtilization: state.cpuUtilization,
        memoryPressure: state.memoryPressure,
        tokenBudgetRemaining: state.tokenBudgetRemaining,
        errorRateHealth: state.errorRateHealth,
        backupHealth: state.backupHealth,
        computedAt: state.computedAt,
        sensorCount: state.sensorCount,
      },
    };
  },
});
```

### 8.2 Manual State Override

```typescript
// convex/aukoraMetabolism.ts

export const manualStateOverride = internalMutation({
  args: {
    token: v.string(),
    targetState: v.string(), // validated against OperatingState union
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const founder = await requireFounderUserId(ctx, args.token);

    // Validate target state
    const validStates: OperatingState[] = ["GROWTH", "MAINTENANCE", "STRESS", "REPAIR", "DORMANCY", "RECOVERY"];
    if (!validStates.includes(args.targetState as OperatingState)) {
      throw new Error("metabolism_invalid_state");
    }

    const current = await ctx.db
      .query("aukora_metabolism_state")
      .withIndex("by_stateKey", (q) => q.eq("stateKey", "metabolism:active"))
      .first();

    const fromState = (current?.operatingState ?? "MAINTENANCE") as OperatingState;
    const toState = args.targetState as OperatingState;

    // Write override receipt
    const transition: StateTransition = {
      transitionId: `${fromState}_to_${toState}_manual`,
      fromState,
      toState,
      guardType: "manual",
      manualCondition: { requiresFounderApproval: true, requiresFlexibilityIndexAbove: 0.0 },
      minFlexibilityIndex: 0.0, // manual overrides ignore DHFI
    };

    await recordStateTransitionReceipt(ctx, transition, current?.flexibilityIndex ?? 0.5, current?.flexibilityIndex ?? 0.5, current as any);

    // Update state
    if (current) {
      await ctx.db.patch(current._id, { operatingState: toState });
    }

    return { ok: true, fromState, toState, overriddenBy: founder };
  },
});
```

---

## 9. TESTING STRATEGY

### 9.1 Unit Tests (Pure Functions)

| Function | Test Cases | Expected Behavior |
|----------|-----------|-------------------|
| `computeDHFI` | All sensors at 1.0 | Returns ~1.0 |
| `computeDHFI` | All sensors at 0.5 | Returns ~0.5 (geometric mean) |
| `computeDHFI` | One sensor at 0.0, rest at 1.0 | Returns < 0.3 (structural reserve at 0 pulls down) |
| `computeDHFI` | Only structural reserve low | Returns proportionally low (reserve weighted 30%) |
| `metabolicRingCeiling` | Each of 7 states | Returns correct AukoraRing |
| `evaluateTransitions` | GROWTH + DHFI 0.5 for 3 ticks | Returns GROWTH→STRESS transition |
| `evaluateTransitions` | STRESS + DHFI 0.7 for 4 ticks | Returns null (hysteresis requires 5 ticks) |
| `evaluateTransitions` | STRESS + DHFI 0.7 for 5 ticks | Returns STRESS→GROWTH transition |
| `normalizeSensorValue` | Raw at stress threshold | Returns 1.0 |
| `normalizeSensorValue` | Raw at critical threshold | Returns 0.0 |
| `normalizeSensorValue` | Raw between thresholds | Returns linear interpolation |

### 9.2 Integration Tests (Convex Mutations)

| Scenario | Setup | Verification |
|----------|-------|-------------|
| Tick with healthy sensors | All sensors at 0.8+ | State remains GROWTH, DHFI > 0.7 |
| Tick with stressed CPU | cpu:util raw = 95% | State transitions to STRESS after 3 ticks, ring ceiling drops to external |
| Tick with critical memory | mem:pressure raw = 98% | State transitions to REPAIR, Fu council review triggered |
| Manual override to DORMANCY | Founder token + manual mutation | State becomes DORMANCY, receipt written, ring ceiling = observe |
| Recovery from DORMANCY | DHFI > 0.5 + founder clear | State becomes RECOVERY, then GROWTH after 5 ticks |
| Sensor push | pushSensorSample with valid sensor | Sensor row updated, threshold event written if crossed |
| Kill switch interaction | killSwitch = true | STRESS still permitted (conserve resources), but GROWTH and REPRODUCTION blocked |
| Salama interaction | salamaActive = true | Metabolism tick still runs (monitoring is observe-only), but no state transitions to higher rings |

### 9.3 Load Tests

- 1000 metabolism ticks in rapid succession → no OCC conflicts (single row update)
- 50 concurrent sensor pushes → all succeed (different sensor rows)
- Full history query over 10,000 rows → paginated, < 2s

---

## 10. SECURITY CONSIDERATIONS

1. **Metabolism state is advisory, not authority.** The ring ceiling is the only metabolism-derived gate in intent evaluation. All other kernel invariants (sacred, salama, kill switch, authorization) remain unchanged.

2. **Sensor data is untrusted.** The `pushSensorSample` mutation is internal, but a compromised caller could push falsified values. Defense: rate-limit sensor pushes per sensorId; cross-validate critical sensors (e.g., backup health can be verified against receipt chain).

3. **Manual override requires founder.** All manual state changes require AUMLOK founder authentication. No automated system can override to GROWTH or REPRODUCTION without human approval.

4. **State history is append-only.** `aukora_metabolism_history` is never deleted or modified. This provides tamper-evidence (though not tamper-proofing — that would require Merkle chaining, which is reserved for receipts).

5. **DORMANCY is not death.** The system in DORMANCY still responds to observe queries and can exit to RECOVERY. It is a reduced operating mode, not a termination signal.

---

## 11. DEPLOYMENT CHECKLIST

- [ ] Add the 3 new Convex tables to `schema.ts`
- [ ] Implement `aukoraMetabolism.ts` with all types, pure functions, and mutations
- [ ] Add metabolic ring ceiling gate to `evaluateAukoraIntent` in `aukoraCore.ts`
- [ ] Add `metabolismTick` and `metabolismChallenge` to `crons.ts`
- [ ] Configure all 20 sensors in `aukora_metabolism_sensors` (seed script)
- [ ] Implement external sensor push endpoints (HTTP action or internal caller)
- [ ] Add metabolism state to operator console UI
- [ ] Write unit tests for all pure functions
- [ ] Write integration tests for tick handler and state transitions
- [ ] Document operator procedures for manual override
- [ ] Tune thresholds based on 2 weeks of operational data

---

## 12. GLOSSARY

| Term | Definition |
|------|-----------|
| **DHFI** | Digital Homeostatic Flexibility Index — the composite [0,1] health metric |
| **Metabolism tick** | The 60-second cron job that reads sensors, computes DHFI, and evaluates transitions |
| **Ring ceiling** | The maximum Aukora privilege ring permitted in a given operating state |
| **Hysteresis** | Asymmetric thresholds (easier to enter STRESS than exit) to prevent state flapping |
| **Structural reserve** | Backup health + redundancy + witness mesh — the "architecture" that makes recovery possible |
| **Sensor family** | Logical grouping of related sensors (compute, inference, network, etc.) |
| **Challenge** | Controlled resource perturbation to measure dynamic response |
| **State vector** | The 17-dimensional normalized reading set comprising OrganismEnergyState |

---

## APPENDIX A — RELATIONSHIP TO ENERGY_SENSING_V3

This specification is a software-engineering translation of the biological control-state model in `ENERGY_SENSING_V3.md`. The mapping is structural, not mechanistic:

| V3 Biological Concept | Digital Metabolism Analog | Honest Assessment |
|-----------------------|--------------------------|-------------------|
| AMPK activation kinetics | CPU/memory sensor responsiveness | Structural parallel only — no enzyme kinetics |
| mTORC1 suppression | Token budget consumption rate | Rate-limiting exists in both, but the mechanism is entirely different |
| Autophagic flux | Log pruning, test cleanup, garbage collection | Both recycle waste, but autophagy is emergent; digital cleanup is scheduled |
| Structural reserve | Backup health, redundancy, witness mesh | Both enable recovery, but digital reserve is copyable; biological reserve is not |
| Inflammatory reset | Error rate recovery, Fu disagreement resolution | Both require "turning off" after threat passes; digital reset is immediate |
| Energy-Sensing Flexibility Index | DHFI | Same mathematical structure (weighted geometric mean), different variables |
| Three gates (abnormality, reserve, engagement) | Transition guards (threshold, structural_reserve, receipt) | Same control logic, different domain |
| Hysteresis | Asymmetric thresholds | Identical control-theory concept |

The V3 document's kill conditions also have digital analogs:
- "Dynamic challenge assays show no disease-control difference" → "Challenge tests show no correlation between sensor response and actual system health" → **demote challenge system**
- "ESFI fails test-retest reliability" → "DHFI varies > 0.2 between adjacent ticks with no actual change" → **fix normalization or sampling**
- "ESFI does not predict response" → "DHFI does not correlate with incident probability" → **reweight or replace formula**
- "Weight/glycemia fully mediate benefits" → "Raw resource metrics fully explain state transitions, DHFI adds no signal" → **demote DHFI to advisory**
- "Framework requires post-hoc reinterpretation of every negative result" → "Metabolism always narrates away failures" → **abandon the metaphor, keep the metrics**

---

*End of Specification*
