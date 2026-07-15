// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// #183 staleness core — the contract's rules, pinned mechanically:
//   expiry means FLAGGED never hidden; age printed on every read; unknown age is FLAGGED
//   ("waking confidently wrong is worse than waking cold"); a stale draft cannot mint a signing
//   challenge without the owner's EXPLICIT revive; draft builders stamp expires_by at draft time;
//   pre-round-5 artifacts stay valid and get the default horizon; staleness metadata never
//   perturbs the signed proposal hash.
import { describe, it, expect } from 'vitest';
import {
  stampExpiresBy,
  stalenessVerdict,
  challengeStalenessGate,
  DEFAULT_DRAFT_HORIZON_MS,
  EXPIRING_SOON_WINDOW_MS,
} from '../src/stalenessCore';
import * as canonicalStaleness from '@aukora/kernel/staleness';
import * as compatibilityStaleness from '../src/stalenessCore';
import { buildSelfEditProposalArtifact, validateSelfEditProposalArtifact } from '../src/selfEditProposalArtifact';
import { buildProposalIntent, validateProposalIntent } from '../src/proposalIntent';
import { computeProposalHash } from '../src/proposalHash';

const T0 = Date.parse('2026-07-08T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('staleness single-source boundary', () => {
  it('the Symbiote compatibility surface is the canonical Kernel package surface', () => {
    expect(compatibilityStaleness.stampExpiresBy).toBe(canonicalStaleness.stampExpiresBy);
    expect(compatibilityStaleness.stalenessVerdict).toBe(canonicalStaleness.stalenessVerdict);
    expect(compatibilityStaleness.challengeStalenessGate).toBe(canonicalStaleness.challengeStalenessGate);
    expect(compatibilityStaleness.stalenessGrantsAuthority).toBe(canonicalStaleness.stalenessGrantsAuthority);
  });
});

describe('stalenessVerdict — flagged never hidden, age on every read', () => {
  it('fresh inside a stamped horizon; expiringSoon inside the warning window; stale past it', () => {
    const a = { createdAt: iso(T0), expiresBy: iso(T0 + 24 * 3_600_000) };
    expect(stalenessVerdict(a, T0 + 3_600_000)).toMatchObject({ state: 'fresh', flagged: false, ageLabel: '1h old', horizon: 'stamped', expiringSoon: false });
    expect(stalenessVerdict(a, T0 + 24 * 3_600_000 - EXPIRING_SOON_WINDOW_MS + 60_000)).toMatchObject({ state: 'fresh', expiringSoon: true });
    expect(stalenessVerdict(a, T0 + 25 * 3_600_000)).toMatchObject({ state: 'stale', flagged: true, ageLabel: '25h old' });
  });

  it('an unstamped (pre-round-5) artifact gets the default 72h horizon, named as such', () => {
    const a = { createdAt: iso(T0) };
    expect(stalenessVerdict(a, T0 + 71 * 3_600_000)).toMatchObject({ state: 'fresh', horizon: 'default-draft-72h' });
    expect(stalenessVerdict(a, T0 + DEFAULT_DRAFT_HORIZON_MS + 1)).toMatchObject({ state: 'stale', flagged: true });
  });

  it('unknown age is FLAGGED and says so — never presented as current, never a throw', () => {
    for (const bad of [{}, { createdAt: 42 }, { createdAt: 'not-a-date' }, null]) {
      expect(stalenessVerdict(bad as never, T0)).toMatchObject({ state: 'stale', flagged: true, ageLabel: 'age unknown', horizon: 'unknown-age', ageMs: null });
    }
  });

  it('stampExpiresBy = createdAt + horizon; refuses garbage loudly', () => {
    expect(stampExpiresBy(iso(T0), 3_600_000)).toBe(iso(T0 + 3_600_000));
    expect(() => stampExpiresBy('nope')).toThrow(/created_at_invalid/);
    expect(() => stampExpiresBy(iso(T0), -5)).toThrow(/horizon_invalid/);
  });
});

describe('challengeStalenessGate — stale mints nothing without the explicit revive', () => {
  const fresh = stalenessVerdict({ createdAt: iso(T0), expiresBy: iso(T0 + 3_600_000) }, T0 + 60_000);
  const stale = stalenessVerdict({ createdAt: iso(T0) }, T0 + DEFAULT_DRAFT_HORIZON_MS + 60_000);
  const unknown = stalenessVerdict({}, T0);

  it('fresh passes untouched; stale refuses; stale + revive allows and says revived', () => {
    expect(challengeStalenessGate(fresh, false)).toMatchObject({ allow: true, revived: false });
    expect(challengeStalenessGate(stale, false)).toMatchObject({ allow: false, reason: 'proposal_stale' });
    expect(challengeStalenessGate(stale, true)).toMatchObject({ allow: true, revived: true });
  });

  it('unknown-age is treated as stale (flagged) — revive required there too', () => {
    expect(challengeStalenessGate(unknown, false)).toMatchObject({ allow: false, reason: 'proposal_stale' });
    expect(challengeStalenessGate(unknown, true)).toMatchObject({ allow: true, revived: true });
  });
});

describe('draft-time stamping — both builders, hash law untouched, old artifacts valid', () => {
  it('proposal artifacts stamp expiresBy; the stamp never perturbs the signed hash', () => {
    const files = [{ relPath: 'docs/X.md', content: 'hello' }];
    const a = buildSelfEditProposalArtifact('a goal', files, iso(T0));
    expect(a.expiresBy).toBe(iso(T0 + DEFAULT_DRAFT_HORIZON_MS));
    expect(a.proposalHash).toBe(computeProposalHash('a goal', files)); // goal+files only, forever
    expect(validateSelfEditProposalArtifact(a).valid).toBe(true);
  });

  it('a pre-round-5 artifact (no expiresBy) still validates; a malformed stamp refuses', () => {
    const files = [{ relPath: 'docs/X.md', content: 'hello' }];
    const old = { schema: 'self-edit-proposal-artifact-v1', goal: 'g', files, proposalHash: computeProposalHash('g', files), createdAt: iso(T0) };
    expect(validateSelfEditProposalArtifact(old).valid).toBe(true);
    expect(validateSelfEditProposalArtifact({ ...old, expiresBy: '' }).valid).toBe(false);
    expect(validateSelfEditProposalArtifact({ ...old, expiresBy: 42 }).valid).toBe(false);
  });

  it('intents stamp expiresBy at draft time and stay id-stable + valid', () => {
    const i = buildProposalIntent({ goal: 'restart the chat-door door', affectedPaths: [{ path: 'spatial/serve.ts', epistemicStatus: 'inferred' }], authoredBy: 'arc3' }, iso(T0));
    expect(i.expiresBy).toBe(iso(T0 + DEFAULT_DRAFT_HORIZON_MS));
    expect(validateProposalIntent(i).valid).toBe(true);
    const { expiresBy: _drop, ...pre5 } = i;
    expect(validateProposalIntent(pre5).valid).toBe(true); // old intents unharmed
  });
});
