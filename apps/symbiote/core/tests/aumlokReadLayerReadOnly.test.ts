// #105 read layer — STRUCTURAL proof that the AUMLOK read surface is READ-ONLY. Codex's hard boundary:
// the endpoint/view path must import NOTHING that signs, applies, unlocks, or handles a key. This scans the
// import lines of the two modules the GET /api/aumlok path runs (buildAumlokAssistantView + computeProposalPreview)
// and asserts none of them reaches an authority/apply/sign/key module. (The whole-repo authority-import
// firewall test is the general guard; this is the targeted, self-documenting one for the read layer.)
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildAumlokAssistantView } from '../src/aumlokSigningAssistant';

const SRC = path.join(__dirname, '..', 'src');
const importLines = (file: string): string =>
  fs.readFileSync(path.join(SRC, file), 'utf-8').split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');

// Modules that sign, apply live, unlock, mint authority, or handle keys. A read-only view imports NONE.
const FORBIDDEN = [
  'nativeLiveApply', 'aumlokSigner', 'aumlokAuthorityRoot', 'aumlokManifests', 'aukoraGate',
  'aumlokBondCeremony', 'nativeLiveApply', 'kernelAdapter',
];

describe('#105 read layer is structurally read-only', () => {
  it('proposalPreview.ts imports nothing that signs/applies/unlocks/handles a key', () => {
    const imports = importLines('proposalPreview.ts');
    for (const f of FORBIDDEN) expect(imports).not.toContain(f);
    // it may only touch the confined resolver + the forbidden-content scanner + fs
    expect(imports).toContain('repoReadPathResolver');
    expect(imports).toContain('forbiddenContent');
  });

  it('aumlokSigningAssistant.ts (the /api/aumlok view builder) imports nothing that signs/applies/unlocks', () => {
    const imports = importLines('aumlokSigningAssistant.ts');
    for (const f of FORBIDDEN) expect(imports).not.toContain(f);
  });

  it('the view it returns carries advisoryOnly + grantsAuthority:false and never a livePromotion unlock', () => {
    const view = buildAumlokAssistantView({ homeDir: fs.mkdtempSync(path.join(require('os').tmpdir(), 'aumlok-ro-')) });
    expect(view.advisoryOnly).toBe(true);
    expect(view.grantsAuthority).toBe(false);
    expect(view.status.livePromotionUnlocked).toBe(false);
    // every pending proposal is advisory + carries a preview array (never file content outside it)
    for (const p of view.pending) {
      expect(p.advisoryOnly).toBe(true);
      expect(p.grantsAuthority).toBe(false);
      expect(Array.isArray(p.preview)).toBe(true);
    }
  });
});
