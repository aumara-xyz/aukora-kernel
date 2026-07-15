import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('legacy synthetic sample evidence', () => {
  it('never claims provider contact, real votes, quorum, or evidence eligibility', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-fu-sample-'));
    roots.push(root);
    fs.copyFileSync(path.resolve('run-council.ts'), path.join(root, 'run-council.ts'));
    fs.cpSync(path.resolve('legacy'), path.join(root, 'legacy'), { recursive: true });

    const result = spawnSync('bun', ['run', 'run-council.ts', '--sample'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENROUTER_API_KEY: '',
        AUKORA_ALLOW_LEGACY_PAID_RUN: '',
        FUSION_MODELS: 'test/model-a,test/model-b',
      },
    });
    expect(result.status, result.stderr).toBe(0);

    const artifact = JSON.parse(fs.readFileSync(path.join(root, 'runs/latest.json'), 'utf8'));
    expect(artifact.runMode).toBe('synthetic-sample');
    expect(artifact.synthetic).toBe(true);
    expect(artifact.evidenceEligible).toBe(false);
    expect(artifact.providerContacted).toBe(false);
    expect(artifact.quorum.status).toBe('SYNTHETIC_SAMPLE');
    expect(artifact.quorum.completedVotes).toBe(0);
    expect(artifact.cells).toHaveLength(10);
    expect(artifact.cells.every((cell: any) => cell.synthetic === true)).toBe(true);
    expect(artifact.cells.every((cell: any) => cell.provider_contacted === false)).toBe(true);
    expect(artifact.cells.every((cell: any) => cell.vote === 'non_vote')).toBe(true);
    expect(result.stdout).toContain('SYNTHETIC_SAMPLE');
  });
});
