import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { decodeJepaState, jepaTelemetryGrantsAuthority, type VkJepaPayload } from '../src/vjepaGlyphTelemetry';

function payload(over: Partial<VkJepaPayload> = {}): VkJepaPayload {
  const latent = over.latent ?? [0.1, 0.2, 0.3, 0.4];
  return {
    payloadId: over.payloadId ?? 'p1',
    latent,
    dims: over.dims ?? latent.length, // dims tracks latent unless a mismatch is explicitly requested
    codebookTag: over.codebookTag ?? 'glyph-v0',
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

describe('24Z.1: V-JEPA glyph telemetry is advisory; deterministic decode-to-audit', () => {
  it('decodes a valid payload to a human-readable audit summary (no raw vector)', () => {
    const a = decodeJepaState(payload());
    expect(a.verdict).toBe('decoded');
    expect(a.grantsAuthority).toBe(false);
    expect(a.advisoryOnly).toBe(true);
    expect(typeof a.summary).toBe('string');
    expect(a.summary).toContain('glyph[glyph-v0]');
    // the raw latent values must NOT appear verbatim in the summary
    expect(a.summary).not.toContain('0.1,0.2');
    expect(a.norm).toBeGreaterThan(0);
  });

  it('is deterministic — same payload yields the same summary', () => {
    expect(decodeJepaState(payload()).summary).toBe(decodeJepaState(payload()).summary);
  });

  it('rejects untranslatable payloads (unknown codebook tag)', () => {
    expect(decodeJepaState(payload({ codebookTag: 'mystery-tag' })).verdict).toBe('rejected_untranslatable');
  });

  it('rejects dims/latent mismatch and empty latent', () => {
    expect(decodeJepaState(payload({ latent: [1, 2, 3], dims: 5 })).verdict).toBe('rejected_untranslatable');
    expect(decodeJepaState(payload({ latent: [], dims: 0 })).verdict).toBe('rejected_untranslatable');
  });

  it('rejects NaN / Infinity latents (fail closed)', () => {
    expect(decodeJepaState(payload({ latent: [1, NaN, 3] })).verdict).toBe('rejected_nonfinite');
    expect(decodeJepaState(payload({ latent: [1, Infinity, 3] })).verdict).toBe('rejected_nonfinite');
    expect(decodeJepaState(payload({ latent: [1, -Infinity, 3] })).verdict).toBe('rejected_nonfinite');
  });

  it('rejects oversize latents (DoS guard)', () => {
    const big = new Array(5000).fill(0.01);
    expect(decodeJepaState(payload({ latent: big, dims: big.length })).verdict).toBe('rejected_oversize');
  });

  it('rejected payloads carry no norm and grant no authority', () => {
    const r = decodeJepaState(payload({ codebookTag: 'mystery' }));
    expect(r.norm).toBeNull();
    expect(r.grantsAuthority).toBe(false);
  });

  it('telemetry never grants authority / is not authority confidence', () => {
    expect(jepaTelemetryGrantsAuthority()).toBe(false);
  });
});

describe('24Z.1: V-JEPA module source safety', () => {
  const srcDir = path.join(__dirname, '..', 'src');
  const src = fs.readFileSync(path.join(srcDir, 'vjepaGlyphTelemetry.ts'), 'utf-8');

  it('no tensor / GPU / training runtime imports', () => {
    expect(src).not.toMatch(/['"](torch|@tensorflow|onnxruntime|webgpu|vulkan|@xenova)/i);
    expect(src).not.toMatch(/['"]net['"]|['"]http['"]|fetch\s*\(/);
    expect(src).not.toMatch(/\.train\s*\(|trainingLoop|backward\s*\(|optimizer/i);
  });

  it('does not import gate / executor / evaluateIntent', () => {
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    for (const l of importLines) {
      expect(l).not.toMatch(/\.\/(gate|executor|index)['"]/);
      expect(l).not.toContain('evaluateIntent');
      expect(l).not.toContain('AUMA-ONE-APP');
    }
  });

  it('Gate / executor / evaluateIntent do NOT import the V-JEPA telemetry (raw latent unreachable)', () => {
    for (const f of ['index.ts', 'executor.ts', 'activeInferenceLoop.ts']) {
      const p = path.join(srcDir, f);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf-8')).not.toContain('vjepaGlyphTelemetry');
    }
  });

  it('grantsAuthority is hardcoded false', () => {
    expect(src).toContain('grantsAuthority: false');
  });
});
