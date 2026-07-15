import { describe, it, expect } from 'vitest';
import { isStrictLoopbackUrl } from '../src/localModelClient';
import { evaluateEndpointReadiness, summarizeReadiness } from '../src/localEndpointReadiness';

// 24Z.33 Part B — endpoint readiness: strict-literal loopback guard + the parked-vs-real gate. No real model ran.

describe('24Z.33 strict-literal loopback guard', () => {
  it('accepts the literals 127.0.0.1 / ::1 (un-rebindable)', () => {
    expect(isStrictLoopbackUrl('http://127.0.0.1:11434/v1/chat', { strictLiteralOnly: true })).toBe(true);
    expect(isStrictLoopbackUrl('http://[::1]:8080/', { strictLiteralOnly: true })).toBe(true);
  });
  it('REJECTS the name "localhost" under strictLiteralOnly (DNS-rebind residual); allows it only when policy permits', () => {
    expect(isStrictLoopbackUrl('http://localhost:11434/', { strictLiteralOnly: true })).toBe(false);
    expect(isStrictLoopbackUrl('http://localhost:11434/')).toBe(true);   // default policy allows the name
  });
  it('REJECTS external hosts, userinfo tricks, 0.0.0.0, non-http protocols', () => {
    for (const bad of [
      'http://127.0.0.1.evil.com/', 'http://localhost.evil.com/', 'http://[::1]@evil.com/',
      'http://0.0.0.0/', 'http://example.com/', 'https://user:pass@127.0.0.1/',
      'ftp://127.0.0.1/', 'file:///etc/passwd', 'not a url',
    ]) expect(isStrictLoopbackUrl(bad, { strictLiteralOnly: true }), bad).toBe(false);
  });
  it('decimal/hex notations of the loopback IP normalize to 127.0.0.1 (genuinely loopback → accepted, safe)', () => {
    // the URL parser canonicalizes 2130706433 == 0x7f000001 == 127.0.0.1; these cannot point anywhere but loopback.
    expect(isStrictLoopbackUrl('http://2130706433/', { strictLiteralOnly: true })).toBe(true);
    expect(isStrictLoopbackUrl('http://0x7f000001/', { strictLiteralOnly: true })).toBe(true);
  });
});

describe('24Z.33 endpoint readiness gate (pure policy; apply permit never unlocks spawn)', () => {
  const ready = { endpointConfigured: true, strictLoopback: true, reachable: true, labActivationCrossed: true, applyPermitPresent: false };
  it('READY only when configured + strict loopback + reachable + lab activation crossed', () => {
    const v = evaluateEndpointReadiness(ready);
    expect(v.canRunRealModel).toBe(true);
    expect(v.parked).toBe(false);
    expect(v.endpointChecked).toBe(true);
  });
  it('PARKED if any condition fails (configured/loopback/reachable/activation)', () => {
    expect(evaluateEndpointReadiness({ ...ready, endpointConfigured: false }).parked).toBe(true);
    expect(evaluateEndpointReadiness({ ...ready, strictLoopback: false }).parked).toBe(true);
    expect(evaluateEndpointReadiness({ ...ready, reachable: false }).parked).toBe(true);
    expect(evaluateEndpointReadiness({ ...ready, labActivationCrossed: false }).parked).toBe(true);
  });
  it('an apply permit MUST NOT unlock spawn — present permit + no activation stays PARKED', () => {
    const v = evaluateEndpointReadiness({ endpointConfigured: true, strictLoopback: true, reachable: true, labActivationCrossed: false, applyPermitPresent: true });
    expect(v.canRunRealModel).toBe(false);
    expect(v.parked).toBe(true);
    expect(v.applyPermitUnlocksSpawn).toBe(false);
    expect(v.reason).toMatch(/apply permit does NOT unlock spawn/i);
  });
  it('readiness can NEVER activate the production signer', () => {
    expect(evaluateEndpointReadiness(ready).productionSignerActive).toBe(false);
    expect(evaluateEndpointReadiness({ ...ready, applyPermitPresent: true }).productionSignerActive).toBe(false);
  });
  it('summarizeReadiness states the parked/ready verdict honestly', () => {
    expect(summarizeReadiness(evaluateEndpointReadiness({ ...ready, reachable: false }))).toMatch(/PARKED/);
    expect(summarizeReadiness(evaluateEndpointReadiness(ready))).toMatch(/READY/);
  });
});
