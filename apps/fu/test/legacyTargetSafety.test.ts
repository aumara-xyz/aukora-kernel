import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertLegacyTargetSafe } from '../legacy/legacyTargetSafety';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function target(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-fu-legacy-target-'));
  roots.push(root);
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return root;
}

describe('legacy target safety', () => {
  it('accepts ordinary source and explicit environment templates', () => {
    const root = target({ 'src/index.ts': 'export {};', '.env.example': 'OPENROUTER_API_KEY=' });
    expect(() => assertLegacyTargetSafe(root)).not.toThrow();
  });

  it('refuses environment and credential files before scanning', () => {
    const envRoot = target({ '.env.local': 'OPENROUTER_API_KEY=secret' });
    const credentialsRoot = target({ 'config/credentials.json': '{}' });
    expect(() => assertLegacyTargetSafe(envRoot)).toThrow('legacy_target_secret_file_refused:.env.local');
    expect(() => assertLegacyTargetSafe(credentialsRoot)).toThrow('legacy_target_secret_file_refused:config/credentials.json');
  });

  it('refuses private-key and seed-shaped filenames', () => {
    const keyRoot = target({ 'keys/reviewer.pem': 'not-a-real-key' });
    const seedRoot = target({ 'state/operator.seed': 'not-a-real-seed' });
    expect(() => assertLegacyTargetSafe(keyRoot)).toThrow('legacy_target_secret_file_refused:keys/reviewer.pem');
    expect(() => assertLegacyTargetSafe(seedRoot)).toThrow('legacy_target_secret_file_refused:state/operator.seed');
  });

  it('refuses symlinks instead of following them', () => {
    const root = target({ 'src/index.ts': 'export {};' });
    fs.symlinkSync('/tmp', path.join(root, 'outside'));
    expect(() => assertLegacyTargetSafe(root)).toThrow('legacy_target_symlink_refused:outside');
  });
});
