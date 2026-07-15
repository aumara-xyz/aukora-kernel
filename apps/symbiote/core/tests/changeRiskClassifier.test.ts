// classifyRisk coverage (extracted seed-native from the old host engine). Sensitive paths, deletions,
// broad rewrites, and secrets in the diff are HIGH; benign edits stay LOW. The classifier only reports
// risk — it grants no authority and applies nothing.
import { describe, it, expect } from 'vitest';
import { classifyRisk, type HostChangedFile } from '../src/changeRiskClassifier';

const cf = (path: string, status: HostChangedFile['status'] = 'modified'): HostChangedFile => ({ path, status });

describe('changeRiskClassifier — sensitive / delete / broad / secret = HIGH', () => {
  it('a normal app-source edit is LOW risk', () => {
    expect(classifyRisk([cf('app/components/Hello.tsx')], '+a\n-b').risk).toBe('low');
  });
  it('sensitive paths (.env / signer / aumlok) are HIGH risk', () => {
    expect(classifyRisk([cf('config/.env')], '+a').risk).toBe('high');
    expect(classifyRisk([cf('src/manifestSigner.ts')], '+a').risk).toBe('high');
    expect(classifyRisk([cf('authority/aumlok/ceremony.ts')], '+a').risk).toBe('high');
  });
  it('a deletion is HIGH risk', () => {
    expect(classifyRisk([cf('app/x.tsx', 'deleted')], '-a').risk).toBe('high');
  });
  it('a broad rewrite (many files) is HIGH risk', () => {
    expect(classifyRisk(Array.from({ length: 12 }, (_, i) => cf(`app/f${i}.tsx`)), '+a').risk).toBe('high');
  });
  it('a secret introduced in the diff is HIGH risk even in a normal file', () => {
    expect(classifyRisk([cf('app/x.tsx')], '+const k = "sk-ABCDEF0123456789QRSTUV";').risk).toBe('high');
  });
  it('PRECISION: a benign long hex in a normal file stays LOW', () => {
    expect(classifyRisk([cf('app/x.tsx')], '+const hash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";').risk).toBe('low');
  });
  it('the classifier reports risk + reasons, and grants no authority', () => {
    const r = classifyRisk([cf('app/x.tsx')], '+a');
    expect(r).toHaveProperty('risk');
    expect(Array.isArray(r.reasons)).toBe(true);
  });
});
