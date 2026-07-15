// Contributor node: the machine-local OpenRouter key file (written by the in-app Settings panel). It is a
// runtime API-key convenience only — NOT an AUMLOK signing key — but it must still behave: read a bare key or
// an OPENROUTER_API_KEY=... line, live under the symbiote home (outside the repo), and be resolvable by the
// same resolver the runtime already uses. These tests pin that path and the graceful no-key case.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveApiKey, openrouterKeyFilePath } from '../src/fusionConfig';

const repoRoot = path.join(__dirname, '..', '..');
const chatDoor = fs.readFileSync(path.join(repoRoot, 'spatial', 'chat-serve.ts'), 'utf-8');
const settings = fs.readFileSync(path.join(repoRoot, 'spatial', 'app', 'settings.js'), 'utf-8');
const shell = fs.readFileSync(path.join(repoRoot, 'spatial', 'app', 'shell.js'), 'utf-8');

let home: string;
const saved = { home: process.env.AUKORA_SYMBIOTE_HOME, envKey: process.env.OPENROUTER_API_KEY, HOME: process.env.HOME, fusionEnv: process.env.FUSION_ENV_FILE };
const KEY = 'sk-or-v1-' + 'a'.repeat(40);
const restore = (k: keyof typeof saved, name: string) => { if (saved[k] === undefined) delete process.env[name]; else process.env[name] = saved[k]!; };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-keyfile-'));
  process.env.AUKORA_SYMBIOTE_HOME = home;
  // Hermetic: point HOME at the temp dir too, so the resolver's other real sources on this machine
  // (opencode auth.json under ~/.local/share, ~/... paths) resolve to absent files and cannot leak in.
  process.env.HOME = home;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.FUSION_ENV_FILE;
});
afterEach(() => {
  restore('home', 'AUKORA_SYMBIOTE_HOME'); restore('envKey', 'OPENROUTER_API_KEY');
  restore('HOME', 'HOME'); restore('fusionEnv', 'FUSION_ENV_FILE');
});

describe('openrouter key file (Settings panel source)', () => {
  it('path lives under the symbiote home, outside the repo', () => {
    expect(openrouterKeyFilePath()).toBe(path.join(home, 'openrouter.key'));
    expect(openrouterKeyFilePath().includes('aukora-symbiote') || openrouterKeyFilePath().startsWith(home)).toBe(true);
  });

  it('resolves a BARE key written to the file', () => {
    fs.writeFileSync(openrouterKeyFilePath(), KEY + '\n');
    const r = resolveApiKey();
    expect(r?.key).toBe(KEY);
    expect(r?.source).toContain('Settings');
  });

  it('resolves an OPENROUTER_API_KEY=... line in the file', () => {
    fs.writeFileSync(openrouterKeyFilePath(), `OPENROUTER_API_KEY=${KEY}\n`);
    expect(resolveApiKey()?.key).toBe(KEY);
  });

  it('no file + no env → null (graceful; the UI degrades to a Settings hint)', () => {
    expect(resolveApiKey()).toBeNull();
  });

  it('process.env still wins over the file (explicit env override)', () => {
    fs.writeFileSync(openrouterKeyFilePath(), KEY + '\n');
    const envKey = 'sk-or-v1-' + 'b'.repeat(40);
    process.env.OPENROUTER_API_KEY = envKey;
    expect(resolveApiKey()?.key).toBe(envKey);
  });

  it('an empty/whitespace file does not falsely resolve', () => {
    fs.writeFileSync(openrouterKeyFilePath(), '   \n');
    expect(resolveApiKey()).toBeNull();
  });
});

describe('fresh-node OpenRouter setup wiring', () => {
  it('allows the configured Spatial origin and verifies the saved file becomes the active key', () => {
    expect(chatDoor).toContain('AUKORA_SPATIAL_PORT');
    expect(chatDoor).toContain('const active = cfg.resolveApiKey()');
    expect(chatDoor).toContain('active.key !== raw');
    expect(chatDoor).toContain('fs.rmSync(keyFile, { force: true })');
  });

  it('the canonical birth exit and no-key boot route to Settings; the obsolete intro is unreachable', () => {
    expect(shell).toContain("url.searchParams.get('setup') === 'openrouter'");
    expect(shell).toContain("setOrgan('settings')");
    expect(shell).not.toContain('mountOnboarding');
    expect(shell).not.toContain('First contact');
  });

  it('Settings provides the official OpenRouter account/key destination', () => {
    expect(settings).toContain('Create an OpenRouter account and key');
    expect(settings).toContain('https://openrouter.ai/keys');
    expect(settings).not.toContain('mountOnboarding');
  });
});
