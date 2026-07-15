import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildAumlokCeremonyDesign, validateAumlokCeremonyDesign, type CeremonyPhase } from '../src/aumlokCeremonySpec';

describe('24Z.30: AUMLOK Ceremony design is INERT — identity binding, not power', () => {
  const d = buildAumlokCeremonyDesign();

  it('has all 9 ceremony phases, none granting authority', () => {
    const phases: CeremonyPhase[] = ['preflight_truth', 'scope_declaration', 'authority_exclusions', 'consent_phrase', 'key_custody_declaration', 'signer_label', 'signature_receipt', 'revocation_expiry', 'post_ceremony_truth'];
    expect(d.phases.map((p) => p.phase)).toEqual(phases);
    expect(d.phases.every((p) => p.grantsAuthority === false)).toBe(true);
  });
  it('grants no authority: no Ring-0, no live apply, no production AUMLOK, AI holds no key', () => {
    expect(d.grantsAuthority).toBe(false);
    expect(d.aiHoldsAuthorityKey).toBe(false);
    expect(d.ring0Granted).toBe(false);
    expect(d.liveApplyGranted).toBe(false);
    expect(d.productionAumlok).toBe(false);
    expect(d.signerLabel).toBe('production_not_built');   // lab ≠ production this round
  });
  it('requires human consent + revocation + expiry', () => {
    expect(d.humanConsentRequired).toBe(true);
    expect(d.revocationRequired).toBe(true);
    expect(d.expiryRequired).toBe(true);
  });
  it('scope is a FIXED template (allowed/excluded), not prose-widenable', () => {
    expect(d.scopeTemplate.excluded).toEqual(expect.arrayContaining(['Ring-0', 'production identity']));
    expect(d.scopeTemplate.allowed).not.toContain('gate authorization');
  });
  it('consent phrase is a PLACEHOLDER, not a verified PoP', () => {
    expect(d.consentPhrasePlaceholder.toLowerCase()).toContain('placeholder');
  });
  it('carries NO private key / secret / raw signature material', () => {
    const s = JSON.stringify(d);
    expect(s).not.toMatch(/-----BEGIN|privateKey|signingSeed|signatureBody|sk-[A-Za-z0-9]{12,}|secretBody/i);
    expect(validateAumlokCeremonyDesign(d).ok).toBe(true);
  });
  it('continuity map: L0 present, L1 seeded, L2/L3 future, L4 experimental_gated', () => {
    const byLayer = Object.fromEntries(d.continuityLayers.map((l) => [l.layer, l.status]));
    expect(byLayer.L0).toBe('present'); expect(byLayer.L1).toBe('seeded');
    expect(byLayer.L2).toBe('future'); expect(byLayer.L3).toBe('future'); expect(byLayer.L4).toBe('experimental_gated');
  });
  it('validate REJECTS a tampered design that grants authority / AI key / production / Ring-0 / live apply', () => {
    for (const tamper of [{ grantsAuthority: true }, { aiHoldsAuthorityKey: true }, { productionAumlok: true }, { ring0Granted: true }, { liveApplyGranted: true }, { humanConsentRequired: false }, { revocationRequired: false }]) {
      expect(validateAumlokCeremonyDesign({ ...d, ...(tamper as object) } as any).ok, JSON.stringify(tamper)).toBe(false);
    }
  });
});

describe('24Z.30 FIREWALL: the ceremony spec never touches authority code (one-way)', () => {
  const srcDir = path.resolve(__dirname, '..', 'src');
  it('aumlokCeremonySpec imports NO gate/apply/OpenCode/signer module', () => {
    const s = fs.readFileSync(path.join(srcDir, 'aumlokCeremonySpec.ts'), 'utf-8');
    expect(s).not.toMatch(/from '\.\/(sandboxApply|sandboxApplyPermit|sandboxEngineBridge|openCodeSandboxRunner|mldsaSandboxSigner|kernelActionClassifier|localModelClient)'/);
  });
  it('NO authority module imports the ceremony spec', () => {
    for (const f of ['sandboxApply.ts', 'sandboxApplyPermit.ts', 'sandboxEngineBridge.ts', 'openCodeSandboxRunner.ts', 'mldsaSandboxSigner.ts', 'kernelActionClassifier.ts']) {
      const p = path.join(srcDir, f);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf-8'), f).not.toMatch(/aumlokCeremonySpec/);
    }
  });
});
