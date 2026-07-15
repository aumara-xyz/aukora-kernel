import { describe, it, expect } from 'vitest';
import {
  buildWorkOrder, validateWorkOrder, ringAuthorization, classifyHighestRing, workOrderGrantsAuthority,
  type GovernedWorkOrderV1,
} from '../src/governedWorkOrder';

describe('governedWorkOrder: the governance matrix (ringAuthorization)', () => {
  it('Ring 0 is never worker-eligible and needs AUMLOK; Fusion mandatory', () => {
    const a = ringAuthorization(0);
    expect(a).toEqual({ ring: 0, workerEligible: false, applyRequires: 'aumlok_signature', fusionCouncil: 'mandatory', neverSelfSignable: true });
  });
  it('Ring 1 needs an owner session grant, not worker-eligible; Fusion mandatory', () => {
    const a = ringAuthorization(1);
    expect(a.workerEligible).toBe(false);
    expect(a.applyRequires).toBe('owner_session_grant');
    expect(a.fusionCouncil).toBe('mandatory');
  });
  it('Ring 2/3/4 are worker-eligible to DRAFT, but v0 still requires AUMLOK for a LIVE apply (no new authority)', () => {
    for (const r of [2, 3, 4] as const) {
      const a = ringAuthorization(r);
      expect(a.workerEligible, `ring ${r}`).toBe(true);
      expect(a.applyRequires, `ring ${r}`).toBe('aumlok_signature'); // v0 grants NO new apply authority
      expect(a.neverSelfSignable).toBe(true);
    }
  });
});

describe('governedWorkOrder: ring classification (most-restrictive wins, fail-closed)', () => {
  it('a docs-only order classifies Ring 3; a state/gate target forces Ring 0', () => {
    expect(classifyHighestRing(['docs/NOTE.md'])).toBe(3);
    expect(classifyHighestRing(['spatial/app/ui/states.js'])).toBe(3);
    expect(classifyHighestRing(['core/src/someFeature.ts'])).toBe(2);
    // mixed: the MOST restrictive (lowest ring) wins
    expect(classifyHighestRing(['docs/NOTE.md', 'core/src/nativeLiveApply.ts'])).toBe(0);
    expect(classifyHighestRing(['spatial/x.js', 'core/tests/y.test.ts'])).toBe(1); // core/tests/** = Ring 1
    expect(classifyHighestRing(['.github/workflows/gate.yml'])).toBe(0); // ratified Q1
  });
  it('an unclassifiable / empty target fails CLOSED to Ring 0', () => {
    expect(classifyHighestRing([])).toBe(0);
    expect(classifyHighestRing(['totally/unknown/path/x.md'])).toBe(0); // no rule matches → fail closed
  });
});

describe('governedWorkOrder: build + invariants', () => {
  const base = { goal: 'add a docs note', requestedBy: 'auma' as const, targetPaths: ['docs/NOTE.md'], now: '2026-07-04T00:00:00Z' };

  it('a built order grants NOTHING and can apply NOTHING', () => {
    const o = buildWorkOrder(base);
    expect(o.advisoryOnly).toBe(true);
    expect(o.grantsAuthority).toBe(false);
    expect(o.canApplyNow).toBe(false);
    expect(workOrderGrantsAuthority(o)).toBe(false);
    expect(o.status).toBe('queued');
    expect(o.ring).toBe(3);
    expect(o.authorization).toEqual(ringAuthorization(3));
    expect(o.source).toBe('local');
  });

  it('a gate-machinery order is auto-classified Ring 0 and is NOT worker-eligible — Auma can queue it, never self-apply it', () => {
    const o = buildWorkOrder({ ...base, goal: 'rewrite the gate', targetPaths: ['core/src/nativeLiveApply.ts'] });
    expect(o.ring).toBe(0);
    expect(o.authorization.workerEligible).toBe(false);
    expect(o.authorization.applyRequires).toBe('aumlok_signature');
  });

  it('id is deterministic for the same goal+paths+time', () => {
    expect(buildWorkOrder(base).id).toBe(buildWorkOrder(base).id);
    expect(buildWorkOrder({ ...base, goal: 'different' }).id).not.toBe(buildWorkOrder(base).id);
  });

  it('a shadow (Nebius/experimental) order is marked and never treated as local — v0 records the provenance', () => {
    const o = buildWorkOrder({ ...base, source: 'shadow' });
    expect(o.source).toBe('shadow'); // enforcement (never trusted into live authority) is the worker brick's job
  });
});

describe('governedWorkOrder: fail-closed validation', () => {
  const good = buildWorkOrder({ goal: 'g', requestedBy: 'auma', targetPaths: ['docs/A.md'], now: '2026-07-04T00:00:00Z' });

  it('accepts a well-formed order', () => {
    expect(validateWorkOrder(good).valid).toBe(true);
  });
  it('rejects a smuggled authority elevation (canApplyNow / grantsAuthority / advisoryOnly flipped)', () => {
    expect(validateWorkOrder({ ...good, canApplyNow: true }).valid).toBe(false);
    expect(validateWorkOrder({ ...good, grantsAuthority: true }).valid).toBe(false);
    expect(validateWorkOrder({ ...good, advisoryOnly: false }).valid).toBe(false);
  });
  it('rejects an authorization that does not match the ring matrix (tampered elevation)', () => {
    const tampered: any = { ...good, authorization: { ...good.authorization, workerEligible: true, applyRequires: 'aumlok_signature' } };
    // good is Ring 3 (workerEligible true already) — force a real mismatch: claim Ring 0 with a permissive matrix
    const forged: any = { ...good, ring: 0, authorization: ringAuthorization(3) };
    expect(validateWorkOrder(forged).valid).toBe(false);
    expect(validateWorkOrder({ ...good, ring: 7 }).valid).toBe(false);
    expect(validateWorkOrder({ ...good, extra: 'x' }).valid).toBe(false);
  });
});
