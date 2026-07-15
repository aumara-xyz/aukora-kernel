import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeProposalHash } from '../src/proposalHash';
import { rejectPendingProposal } from '../src/aumlokRejectCeremony';
import { readProposalDispositionRows } from '../src/proposalDispositionRead';
import { buildAumlokAssistantView } from '../src/aumlokSigningAssistant';

let home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-reject-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

function stageArtifact(): string {
  const goal = 'change a visible label';
  const files = [{ relPath: 'spatial/app/example.js', content: 'export const label = "new";\n' }];
  const proposalHash = computeProposalHash(goal, files);
  const dir = path.join(home, 'aumlok', 'pending-proposals');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${proposalHash}.json`), JSON.stringify({
    schema: 'self-edit-proposal-artifact-v1', goal, files, proposalHash, createdAt: '2026-07-10T00:00:00.000Z',
  }));
  return proposalHash;
}

describe('rejectPendingProposal', () => {
  it('archives a validated unsigned proposal and records a non-authoritative rejection', () => {
    const hash = stageArtifact();
    const result = rejectPendingProposal(hash, { homeDir: home });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(home, 'aumlok', 'pending-proposals', `${hash}.json`))).toBe(false);
    expect(fs.existsSync(path.join(home, 'aumlok', 'pending-proposals', 'rejected-archive', `${hash}.json`))).toBe(true);
    const rows = readProposalDispositionRows(home, 10).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ proposalHash: hash, disposition: 'rejected', advisoryOnly: true, grantsAuthority: false });
    expect(rows[0].commitSha).toBeUndefined();
    expect(rows[0].receiptHash).toBeUndefined();
    expect(buildAumlokAssistantView({ homeDir: home, repoRoot: home }).pending).toEqual([]);
  });

  it('refuses traversal and never creates a journal row', () => {
    expect(rejectPendingProposal('../../etc/passwd', { homeDir: home }).ok).toBe(false);
    expect(readProposalDispositionRows(home, 10).rows).toEqual([]);
  });

  it('cannot sign or apply: its implementation has no signing or live-apply imports', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'aumlokRejectCeremony.ts'), 'utf-8');
    for (const forbidden of ['aumlokSigner', 'signPromotionAuthorization', 'nativeLiveApply', 'dispatchSignedLiveApply', 'approveAndApplyProposal']) {
      expect(src).not.toContain(forbidden);
    }
  });
});
