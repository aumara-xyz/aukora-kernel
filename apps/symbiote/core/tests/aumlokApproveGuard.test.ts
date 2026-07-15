// #105b — the approval GATE perimeter. These pin Codex's "only loopback/origin-guarded requests accepted" and
// "lockdown disables approval" requirements at the decision level, so a regression that weakened the CSRF
// perimeter (dropped the Host check, widened ALLOWED_ORIGINS, forgot the lockdown branch) fails the gate.
import { describe, it, expect } from 'vitest';
import {
  evaluateApprovalGate, hostAllowed, originAllowed, secFetchSiteAllowed, type ApprovalGateInputs,
} from '../src/aumlokApproveGuard';

const PORT = 7094; // matches the approve door's default (7092 belongs to the Auma Live / KNVS voice sidecar)
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

// a fully-passing request: armed, advisory, our host, same-origin
const ok = (over: Partial<ApprovalGateInputs> = {}): ApprovalGateInputs => ({
  enabled: true, advisory: true,
  host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, secFetchSite: 'same-origin',
  allowedHosts: HOSTS, allowedOrigins: ORIGINS, ...over,
});

describe('evaluateApprovalGate — every authority endpoint must pass this', () => {
  it('passes an armed, advisory, same-host, same-origin request', () => {
    expect(evaluateApprovalGate(ok())).toEqual({ ok: true });
  });

  it('OFF (not armed) refuses with 403 — arming is the owner’s deliberate act', () => {
    const d = evaluateApprovalGate(ok({ enabled: false }));
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.status).toBe(403); expect(d.reason).toContain('OFF'); }
  });

  it('LOCKDOWN (capability mode not advisory) disables approval', () => {
    const d = evaluateApprovalGate(ok({ advisory: false }));
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.status).toBe(403); expect(d.reason).toContain('lockdown'); }
  });

  it('a FOREIGN host (DNS-rebinding page pointed at 127.0.0.1) is refused', () => {
    const d = evaluateApprovalGate(ok({ host: 'attacker.example:7094', origin: 'http://attacker.example:7094' }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason.toLowerCase()).toContain('host');
  });

  it('a MISSING host is refused (no ambient loopback authority to trust)', () => {
    expect(evaluateApprovalGate(ok({ host: null })).ok).toBe(false);
  });

  it('a CROSS-ORIGIN request (foreign Origin, our host spoofed absent) is refused', () => {
    const d = evaluateApprovalGate(ok({ origin: 'http://evil.example' }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain('cross-origin');
  });

  it('a CROSS-SITE Sec-Fetch-Site is refused even with our host', () => {
    const d = evaluateApprovalGate(ok({ origin: null, secFetchSite: 'cross-site' }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain('cross-site');
  });

  it('localhost host + localhost origin is accepted (the other allowed loopback name)', () => {
    expect(evaluateApprovalGate(ok({ host: `localhost:${PORT}`, origin: `http://localhost:${PORT}` })).ok).toBe(true);
  });

  it('a no-Origin request from our host passes the gate (the documented local-process residual; still needs the phrase)', () => {
    // A local non-browser client (curl) sends a valid Host and no Origin/Sec-Fetch-Site. The gate lets it
    // through — but it still cannot approve without the unguessable, single-use challenge phrase. This is the
    // documented threat model (host code execution already defeats key custody), not a CSRF bypass.
    expect(evaluateApprovalGate(ok({ origin: null, secFetchSite: null })).ok).toBe(true);
  });
});

describe('the individual guards (defense-in-depth, each independently closes an attack)', () => {
  it('hostAllowed: only exact loopback host:port names, never missing/foreign', () => {
    expect(hostAllowed(`127.0.0.1:${PORT}`, HOSTS)).toBe(true);
    expect(hostAllowed(`localhost:${PORT}`, HOSTS)).toBe(true);
    expect(hostAllowed(null, HOSTS)).toBe(false);
    expect(hostAllowed('attacker.example', HOSTS)).toBe(false);
    expect(hostAllowed(`127.0.0.1:9999`, HOSTS)).toBe(false); // wrong port
  });

  it('originAllowed: a present foreign Origin is refused; absent Origin is allowed (guarded elsewhere)', () => {
    expect(originAllowed(`http://127.0.0.1:${PORT}`, ORIGINS)).toBe(true);
    expect(originAllowed('http://evil.example', ORIGINS)).toBe(false);
    expect(originAllowed(null, ORIGINS)).toBe(true);
  });

  it('secFetchSiteAllowed: same-origin/none allowed, cross-site/same-site refused, absent allowed', () => {
    expect(secFetchSiteAllowed('same-origin')).toBe(true);
    expect(secFetchSiteAllowed('none')).toBe(true);
    expect(secFetchSiteAllowed('cross-site')).toBe(false);
    expect(secFetchSiteAllowed('same-site')).toBe(false);
    expect(secFetchSiteAllowed(null)).toBe(true);
  });
});
