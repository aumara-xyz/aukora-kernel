import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  brainGrantsAuthority,
  createEmptyBrain,
  ingestMemory,
  ingestSelfMap,
  loadBrainState,
  recall,
  saveBrainState,
  summarizeBrain,
  verifyBrainState,
} from '../src/kiraBrain';

describe('Kira Brain persistent memory organ', () => {
  it('ingests memories into an append-only receipt chain', () => {
    let state = createEmptyBrain('2026-07-01T00:00:00.000Z');
    state = ingestMemory(state, {
      text: 'Convex receiver reads only loopback public heads and never grants authority.',
      source: 'test',
      scope: 'receiver',
      tags: ['convex', 'readonly'],
      now: '2026-07-01T00:00:01.000Z',
    }).state;
    state = ingestMemory(state, {
      text: 'Kira uses three perceivers: lexical, glyph trigram, and topology scope.',
      source: 'test',
      scope: 'memory',
      tags: ['perceiver', 'interference'],
      now: '2026-07-01T00:00:02.000Z',
    }).state;

    expect(state.receipts).toHaveLength(2);
    expect(state.receipts[0].previousHash).toBe('genesis');
    expect(state.receipts[1].previousHash).toBe(state.receipts[0].id);
    expect(verifyBrainState(state)).toMatchObject({ ok: true, receiptCount: 2, atomCount: 2, grantsAuthority: false });
    expect(brainGrantsAuthority(state)).toBe(false);
  });

  it('recalls with lexical, glyph, and topology perceiver interference plus citations', () => {
    let state = createEmptyBrain();
    state = ingestMemory(state, {
      text: 'The Convex canonical trust boundary requires an explicit ML-DSA pin and high-water freshness.',
      source: 'dojo',
      scope: 'receiver',
      tags: ['convex', 'canonical', 'freshness'],
    }).state;
    state = ingestMemory(state, {
      text: 'The dashboard is a read-only observer and not the organism user interface.',
      source: 'docs',
      scope: 'dashboard',
      tags: ['ui', 'observer'],
    }).state;

    const result = recall(state, 'receiver convex freshness pin', 3);
    expect(result.grantsAuthority).toBe(false);
    expect(result.hits[0].scope).toBe('receiver');
    expect(result.hits[0].receiptId).toBe(state.receipts[0].id);
    expect(result.hits[0].perceivers.map((p) => p.name)).toEqual(['lexical', 'glyph', 'topology']);
    expect(result.hits[0].interferenceScore).toBeGreaterThan(0.25);
    expect(result.hits[0].citation).toContain(result.hits[0].receiptId.slice(0, 16));
  });

  it('persists and reloads the verified brain state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-'));
    const file = path.join(dir, 'brain.json');
    const state = ingestMemory(createEmptyBrain(), {
      text: 'Persistent memory must survive process boundaries.',
      source: 'test',
      scope: 'persistence',
      tags: ['json'],
    }).state;
    saveBrainState(file, state);
    const loaded = loadBrainState(file);
    expect(loaded.receipts[0].id).toBe(state.receipts[0].id);
    expect(summarizeBrain(loaded)).toContain('Kira Brain: 1 atoms, 1 receipts');
  });

  it('a malformed brain file fails TYPED, never with a raw TypeError downstream', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-shape-'));
    const file = path.join(dir, 'brain.json');
    // `null` is valid JSON — must be refused at load, not crash inside the structural check
    fs.writeFileSync(file, 'null');
    expect(() => loadBrainState(file)).toThrow(/kira_state_invalid/);
    // missing receipts/atoms arrays would load "empty" and then crash the first recall() —
    // refuse at the load boundary instead
    fs.writeFileSync(file, JSON.stringify({ schema: 'AUKORA_KIRA_BRAIN_V1', createdAt: 'x', updatedAt: 'x', advisoryOnly: true, grantsAuthority: false }));
    expect(() => loadBrainState(file)).toThrow(/receipts\/atoms must be arrays/);
  });

  describe('atomic writes (issue #79 — interrupted write must not corrupt existing brain)', () => {
    it('a successful save leaves no leftover temp files and reloads cleanly', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-atomic-'));
      const file = path.join(dir, 'brain.json');
      const state = ingestMemory(createEmptyBrain(), { text: 'a', source: 't', scope: 's', tags: [] }).state;
      saveBrainState(file, state);
      expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
      expect(loadBrainState(file).atoms.length).toBe(1);
    });

    // Root bypasses directory write permissions, so the induced failure below can't be provoked as root.
    const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    it.skipIf(asRoot)('a failed write does NOT corrupt the existing brain — original preserved, no temp litter', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-atomic-'));
      const file = path.join(dir, 'brain.json');
      const v1 = ingestMemory(createEmptyBrain(), { text: 'first good state', source: 't', scope: 's', tags: [] }).state;
      saveBrainState(file, v1);
      const before = fs.readFileSync(file, 'utf8');

      // Make the directory unwritable so the temp-file open fails partway. Because the write goes to a
      // temp file (never the target directly), the existing brain must be left byte-identical.
      const v2 = ingestMemory(v1, { text: 'second state that must not half-land', source: 't', scope: 's', tags: [] }).state;
      fs.chmodSync(dir, 0o500);
      try {
        expect(() => saveBrainState(file, v2)).toThrow();
      } finally {
        fs.chmodSync(dir, 0o700); // restore so the assertions + cleanup can read/write
      }
      expect(fs.readFileSync(file, 'utf8')).toBe(before);          // original byte-identical
      expect(loadBrainState(file).atoms.length).toBe(1);           // still the v1 brain, fully loadable
      expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]); // no temp litter
    });
  });

  it('self-maps a repo into code_map atoms without touching authority', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-map-'));
    fs.mkdirSync(path.join(root, 'core'), { recursive: true });
    fs.writeFileSync(path.join(root, 'README.md'), '# Seed\nMemory suggests, never authorizes.\n');
    fs.writeFileSync(path.join(root, 'core', 'brain.ts'), 'export const brain = "advisory";\n');

    const result = ingestSelfMap(createEmptyBrain(), root, { maxFiles: 4, now: '2026-07-01T00:00:00.000Z' });
    expect(result.ingested).toBe(2);
    expect(result.state.atoms.every((a) => a.kind === 'code_map')).toBe(true);
    expect(result.state.atoms.every((a) => a.grantsAuthority === false)).toBe(true);
    expect(verifyBrainState(result.state).ok).toBe(true);
  });

  it('caps test files so they cannot flood the budget — docs still win when present (issue #62 part 2)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-map-cap-'));
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    // 20 test files (would flood) + 5 docs — the real-world shape that left the brain 92% tests.
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(root, 'tests', `t${i}.test.ts`), `// test ${i}\n`);
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, 'docs', `d${i}.md`), `# doc ${i}\ncontent\n`);

    const result = ingestSelfMap(createEmptyBrain(), root, { maxFiles: 40, maxTestFiles: 10, now: '2026-07-01T00:00:00.000Z' });
    const testAtoms = result.state.atoms.filter((a) => a.scope === 'tests');
    const docAtoms = result.state.atoms.filter((a) => a.scope === 'docs');
    expect(testAtoms.length).toBeLessThanOrEqual(10); // capped, cannot flood
    expect(docAtoms.length).toBe(5); // every doc wins the budget the cap freed
    expect(verifyBrainState(result.state).ok).toBe(true);
  });

  it('the test-file cap also matches .test.ts / .spec.ts files outside a tests/ dir', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-map-cap2-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    for (let i = 0; i < 15; i++) fs.writeFileSync(path.join(root, 'src', `mod${i}.test.ts`), `// spec ${i}\n`);
    fs.writeFileSync(path.join(root, 'src', 'real.ts'), 'export const x = 1;\n');

    const result = ingestSelfMap(createEmptyBrain(), root, { maxFiles: 40, maxTestFiles: 3, now: '2026-07-01T00:00:00.000Z' });
    const testAtoms = result.state.atoms.filter((a) => /\.test\.ts$/.test((a.links ?? [])[0] ?? ''));
    const realAtoms = result.state.atoms.filter((a) => (a.links ?? [])[0] === 'src/real.ts');
    expect(testAtoms.length).toBeLessThanOrEqual(3);
    expect(realAtoms.length).toBe(1); // the non-test file always gets in
  });

  it('never ingests through a symlinked file or directory — count matches the no-symlink baseline (#75)', () => {
    // Baseline: a plain fixture repo with two real files.
    const baseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-map-nolink-'));
    fs.writeFileSync(path.join(baseRoot, 'README.md'), '# Seed\n');
    fs.mkdirSync(path.join(baseRoot, 'core'), { recursive: true });
    fs.writeFileSync(path.join(baseRoot, 'core', 'brain.ts'), 'export const x = 1;\n');
    const baseline = ingestSelfMap(createEmptyBrain(), baseRoot, { maxFiles: 40, now: '2026-07-01T00:00:00.000Z' });
    expect(baseline.ingested).toBe(2);

    // Same repo + a symlinked file and a symlinked directory, both pointing OUTSIDE the repo.
    const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-map-link-'));
    fs.writeFileSync(path.join(linkRoot, 'README.md'), '# Seed\n');
    fs.mkdirSync(path.join(linkRoot, 'core'), { recursive: true });
    fs.writeFileSync(path.join(linkRoot, 'core', 'brain.ts'), 'export const x = 1;\n');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-map-outside-'));
    // Unique content markers: a symlinked component must never reach the CONTENT read (the ingest now reads
    // resolved.real, not the pre-resolver join) — so these bytes must never land in an atom.
    fs.writeFileSync(path.join(outside, 'payload.md'), '# exfiltrate OUTSIDE_FILE_MARKER_75\n');
    fs.mkdirSync(path.join(outside, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'subdir', 'more.ts'), 'export const y = 2; // OUTSIDE_DIR_MARKER_75\n');
    fs.symlinkSync(path.join(outside, 'payload.md'), path.join(linkRoot, 'linked.md'));       // file symlink
    fs.symlinkSync(path.join(outside, 'subdir'), path.join(linkRoot, 'linkeddir'), 'dir');    // dir symlink

    const withLinks = ingestSelfMap(createEmptyBrain(), linkRoot, { maxFiles: 40, now: '2026-07-01T00:00:00.000Z' });
    expect(withLinks.ingested).toBe(baseline.ingested); // symlinked file + dir contribute NOTHING
    const links = withLinks.state.atoms.flatMap((a) => a.links ?? []);
    expect(links.some((l) => l.includes('linked'))).toBe(false); // no symlinked path recorded in an atom
    const allAtomText = JSON.stringify(withLinks.state.atoms);
    expect(allAtomText).not.toContain('OUTSIDE_FILE_MARKER_75'); // symlinked file CONTENT never read into an atom
    expect(allAtomText).not.toContain('OUTSIDE_DIR_MARKER_75');  // symlinked dir CONTENT never read into an atom

    for (const d of [baseRoot, linkRoot, outside]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('never ingests a secret-shaped file into the brain — the sensitive policy applies to the self-map too (#75)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-map-secret-'));
    fs.writeFileSync(path.join(root, 'README.md'), '# Seed\n'); // benign — must still map
    // Secret-shaped, ALLOWED-extension files (.json is walked). These must NOT enter the persistent, append-
    // only brain. Regression guard for the leak an earlier self-map sensitive-policy opt-out would have
    // opened — caught in adversarial review and removed. The extension allow-list is not a secret filter.
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'auth.json'), '{"marker":"SECRET_AUTH_VALUE"}\n');
    fs.writeFileSync(path.join(root, 'config', 'credentials.json'), '{"marker":"SECRET_CRED_VALUE"}\n');
    const result = ingestSelfMap(createEmptyBrain(), root, { maxFiles: 40, now: '2026-07-01T00:00:00.000Z' });
    const links = result.state.atoms.flatMap((a) => a.links ?? []);
    expect(links.some((l) => l.endsWith('auth.json'))).toBe(false);      // refused, not mapped
    expect(links.some((l) => l.includes('credentials.json'))).toBe(false);
    const allAtomText = JSON.stringify(result.state.atoms);
    expect(allAtomText).not.toContain('SECRET_AUTH_VALUE');               // content never entered the brain
    expect(allAtomText).not.toContain('SECRET_CRED_VALUE');
    expect(links.some((l) => l.endsWith('README.md'))).toBe(true);        // benign file still maps
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects secret-looking memory content before it can enter the brain', () => {
    expect(() => ingestMemory(createEmptyBrain(), {
      text: 'do not ingest sk-thisshouldnotbeallowed',
      source: 'bad',
      scope: 'bad',
    })).toThrow(/kira_forbidden_content/);
  });

  // Issue #25 follow-up (Fable QA): workbenchCommandLoop.ts's captureWorkbenchEvent now truncates long
  // hex runs BEFORE calling ingestMemory (a chokepoint fix for a real bug — raw receipt hashes used to
  // silently fail this exact guard, swallowed by an empty catch). That fix must never mean this guard
  // itself got weakened — pin it directly, independent of the workbench's own truncation.
  it('still rejects a raw 64+ hex-char run (sha256/commit-sha shaped content) — the guard was NOT weakened by the workbench truncation fix', () => {
    expect(() => ingestMemory(createEmptyBrain(), {
      text: `receiptHash=${'a'.repeat(64)}`,
      source: 'test',
      scope: 'test',
    })).toThrow(/kira_forbidden_content/);
  });

  it('detects receipt-chain tampering', () => {
    const state = ingestMemory(createEmptyBrain(), {
      text: 'tamper test',
      source: 'test',
      scope: 'verify',
    }).state;
    const tampered = JSON.parse(JSON.stringify(state));
    tampered.receipts[0].previousHash = 'evil';
    const result = verifyBrainState(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('previousHash mismatch');
  });
});
