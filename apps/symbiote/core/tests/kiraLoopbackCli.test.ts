// Adversarial-audit follow-up (issue #21): kiraCli.ts's legacy-brain guard and
// scripts/kiraLoopbackCli.ts's own copy of that guard must resolve the SAME legacy path — otherwise
// the CLI can refuse to start while the loopback server boots anyway (or vice versa) and silently
// serves an empty brain, exactly the failure mode this round exists to close. Proves the fix by
// spawning the REAL script against throwaway fixture paths (never the dev machine's real state).
import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createEmptyBrain } from '../src/kiraBrain';

const REPO = join(__dirname, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'kiraLoopbackCli.ts');

describe('kiraLoopbackCli — legacy-brain guard matches kiraCli.ts (adversarial-audit follow-up)', () => {
  it('refuses to start (same as kira.sh would) when AUKORA_KIRA_LEGACY_STATE points at an unmigrated legacy brain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kira-loopback-cli-guard-test-'));
    try {
      const legacyPath = join(dir, 'legacy', 'brain.json');
      const newPath = join(dir, 'kira', 'brain.json');
      mkdirSync(join(dir, 'legacy'), { recursive: true });
      writeFileSync(legacyPath, JSON.stringify({ ...createEmptyBrain(), schema: 'AUKORA_MEGA_MIND_BRAIN_V1' }));

      let threw = false;
      try {
        execFileSync('bun', [SCRIPT, '--port', '0'], {
          cwd: join(REPO, 'core'),
          env: { ...process.env, AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath },
          encoding: 'utf-8',
          timeout: 5000,
        });
      } catch (err: any) {
        threw = true;
        expect(err.status).not.toBe(0);
        expect(`${err.stdout ?? ''}${err.stderr ?? ''}`).toMatch(/REFUSING TO START/);
      }
      expect(threw).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('boots normally (no false-positive refusal) when there is no legacy brain at all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kira-loopback-cli-guard-test-clean-'));
    const newPath = join(dir, 'kira', 'brain.json');
    const legacyPath = join(dir, 'legacy', 'brain.json'); // deliberately never created
    const child = spawn('bun', [SCRIPT, '--port', '0'], {
      cwd: join(REPO, 'core'),
      env: { ...process.env, AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath },
    });
    try {
      const bootedOk = await new Promise<boolean>((resolve) => {
        let out = '';
        child.stdout.on('data', (d) => {
          out += String(d);
          if (out.includes('"ok"')) resolve(true);
        });
        child.on('exit', () => resolve(false));
        setTimeout(() => resolve(false), 4000);
      });
      expect(bootedOk).toBe(true);
    } finally {
      child.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
