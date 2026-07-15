import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildProposalDispositionArtifact, validateProposalDispositionArtifact } from '../src/proposalDisposition';
import { readProposalDispositionRows, proposalDispositionJournalPath } from '../src/proposalDispositionRead';
import { recordRejectedDisposition, recordSignedAppliedDisposition } from '../src/proposalDispositionWrite';

let home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-disposition-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const input = (over: Record<string, unknown> = {}) => ({
  proposalHash: 'a'.repeat(64),
  disposition: 'signed_applied' as const,
  decidedAt: '2026-07-10T00:00:00.000Z',
  commitSha: 'b'.repeat(40),
  receiptHash: 'c'.repeat(64),
  ...over,
});

describe('proposal disposition artifact', () => {
  it('pins advisory posture and integrity for signed_applied closure', () => {
    const a = buildProposalDispositionArtifact(input());
    expect(validateProposalDispositionArtifact(a)).toEqual({ valid: true });
    expect(a.advisoryOnly).toBe(true);
    expect(a.grantsAuthority).toBe(false);
    expect(a.artifactHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses tampering, unknown fields, and fake commit evidence on a non-applied disposition', () => {
    const a = buildProposalDispositionArtifact(input());
    expect(validateProposalDispositionArtifact({ ...a, proposalHash: 'd'.repeat(64) }).valid).toBe(false);
    expect(validateProposalDispositionArtifact({ ...a, hidden: 'x' }).valid).toBe(false);
    expect(() => buildProposalDispositionArtifact(input({ disposition: 'shelved' }))).toThrow(/non-applied/);
  });

  it('appends once, reads newest-first, and treats an identical retry as idempotent', () => {
    const first = recordSignedAppliedDisposition(input(), home);
    expect(first.ok).toBe(true);
    const duplicate = recordSignedAppliedDisposition(input(), home);
    expect(duplicate.ok && duplicate.duplicate).toBe(true);
    const second = recordSignedAppliedDisposition(input({ proposalHash: 'd'.repeat(64), decidedAt: '2026-07-10T00:01:00.000Z' }), home);
    expect(second.ok).toBe(true);
    const read = readProposalDispositionRows(home, 10);
    expect(read.refusedReason).toBeNull();
    expect(read.total).toBe(2);
    expect(read.rows.map((r) => r.proposalHash)).toEqual(['d'.repeat(64), 'a'.repeat(64)]);
  });

  it('records an explicit rejection without inventing apply evidence', () => {
    const result = recordRejectedDisposition({ proposalHash: 'e'.repeat(64), decidedAt: '2026-07-10T00:02:00.000Z' }, home);
    expect(result.ok).toBe(true);
    const row = readProposalDispositionRows(home, 10).rows[0];
    expect(row).toMatchObject({ proposalHash: 'e'.repeat(64), disposition: 'rejected', advisoryOnly: true, grantsAuthority: false });
    expect(row.commitSha).toBeUndefined();
    expect(row.receiptHash).toBeUndefined();
  });

  it('skips invalid journal lines loudly instead of echoing them', () => {
    const p = proposalDispositionJournalPath(home);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{not json}\n' + JSON.stringify({ schema: 'wrong', secret: 'do-not-echo' }) + '\n');
    const read = readProposalDispositionRows(home, 10);
    expect(read.rows).toEqual([]);
    expect(read.skippedInvalid).toBe(2);
  });

  it('the ceremony records closure only after a successful apply result exists', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'aumlokApproveCeremony.ts'), 'utf-8');
    const applyAt = src.indexOf('dispatchSignedLiveApply(');
    const successAt = src.indexOf('if (!result.ok || !result.receipt)');
    const dispositionAt = src.indexOf('recordSignedAppliedDisposition({');
    expect(applyAt).toBeGreaterThan(-1);
    expect(dispositionAt).toBeGreaterThan(successAt);
  });
});
