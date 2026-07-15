/**
 * 24Z.33 Part B — Local model endpoint READINESS evaluator (pure policy; no network, no spawn, no authority).
 *
 * Decides whether a real local-loopback model MAY run, from already-computed booleans. It NEVER spawns, signs, or
 * applies — it only reports a verdict the orchestrator must honor. CORE LAW (encoded here):
 *   - real model may run ONLY when: endpoint configured + STRICT-LITERAL loopback + reachable + lab activation crossed.
 *   - an apply permit MUST NOT unlock spawn — `applyPermitPresent` is accepted but NEVER contributes to the verdict.
 *   - production signer stays false; this evaluator can never set it.
 *   - if any condition fails → PARKED honestly (no real model, no real episode; stubs stay synthetic).
 *
 * This module imports NOTHING from authority or evidence modules (it is a neutral gate-helper): the caller computes
 * `strictLoopback` via localModelClient.isStrictLoopbackUrl(endpoint,{strictLiteralOnly:true}) and `reachable` via
 * probeLocalEndpoint, then passes the booleans here.
 */

export interface EndpointReadinessInput {
  endpointConfigured: boolean;     // a candidate endpoint string was provided at all
  strictLoopback: boolean;         // caller verified strict-literal loopback (127.0.0.1 / ::1, NOT 'localhost')
  reachable: boolean;              // caller probed it (bounded, redirect-refused) and it answered
  labActivationCrossed: boolean;   // the operator EXPLICITLY crossed the lab activation gate (no auto-cross)
  applyPermitPresent: boolean;     // present-or-not is recorded but MUST NOT influence spawn (see law)
}

export interface EndpointReadinessVerdict {
  endpointChecked: true;           // the readiness machinery ran
  strictLoopback: boolean;
  reachable: boolean;
  activationCrossed: boolean;
  applyPermitUnlocksSpawn: false;  // HARD — proven by construction (applyPermitPresent never used below)
  canRunRealModel: boolean;
  parked: boolean;
  productionSignerActive: false;   // HARD — readiness can never activate the production signer
  reason: string;
}

/** Pure, deterministic. canRunRealModel requires ALL of: configured + strict-literal loopback + reachable +
 *  explicit lab activation. The apply permit is deliberately excluded from the conjunction. */
export function evaluateEndpointReadiness(input: EndpointReadinessInput): EndpointReadinessVerdict {
  const canRunRealModel =
    input.endpointConfigured === true &&
    input.strictLoopback === true &&
    input.reachable === true &&
    input.labActivationCrossed === true;
  let reason: string;
  if (canRunRealModel) reason = 'ready: strict-literal loopback reachable + lab activation crossed (real model may run, sandbox-only)';
  else if (!input.endpointConfigured) reason = 'parked: no endpoint configured';
  else if (!input.strictLoopback) reason = 'parked: endpoint is not a strict-literal loopback (127.0.0.1 / ::1)';
  else if (!input.reachable) reason = 'parked: endpoint not reachable';
  else reason = 'parked: lab activation not crossed (an apply permit does NOT unlock spawn)';
  return {
    endpointChecked: true,
    strictLoopback: input.strictLoopback,
    reachable: input.reachable,
    activationCrossed: input.labActivationCrossed,
    applyPermitUnlocksSpawn: false,
    canRunRealModel,
    parked: !canRunRealModel,
    productionSignerActive: false,
    reason,
  };
}

export function summarizeReadiness(v: EndpointReadinessVerdict): string {
  return `Local endpoint readiness: ${v.parked ? 'PARKED' : 'READY'} — ${v.reason}. (apply permit unlocks spawn = no; production signer = no)`;
}
