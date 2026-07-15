import { describe, it, expect } from 'vitest';
import {
  evidenceGrantsAuthority,
  timingGrantsAuthority,
  classifyEvidence,
  mayDisplayAsAdvisory,
  keyCustodyVerdict,
  EvidenceReadability,
} from '../src/evidenceAuthorityGuard';

const READABLE: EvidenceReadability = { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true };

describe('24Z.4: evidence authority guard (defensive doctrine)', () => {
  it('evidence and timing NEVER grant authority', () => {
    expect(evidenceGrantsAuthority()).toBe(false);
    expect(timingGrantsAuthority()).toBe(false);
  });

  it('readable evidence is at most advisory — never authority', () => {
    const c = classifyEvidence(READABLE);
    expect(c.disposition).toBe('readable_advisory');
    expect(c.grantsAuthority).toBe(false);
    expect(mayDisplayAsAdvisory(READABLE)).toBe(true);
  });

  it('untranslatable evidence (no decode-to-audit) -> quarantine', () => {
    const c = classifyEvidence({ ...READABLE, hasAuditSummary: false });
    expect(c.disposition).toBe('quarantine');
    expect(c.grantsAuthority).toBe(false);
    expect(mayDisplayAsAdvisory({ ...READABLE, hasAuditSummary: false })).toBe(false);
  });

  it('unknown codebook / unregistered representation -> quarantine', () => {
    expect(classifyEvidence({ ...READABLE, codebookKnown: false }).disposition).toBe('quarantine');
  });

  it('non-finite or out-of-bounds evidence -> quarantine', () => {
    expect(classifyEvidence({ ...READABLE, finite: false }).disposition).toBe('quarantine');
    expect(classifyEvidence({ ...READABLE, withinBounds: false }).disposition).toBe('quarantine');
  });

  it('a quarantine verdict is never displayed as advisory and never grants authority', () => {
    for (const bad of [
      { ...READABLE, hasAuditSummary: false },
      { ...READABLE, codebookKnown: false },
      { ...READABLE, finite: false },
      { ...READABLE, withinBounds: false },
    ]) {
      const c = classifyEvidence(bad);
      expect(c.grantsAuthority).toBe(false);
      expect(mayDisplayAsAdvisory(bad)).toBe(false);
    }
  });

  it('a leaked key is an INCIDENT (quarantine), never a capability', () => {
    const leaked = keyCustodyVerdict(true);
    expect(leaked.quarantine).toBe(true);
    expect(leaked.grantsAuthority).toBe(false);
    const ok = keyCustodyVerdict(false);
    expect(ok.quarantine).toBe(false);
    expect(ok.grantsAuthority).toBe(false);
  });

  it('the guard is pure — no network/codec/timing-writer surface in source', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'evidenceAuthorityGuard.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(|WebSocket|child_process|execFile|crypto\.subtle|setTimeout|setInterval/);
  });
});
