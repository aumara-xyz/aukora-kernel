// Seed-native truth test for runtimeTruthManifest. Required by the hardening brief: the manifest must
// describe THE SEED, not the old host/UI shell — no host-runtime mythology, Convex read-only, UI is an
// observer, and HEADLESS != PROMOTION. (Forbidden host words are split so THIS enforcer file does not
// itself contain the literal tokens a drift-scan greps for.)
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildRuntimeTruthManifest, summarizeManifest, manifestGrantsAuthority } from '../src/runtimeTruthManifest';

const SRC = readFileSync(join(__dirname, '..', 'src', 'runtimeTruthManifest.ts'), 'utf-8');
const HOST_WORDS = ['T' + 'ori', 'T' + 'ory', 'T' + 'rinity']; // split: this file stays clean of the literals
const HOST_RE = new RegExp('\\b(' + HOST_WORDS.join('|') + ')\\b', 'i');

describe('runtimeTruthManifest is seed-native + truthful', () => {
  const m = buildRuntimeTruthManifest();

  it('no host-shell language in the manifest source or its summary', () => {
    expect(HOST_RE.test(SRC)).toBe(false);
    expect(HOST_RE.test(summarizeManifest(m))).toBe(false);
  });

  it('generatedFromRoot is the SEED root, not a host parent', () => {
    // Issue #21: detect the seed root by marker files, not a literal checkout-dir-name assumption —
    // generatedFromRoot is already correctly self-rooted (path.resolve(__dirname, '..', '..') in the
    // source); this just stops asserting a fragile literal that breaks on any other clone dir name.
    expect(existsSync(join(m.generatedFromRoot, 'core', 'package.json'))).toBe(true);
    expect(existsSync(join(m.generatedFromRoot, 'scripts', 'test.sh'))).toBe(true);
    expect(m.organs).toEqual(expect.arrayContaining(['core', 'authority', 'memory']));
  });

  it('donors appear only as external provenance, never as organs', () => {
    expect(m.organs.some((o) => o.startsWith('donor:'))).toBe(false);
    for (const d of m.donors) expect(m.organs).not.toContain(d);
  });

  it('Convex is read-only — no write / executor / production', () => {
    expect(m.convex.readOnly).toBe(true);
    expect(m.convex.mutationExposed).toBe(false);
    expect(m.convex.executorWired).toBe(false);
    expect(m.convex.productionConnection).toBe(false);
    expect(m.convex.grantsAuthority).toBe(false);
  });

  it('memory advisory only; receipts canonical; AUMLOK is an honest dev-shim', () => {
    expect(m.memory.advisoryOnly).toBe(true);
    expect(m.memory.grantsAuthority).toBe(false);
    expect(m.receipts.canonical).toBe(true);
    expect(m.aumlok.cryptographic).toBe(false);
  });

  it('UI is observer-only with no authority', () => {
    expect(m.ui.present).toBe(false);
    expect(m.ui.role).toBe('observer_only');
    expect(m.ui.grantsAuthority).toBe(false);
  });

  it('HEADLESS != PROMOTION — self-edit not promotion-ready, rollback partial', () => {
    expect(m.headless).toBe(true);
    expect(m.selfEdit.promotionReady).toBe(false);
    expect(m.selfEdit.sandboxOnly).toBe(true);
    expect(m.rollback.available).toBe('partial');
  });

  it('the manifest grants no authority + shows deferred debt honestly', () => {
    expect(m.grantsAuthority).toBe(false);
    expect(manifestGrantsAuthority(m)).toBe(false);
    expect(m.deferredTestDebt.files).toBeGreaterThanOrEqual(0);
  });
});
