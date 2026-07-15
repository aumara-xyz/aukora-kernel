import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildSelfEditProposalArtifact, validateSelfEditProposalArtifact,
  writeSelfEditProposalArtifact, readSelfEditProposalArtifact,
} from '../src/selfEditProposalArtifact';
import { computeProposalHash } from '../src/proposalHash';

let homeDir: string;
afterEach(() => { if (homeDir) fs.rmSync(homeDir, { recursive: true, force: true }); });

describe('selfEditProposalArtifact: hash is always derived, never accepted as input', () => {
  it('builds an artifact whose proposalHash matches computeProposalHash exactly', () => {
    const files = [{ relPath: 'docs/A.md', content: 'x' }];
    const a = buildSelfEditProposalArtifact('goal text', files);
    expect(a.proposalHash).toBe(computeProposalHash('goal text', files));
  });

  it('validates a well-formed artifact', () => {
    const a = buildSelfEditProposalArtifact('g', [{ relPath: 'docs/A.md', content: 'x' }]);
    expect(validateSelfEditProposalArtifact(a)).toEqual({ valid: true });
  });

  it('rejects an artifact whose proposalHash was tampered (does not match goal+files)', () => {
    const a = buildSelfEditProposalArtifact('g', [{ relPath: 'docs/A.md', content: 'x' }]);
    const tampered = { ...a, proposalHash: 'f'.repeat(64) };
    const v = validateSelfEditProposalArtifact(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/tampered|corrupt/);
  });

  it('rejects unknown top-level fields', () => {
    const a: any = { ...buildSelfEditProposalArtifact('g', [{ relPath: 'docs/A.md', content: 'x' }]), extra: 1 };
    expect(validateSelfEditProposalArtifact(a).valid).toBe(false);
  });

  it('rejects missing goal / empty files', () => {
    expect(validateSelfEditProposalArtifact({ schema: 'self-edit-proposal-artifact-v1', goal: '', files: [], proposalHash: 'x', createdAt: 'x' }).valid).toBe(false);
  });
});

describe('selfEditProposalArtifact: disk round-trip (outside the repo)', () => {
  it('writes then reads back an identical, valid artifact', () => {
    homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-proposal-artifact-'));
    const a = buildSelfEditProposalArtifact('add a note', [{ relPath: 'docs/NOTE.md', content: 'hello\n' }]);
    const filePath = writeSelfEditProposalArtifact(a, homeDir);
    expect(filePath.startsWith(homeDir)).toBe(true);
    expect(filePath).toContain(a.proposalHash);

    const read = readSelfEditProposalArtifact(filePath);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.artifact).toEqual(a);
  });

  it('refuses a missing file with a clear reason, never throws', () => {
    const r = readSelfEditProposalArtifact('/does/not/exist/at/all.json');
    expect(r.ok).toBe(false);
  });

  it('refuses invalid JSON without throwing', () => {
    homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-proposal-artifact-'));
    const p = path.join(homeDir, 'bad.json');
    fs.writeFileSync(p, 'not json{{{');
    const r = readSelfEditProposalArtifact(p);
    expect(r.ok).toBe(false);
  });
});
