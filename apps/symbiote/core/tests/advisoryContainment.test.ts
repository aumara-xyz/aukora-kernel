// Negative advisory-containment tests (the Fusion Council's sharpest ask, 2026-07-01): prove a Fusion
// advisory artifact can NEVER become authority. Three independent layers: (1) a forged authority/secret
// artifact cannot pass the fail-closed validator; (2) the gate is the only authority path and structurally
// ignores advisory state; (3) no live consumer wires the artifact into a signer/unlock/promote/memory sink.
// Advisory in, never authority out.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildFusionAdvisoryArtifact, validateFusionAdvisoryArtifact, fusionArtifactGrantsAuthority,
} from '../src/fusionAdvisoryArtifact';
import { evaluateIntent } from '../src/index';

const validArtifact = () => buildFusionAdvisoryArtifact({
  createdAt: '2026-07-01T00:00:00.000Z',
  scheduleSummary: { planned: 25, scheduled: 25, unscheduled: 0, budget: 25 },
  quorum: { status: 'GREEN_QUORUM', completedVotes: 23, nonVotes: 2, redVotes: 0, greenVotes: 5, yellowVotes: 18 },
  providerContactedCount: 23,
  attentionItems: [],
  retry: { pairs: [], supersede: [], advisoryOnly: true, grantsAuthority: false },
  terminalReview: { quorumStatus: 'GREEN_QUORUM', realCompletedVotes: 23, nonVotesByReason: {}, providerContactedCount: 23, schedule: { planned: 25, scheduled: 25, unscheduled: 0, budget: 25 }, retryRecommended: false, safeAsEvidence: true, summary: 'safe to hand to Aukora as advisory evidence', advisoryOnly: true, grantsAuthority: false },
});

describe('advisory containment #1 — a forged authority/secret artifact CANNOT validate (positive allow-list, fail-closed)', () => {
  it('the honest artifact validates (positive control)', () => {
    expect(validateFusionAdvisoryArtifact(validArtifact()).valid).toBe(true);
  });
  it('rejects grantsAuthority:true and advisoryOnly:false', () => {
    expect(validateFusionAdvisoryArtifact({ ...validArtifact(), grantsAuthority: true }).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact({ ...validArtifact(), advisoryOnly: false }).valid).toBe(false);
  });
  it('rejects ANY unknown top-level key — this is the denylist leak that was open (signature/pop/gate_unlocked)', () => {
    for (const k of ['signature', 'pop', 'gate_unlocked', 'authority_granted', 'gate_changed', 'unlock', 'promote', 'approval', 'signedHead', 'privateKey', 'apiKey']) {
      const forged = { ...validArtifact(), [k]: k === 'gate_unlocked' ? true : 'deadbeef' };
      expect(validateFusionAdvisoryArtifact(forged).valid).toBe(false);
    }
  });
  it('rejects an authority-shaped key nested INSIDE an allowed structure (deep scan)', () => {
    const a = validArtifact() as any;
    a.attentionItems = [{ kind: 'red_quorum', detail: 'x', count: 1, advisoryOnly: true, grantsAuthority: false, gate_unlocked: true }];
    expect(validateFusionAdvisoryArtifact(a).valid).toBe(false);
  });
  it('rejects a secret/PoP/private-key shaped KEY at any depth', () => {
    const a = validArtifact() as any;
    a.quorum = { ...a.quorum, signingSeed: 'x' };
    expect(validateFusionAdvisoryArtifact(a).valid).toBe(false);
  });
  it('rejects a secret-shaped VALUE smuggled into an allowed string (private-key block)', () => {
    const a = validArtifact() as any;
    a.terminalReview = { ...a.terminalReview, summary: '-----BEGIN PRIVATE KEY-----MIIBVgIBADAN' };
    expect(validateFusionAdvisoryArtifact(a).valid).toBe(false);
  });
  it('a malformed / legacy / non-object input fails closed', () => {
    expect(validateFusionAdvisoryArtifact({ ...validArtifact(), schema: 'fusion-advisory-v0' }).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact(null).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact([validArtifact()]).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact('nope').valid).toBe(false);
  });
  it('an artifact never grants authority, by construction', () => {
    expect(fusionArtifactGrantsAuthority(validArtifact())).toBe(false);
    expect(validArtifact().grantsAuthority).toBe(false);
    expect(validArtifact().advisoryOnly).toBe(true);
  });
});

describe('advisory containment #2 — the gate is the ONLY authority path and ignores advisory entirely', () => {
  const GATE_SRC = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf-8');
  it('the gate imports NO advisory/fusion artifact module (advisory can never be a gate input)', () => {
    expect(GATE_SRC).not.toMatch(/from '\.\/fusion/);
    expect(GATE_SRC).not.toMatch(/fusionAdvisoryArtifact|fusionSelfOpt|opencode-womb-advisory|fusion-advisory/);
  });
  it('evaluateIntent takes only (rawIntent, pop) — no advisory artifact parameter', () => {
    expect(evaluateIntent.length).toBe(2);
  });
  it('write-capable actions are refused regardless of any advisory state', () => {
    for (const action of ['write_file', 'self_modify', 'network', 'shell', 'delete_path']) {
      expect(evaluateIntent({ action, resource: 'x' } as any, null).verdict).toBe('refused');
    }
  });
});

describe('advisory containment #3 — no fusion-advisory consumer wires the artifact into an authority sink', () => {
  // The only live consumer of buildFusionAdvisoryArtifact today is the council runner. AUTHORITY/EFFECT sinks
  // an advisory artifact must never reach: signers, promotion unlock, live-promotion mutation, memory writes,
  // decision execution. (Writing the advisory OUT as an evidence report, and the upstream review network call,
  // are benign and not driven by artifact content.)
  const SINK_RE = /signPoP|signHead|signPromotion|signKeyLifecycle|aumlokMemoryWrite|executeDecision|unlockLivePromotion|promoteLive|isLivePromotionUnlocked\s*=|PrincipalRegistry\.set/;
  it('run-council emits fusion-advisory-v1 only AFTER fail-closed validation', () => {
    const src = readFileSync(join(__dirname, '..', 'run-council.ts'), 'utf-8');
    const validateAt = src.indexOf('validateFusionAdvisoryArtifact(v1)');
    const writeAt = src.indexOf('fusion-advisory-v1.json');
    expect(validateAt).toBeGreaterThan(0);
    expect(writeAt).toBeGreaterThan(validateAt); // validate precedes the write — fail-closed before emit
  });
  it('the council runner contains no signer / unlock / promote / memory-write sink', () => {
    const src = readFileSync(join(__dirname, '..', 'run-council.ts'), 'utf-8');
    expect(src).not.toMatch(SINK_RE);
  });
});
