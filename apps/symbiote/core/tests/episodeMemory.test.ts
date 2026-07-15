import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { sanitizeEpisode, isFableIngestible, buildEpisode } from '../src/episodeMemory';
import { buildFableIngestionSeed, buildFixtureEpisodeSeed } from '../src/fableIngestionSeed';

const h = (t: string) => crypto.createHash('sha256').update(t).digest('hex');           // a real 64-hex sha256 ref
const complete = (over: Record<string, unknown> = {}) => ({
  episodeId: 'ep1', episodeSource: 'fixture', createdAtBucket: 1, sourceRound: '24Z.29', engineSource: 'local_engine',
  realModelRan: false, synthetic: true, sandboxReceiptHash: h('s'), canonicalizationReceiptHash: h('c'), hrtTraceHash: h('hrt'),
  accordVerdictHash: h('a'), accordTier: 'evidence_only', structuredTruthHash: h('t'), complete: true, notesCategory: 'fixture_seed', ...over,
});

describe('24Z.29: episode schema — receipt-labeled, hash-refs only, no payload', () => {
  it('accepts a complete fixture episode (64-hex sha256 refs are allowed, not flagged as secrets)', () => {
    const r = sanitizeEpisode(complete());
    expect(r.ok).toBe(true);
    expect(r.episode!.fableIngestible).toBe(true);
    expect(r.episode!.sandboxReceiptHash).toBe(h('s'));    // full 64-hex ref preserved
  });
  it('REJECTS raw prompt / model output / hidden payload / secret / signature / key / grant', () => {
    expect(sanitizeEpisode({ ...complete(), rawPrompt: 'do X' }).ok).toBe(false);
    expect(sanitizeEpisode({ ...complete(), note: 'sk-AKIAIOSFODNN7EXAMPLE12' }).ok).toBe(false);
    expect(sanitizeEpisode({ ...complete(), nested: { signatureBody: 'x' } }).ok).toBe(false);
    expect(sanitizeEpisode({ ...complete(), sandboxReceiptHash: 'the actual raw model output text' }).ok).toBe(false); // non-hex "hash" = payload
  });
  it('REJECTS non-plain containers (Map/Set/class) the scanner cannot introspect', () => {
    expect(sanitizeEpisode({ ...complete(), m: new Map([['privateKey', 'x']]) }).ok).toBe(false);
  });
  it('REJECTS a missing episodeSource label (source is load-bearing)', () => {
    const e = complete(); delete (e as any).episodeSource;
    expect(sanitizeEpisode(e).ok).toBe(false);
  });
});

describe('24Z.29: Fable gate — synthetic can never be real; only evidence_only + complete ingests', () => {
  it('a test_double / fixture episode can NEVER be marked real (forced synthetic, realModelRan=false)', () => {
    const r = sanitizeEpisode({ ...complete({ episodeSource: 'test_double', realModelRan: true, synthetic: false }) });
    expect(r.ok).toBe(true);
    expect(r.episode!.realModelRan).toBe(false);   // forced false for a non-real source
    expect(r.episode!.synthetic).toBe(true);       // forced synthetic
  });
  it('an Accord-quarantined episode is NOT Fable-ingestible', () => {
    expect(isFableIngestible(sanitizeEpisode(complete({ accordTier: 'quarantined' })).episode!)).toBe(false);
  });
  it('an incomplete episode is NOT ingestible', () => {
    expect(isFableIngestible(sanitizeEpisode(complete({ complete: false })).episode!)).toBe(false);
  });
  it('failed / untested Accord tiers are NOT ingestible (only evidence_only passes)', () => {
    expect(isFableIngestible(sanitizeEpisode(complete({ accordTier: 'failed' })).episode!)).toBe(false);
    expect(isFableIngestible(sanitizeEpisode(complete({ accordTier: 'untested' })).episode!)).toBe(false);
  });
  // 24Z.29 red-team (MEDIUM): a forged {complete:true} with NO artifact refs must NOT become complete/ingestible.
  it('DERIVES complete from required-ref presence (a forged complete:true with no refs is rejected)', () => {
    const forged = { episodeSource: 'fixture', accordTier: 'evidence_only', realModelRan: false, synthetic: true, complete: true, notesCategory: 'fixture_seed' };
    const r = sanitizeEpisode(forged);
    expect(r.ok).toBe(true);
    expect(r.episode!.complete).toBe(false);          // recomputed: no refs → not complete
    expect(r.episode!.fableIngestible).toBe(false);   // → never ingestible
    expect(buildFableIngestionSeed([forged]).ingestibleCount).toBe(0);
  });
  it('buildEpisode missing a required ref ⇒ incomplete + not ingestible', () => {
    const e = buildEpisode({ episodeId: 'x', episodeSource: 'fixture', sourceRound: '24Z.29', engineSource: 'fixture', accordTier: 'evidence_only', sandboxReceiptHash: h('s') }); // no canon/accord/truth
    expect(e.complete).toBe(false);
    expect(e.fableIngestible).toBe(false);
  });
});

describe('24Z.29: Fable ingestion seed — read-only, no authority, honest counts', () => {
  const seed = buildFableIngestionSeed(buildFixtureEpisodeSeed('24Z.29'));
  it('is read-only / advisory / grants no authority and cannot authorize', () => {
    expect(seed.readOnly).toBe(true);
    expect(seed.advisoryOnly).toBe(true);
    expect(seed.grantsAuthority).toBe(false);
    expect(seed.fableCanAuthorize).toBe(false);
    expect(seed.fableIngestsSyntheticAsReal).toBe(false);
  });
  it('counts honestly: fixtures present, 1 ingestible, 1 quarantined, ZERO real', () => {
    expect(seed.total).toBe(3);
    expect(seed.ingestibleCount).toBe(1);
    expect(seed.quarantinedCount).toBe(1);
    expect(seed.realCount).toBe(0);              // no real model has run
    expect(seed.latestSource).toBe('fixture');
  });
  it('the seed carries NO raw payload (serialized scan clean)', () => {
    const s = JSON.stringify(seed);
    expect(s).not.toMatch(/sk-[A-Za-z0-9]{12,}|privateKey|signatureBody|rawPrompt/);
  });
});

describe('24Z.29 FIREWALL: episode memory + Fable seed never touch authority code (one-way)', () => {
  const srcDir = path.resolve(__dirname, '..', 'src');
  const AUTHORITY = /from '\.\/(sandboxApply|sandboxApplyPermit|sandboxEngineBridge|openCodeSandboxRunner|openCodeSandboxDraftEngine|mldsaSandboxSigner|localModelClient|kernelActionClassifier|openCodeSpawnTransport)'/;
  it('episodeMemory + fableIngestionSeed import NO gate/apply/OpenCode/signer module', () => {
    for (const f of ['episodeMemory.ts', 'fableIngestionSeed.ts']) {
      expect(fs.readFileSync(path.join(srcDir, f), 'utf-8'), f).not.toMatch(AUTHORITY);
    }
  });
  it('NO authority module imports the episode memory / Fable seed', () => {
    for (const f of ['sandboxApply.ts', 'sandboxApplyPermit.ts', 'sandboxEngineBridge.ts', 'openCodeSandboxRunner.ts', 'mldsaSandboxSigner.ts', 'kernelActionClassifier.ts']) {
      const p = path.join(srcDir, f);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf-8'), f).not.toMatch(/episodeMemory|fableIngestionSeed/);
    }
  });
});
