import { describe, it, expect } from 'vitest';
import { buildWombHeartbeatFrame, heartbeatGrantsAuthority } from '../src/wombHeartbeat';
import { buildReactiveBrainSnapshot } from '../src/reactiveBrainSnapshot';
import { reflect } from '../src/localSeedCognition';
import type { AumlokBondAdvisoryState } from '../src/aumlokBondCeremony';

const READY_BOND: AumlokBondAdvisoryState = {
  bondState: 'ready_for_signature', publicFingerprint: 'fp:abc123', phraseWitnessSummary: 'anchor',
  phraseRevealedOnce: true, signatureRequired: true, privateKeyInArtifact: false, advisoryOnly: true, grantsAuthority: false,
  voicePresenceWitness: { transcriptChallenge: 'c', challengeId: 'c1', livenessMode: 'mock', witnessed: true, voiceIsAuthority: false, advisoryOnly: true, grantsAuthority: false },
};
const brain = () => buildReactiveBrainSnapshot({
  bond: READY_BOND, glyph: { mood: 'calm', focus: 'threshold', confidence: 0.8, mode: 'resting' },
  convex: { bridgeMode: 'local_loopback_readonly', receiptHeadVisible: true },
  evidenceReadability: { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true },
});

describe('24Z.7 womb heartbeat — pulse is not permission', () => {
  it('grants no authority and the gate is hard-closed', () => {
    const f = buildWombHeartbeatFrame({ pulse: 7, brain: brain(), seedMode: reflect({ brain: brain() }).seedMode });
    expect(f.grantsAuthority).toBe(false);
    expect(f.advisoryOnly).toBe(true);
    expect(f.gateOpen).toBe(false);
    expect(heartbeatGrantsAuthority(f)).toBe(false);
  });

  it('nearOpenPreflightStatus is at most pre_signature_complete — never "open"', () => {
    const f = buildWombHeartbeatFrame({ pulse: 1, brain: brain() });
    expect(['incomplete', 'pre_signature_complete']).toContain(f.nearOpenPreflightStatus);
    expect(f.nearOpenPreflightStatus).not.toBe('open');
  });

  it('strip-neutral: dropping the brain leaves authority/gate byte-identical', () => {
    const withBrain = buildWombHeartbeatFrame({ pulse: 3, brain: brain() });
    const without = buildWombHeartbeatFrame({ pulse: 3, brain: null });
    expect(withBrain.grantsAuthority).toBe(without.grantsAuthority);
    expect(withBrain.gateOpen).toBe(without.gateOpen);
    expect(without.aumlokBondState).toBe('unbound');
    expect(without.convexBrainMode).toBe('missing');
  });

  it('pulse is a non-negative integer ordinal (no wall-clock); bad input -> 0', () => {
    expect(buildWombHeartbeatFrame({ pulse: 12.9, brain: null }).pulse).toBe(12);
    expect(buildWombHeartbeatFrame({ pulse: -5, brain: null }).pulse).toBe(0);
    expect(buildWombHeartbeatFrame({ pulse: NaN as any, brain: null }).pulse).toBe(0);
  });

  it('localBirthPosture is local_first and carries seed status', () => {
    const f = buildWombHeartbeatFrame({ pulse: 2, brain: brain(), seedMode: 'reflecting' });
    expect(f.localBirthPosture).toBe('local_first');
    expect(f.seedCognitionStatus).toBe('reflecting');
    expect(buildWombHeartbeatFrame({ pulse: 2, brain: brain() }).seedCognitionStatus).toBe('none');
  });

  it('COMBINED strip-neutrality (GLM/DeepSeek rec): heartbeat+seed+brain present vs all stripped -> gate/authority byte-identical', () => {
    const present = buildWombHeartbeatFrame({ pulse: 5, brain: brain(), seedMode: reflect({ brain: brain() }).seedMode });
    const stripped = buildWombHeartbeatFrame({ pulse: 5, brain: null, seedMode: null });
    // the authority-bearing bits are identical regardless of how rich the signals are
    expect(present.gateOpen).toBe(stripped.gateOpen);
    expect(present.grantsAuthority).toBe(stripped.grantsAuthority);
    expect(present.advisoryOnly).toBe(stripped.advisoryOnly);
    expect(present.nearOpenPreflightStatus).not.toBe('open');
    expect(stripped.nearOpenPreflightStatus).not.toBe('open');
    // the seed grants nothing in either case
    expect(reflect({ brain: brain() }).grantsAuthority).toBe(false);
    expect(reflect({ brain: null }).grantsAuthority).toBe(false);
  });

  it('module is pure — no network/timer/shell surface', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'wombHeartbeat.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(|WebSocket|setInterval|setTimeout|child_process|execFile/);
  });
});
