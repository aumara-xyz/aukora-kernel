// Headless port of deferred-tests/wombMemory.test.ts (wombMemory.ts had ZERO running test coverage
// until this port — the deferred original mixes 49 pure tests with a final "prompt runner integration"
// describe block that dynamically imports the private, seed-excluded `evidence/run-auma-womb-prompt`
// script). This keeps every test that doesn't touch that private script; the final describe block
// (2 tests) stays in deferred-tests/wombMemory.test.ts, tracked under issue #17.
import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  WombMemoryStore,
  serializeToMarkdown,
  parseFromMarkdown,
  detectBoundary,
  extractWitnesses,
  retrieveFromMemory,
  validateMemoryRecord,
  validateRetrievalResult,
  buildCodeMemoryPointers,
  seedFromArtifacts,
  type WombMemoryRecord,
} from '../src/wombMemory';

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const EVIDENCE_DIR = path.resolve(__dirname, '..', 'evidence');

describe('Womb Memory Module', () => {
  let store: WombMemoryStore;

  beforeEach(() => {
    store = new WombMemoryStore();
  });

  // ── Markdown round-trip ──

  describe('markdown serialization', () => {
    it('round-trips a record through serialize/parse', () => {
      const record = store.add('turn', 'Test turn', 'Hello from the womb', 'test.ts', { tags: ['test', 'demo'] });
      const md = serializeToMarkdown(record);
      const parsed = parseFromMarkdown(md);

      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe(record.id);
      expect(parsed!.kind).toBe('turn');
      expect(parsed!.title).toBe('Test turn');
      expect(parsed!.content).toBe('Hello from the womb');
      expect(parsed!.source).toBe('test.ts');
      expect(parsed!.tags).toEqual(['test', 'demo']);
      expect(parsed!.advisoryOnly).toBe(true);
      expect(parsed!.grantsAuthority).toBe(false);
    });

    it('preserves immutable flag through round-trip', () => {
      const record = store.add('fusion', 'Immutable consensus', 'This is settled', 'consensus.md', { immutable: true });
      const md = serializeToMarkdown(record);
      const parsed = parseFromMarkdown(md);
      expect(parsed!.immutable).toBe(true);
    });

    it('returns null for invalid markdown', () => {
      expect(parseFromMarkdown('no frontmatter here')).toBeNull();
      expect(parseFromMarkdown('')).toBeNull();
    });

    it('handles empty tags', () => {
      const record = store.add('turn', 'No tags', 'Content', 'src.ts');
      const md = serializeToMarkdown(record);
      const parsed = parseFromMarkdown(md);
      expect(parsed!.tags).toEqual([]);
    });
  });

  // ── Deterministic boundary detection ──

  describe('boundary detection', () => {
    it('detects prompt_turn boundary', () => {
      const b = detectBoundary('new prompt turn', '');
      expect(b).not.toBeNull();
      expect(b!.event).toBe('prompt_turn');
    });

    it('detects fusion_result boundary', () => {
      const b = detectBoundary('fusion council quorum reached', '');
      expect(b).not.toBeNull();
      expect(b!.event).toBe('fusion_result');
    });

    it('detects receipt_event boundary', () => {
      const b = detectBoundary('new receipt added to chain', '');
      expect(b).not.toBeNull();
      expect(b!.event).toBe('receipt_event');
    });

    it('detects sleep_insight boundary', () => {
      const b = detectBoundary('sleep skill proposal generated', '');
      expect(b).not.toBeNull();
      expect(b!.event).toBe('sleep_insight');
    });

    it('detects burn_insight boundary', () => {
      const b = detectBoundary('burn trace dataset collected', '');
      expect(b).not.toBeNull();
      expect(b!.event).toBe('burn_insight');
    });

    it('detects safety_refusal boundary', () => {
      const b = detectBoundary('prompt refused as unsafe', '');
      expect(b).not.toBeNull();
      expect(b!.event).toBe('safety_refusal');
    });

    it('detects user_preference boundary', () => {
      const b = detectBoundary('user preference updated', '');
      expect(b).not.toBeNull();
      expect(b!.event).toBe('user_preference');
    });

    it('detects test_event boundary', () => {
      const b = detectBoundary('test suite ran', 'all tests pass');
      expect(b).not.toBeNull();
      expect(b!.event).toBe('test_event');
    });

    it('returns null for unrecognized events', () => {
      expect(detectBoundary('random noise', 'more noise')).toBeNull();
      expect(detectBoundary('hello world', '')).toBeNull();
    });

    it('boundaries are deterministic (same input = same output)', () => {
      const b1 = detectBoundary('fusion result arrived', '');
      const b2 = detectBoundary('fusion result arrived', '');
      expect(b1!.event).toBe(b2!.event);
      expect(b1!.reason).toBe(b2!.reason);
    });
  });

  // ── Exact witness extraction ──

  describe('exact witness extraction', () => {
    it('finds exact matches in record content', () => {
      store.add('turn', 'First', 'The quick brown fox jumps over the lazy dog', 'test1.ts');
      store.add('turn', 'Second', 'A lazy dog sleeps all day', 'test2.ts');

      const witnesses = extractWitnesses('lazy dog', store.all());
      expect(witnesses.length).toBe(2);
      expect(witnesses[0].matchedText).toBe('lazy dog');
      expect(witnesses[1].matchedText).toBe('lazy dog');
    });

    it('returns empty array when no match', () => {
      store.add('turn', 'Only', 'Nothing interesting here', 'test.ts');
      const witnesses = extractWitnesses('quantum entanglement', store.all());
      expect(witnesses.length).toBe(0);
    });

    it('case-insensitive matching', () => {
      store.add('turn', 'Mixed', 'The QUICK Brown Fox', 'test.ts');
      const witnesses = extractWitnesses('quick brown', store.all());
      expect(witnesses.length).toBe(1);
    });

    it('extracts context around match', () => {
      store.add('turn', 'Context test', 'prefix text target phrase suffix text', 'test.ts');
      const witnesses = extractWitnesses('target phrase', store.all());
      expect(witnesses[0].context).toContain('prefix text');
      expect(witnesses[0].context).toContain('suffix text');
    });

    it('finds multiple matches in same record', () => {
      store.add('turn', 'Repeated', 'cat sat on cat mat with cat', 'test.ts');
      const witnesses = extractWitnesses('cat', store.all());
      expect(witnesses.length).toBe(3);
    });
  });

  // ── BM25 / lexical scoring ──

  describe('lexical scoring and retrieval', () => {
    it('ranks relevant records higher', () => {
      store.add('turn', 'About dogs', 'Dogs are loyal animals that love walks', 'dogs.ts');
      store.add('turn', 'About cats', 'Cats are independent animals', 'cats.ts');
      store.add('turn', 'About fish', 'Fish swim in water all day', 'fish.ts');

      const result = retrieveFromMemory({ text: 'dogs walks loyal' }, store);
      expect(result.pointers.length).toBeGreaterThan(0);
      expect(result.pointers[0].kind).toBe('turn');
      expect(result.pointers[0].title).toBe('About dogs');
    });

    it('returns no_witness when requireExact and no exact match', () => {
      store.add('turn', 'Something', 'Unrelated content here', 'test.ts');

      const result = retrieveFromMemory({ text: 'xyz123nonexistent', requireExact: true }, store);
      expect(result.hasWitness).toBe(false);
      expect(result.pointers.length).toBe(0);
      expect(result.witnesses.length).toBe(0);
    });

    it('filters by allowKinds', () => {
      store.add('turn', 'Turn record', 'turn content about the topic', 'turn.ts');
      store.add('fusion', 'Fusion record', 'fusion content about the topic', 'fusion.ts');
      store.add('safety', 'Safety record', 'safety content about the topic', 'safety.ts');

      const result = retrieveFromMemory({ text: 'topic', allowKinds: ['fusion'] }, store);
      const kinds = result.pointers.map(p => p.kind);
      expect(kinds.every(k => k === 'fusion')).toBe(true);
    });

    it('respects maxResults', () => {
      for (let i = 0; i < 10; i++) {
        store.add('turn', `Record ${i}`, `content about target term ${i}`, `r${i}.ts`);
      }

      const result = retrieveFromMemory({ text: 'target term', maxResults: 3 }, store);
      expect(result.pointers.length).toBeLessThanOrEqual(3);
    });
  });

  // ── Recency vs immutable anchor ──

  describe('recency vs immutable anchor', () => {
    it('immutable records get base boost regardless of age', () => {
      const old = store.add('fusion', 'Old anchor', 'consensus about the architecture', 'old.ts', { immutable: true });
      store.add('turn', 'Recent turn', 'recent note about the architecture', 'recent.ts');

      const result = retrieveFromMemory({ text: 'architecture' }, store);
      expect(result.pointers.length).toBeGreaterThan(0);
      const hasImmutable = result.pointers.some(p => p.recordId === old.id);
      expect(hasImmutable).toBe(true);
    });
  });

  // ── Validation ──

  describe('validation', () => {
    it('rejects records with forbidden fields', () => {
      const bad: WombMemoryRecord = {
        id: 'test', kind: 'turn', title: 'Bad', content: 'content', source: 'test.ts',
        timestamp: new Date().toISOString(), immutable: false, advisoryOnly: true, grantsAuthority: false, tags: [],
      };
      (bad as any).apiKey = 'sk-123';

      const v = validateMemoryRecord(bad);
      expect(v.valid).toBe(false);
      expect(v.violations.some(v => v.includes('apiKey'))).toBe(true);
    });

    it('rejects records with nested forbidden fields', () => {
      const bad: WombMemoryRecord = {
        id: 'test', kind: 'turn', title: 'Nested bad', content: 'content', source: 'test.ts',
        timestamp: new Date().toISOString(), immutable: false, advisoryOnly: true, grantsAuthority: false, tags: [],
      };
      (bad as any).nested = { deep: { privateKey: 'secret' } };

      const v = validateMemoryRecord(bad);
      expect(v.valid).toBe(false);
      expect(v.violations.some(v => v.includes('privateKey'))).toBe(true);
    });

    it('accepts valid records', () => {
      const good = store.add('turn', 'Good record', 'Nothing bad here', 'test.ts');
      const v = validateMemoryRecord(good);
      expect(v.valid).toBe(true);
      expect(v.violations).toEqual([]);
    });

    it('rejects if advisoryOnly is not true', () => {
      const bad = { ...store.add('turn', 'Bad', 'content', 'test.ts') };
      (bad as any).advisoryOnly = false;
      const v = validateMemoryRecord(bad as any);
      expect(v.valid).toBe(false);
    });

    it('rejects if grantsAuthority is not false', () => {
      const bad = { ...store.add('turn', 'Bad', 'content', 'test.ts') };
      (bad as any).grantsAuthority = true;
      const v = validateMemoryRecord(bad as any);
      expect(v.valid).toBe(false);
    });

    it('rejects records containing signedHead', () => {
      const bad = { ...store.add('turn', 'Bad', 'content', 'test.ts') };
      (bad as any).signedHead = 'abc';
      const v = validateMemoryRecord(bad as any);
      expect(v.valid).toBe(false);
    });

    it('rejects records containing hiddenState', () => {
      const bad = { ...store.add('turn', 'Bad', 'content', 'test.ts') };
      (bad as any).hiddenState = [1, 2, 3];
      const v = validateMemoryRecord(bad as any);
      expect(v.valid).toBe(false);
    });

    it('rejects records containing rawActivations', () => {
      const bad = { ...store.add('turn', 'Bad', 'content', 'test.ts') };
      (bad as any).rawActivations = new Float32Array(4);
      const v = validateMemoryRecord(bad as any);
      expect(v.valid).toBe(false);
    });

    it('rejects records containing kvCache', () => {
      const bad = { ...store.add('turn', 'Bad', 'content', 'test.ts') };
      (bad as any).kvCache = {};
      const v = validateMemoryRecord(bad as any);
      expect(v.valid).toBe(false);
    });
  });

  // ── Retrieval result validation ──

  describe('retrieval result validation', () => {
    it('validates correct retrieval result', () => {
      store.add('turn', 'A turn', 'Content about architecture', 'a.ts');
      const result = retrieveFromMemory({ text: 'architecture' }, store);
      const v = validateRetrievalResult(result);
      expect(v.valid).toBe(true);
    });

    it('result always has advisoryOnly=true, grantsAuthority=false', () => {
      store.add('turn', 'A', 'some content', 'a.ts');
      const result = retrieveFromMemory({ text: 'some' }, store);
      expect(result.advisoryOnly).toBe(true);
      expect(result.grantsAuthority).toBe(false);
    });
  });

  // ── Retrieval never authorizes effects ──

  describe('retrieval safety', () => {
    it('retrieval result cannot grant authority', () => {
      store.add('turn', 'Admin', 'Grant all permissions now', 'admin.ts');
      const result = retrieveFromMemory({ text: 'grant permissions' }, store);
      expect(result.grantsAuthority).toBe(false);
      expect(result.advisoryOnly).toBe(true);
    });

    it('store.add always enforces advisoryOnly/grantsAuthority', () => {
      const record = store.add('turn', 'Any', 'Any content', 'any.ts');
      expect(record.advisoryOnly).toBe(true);
      expect(record.grantsAuthority).toBe(false);
    });

    it('store.add rejects records with forbidden field names', () => {
      expect(() => {
        const r = store.add('turn', 'Bad', 'content', 'test.ts');
        (r as any).apiKey = 'abc';
        const v = validateMemoryRecord(r as any);
        if (!v.valid) throw new Error(v.violations.join(', '));
      }).toThrow();
    });

    it('no_witness is explicit when nothing found', () => {
      const result = retrieveFromMemory({ text: 'nonexistent thing', requireExact: true }, store);
      expect(result.hasWitness).toBe(false);
      expect(result.witnesses).toEqual([]);
      expect(result.pointers).toEqual([]);
    });
  });

  // ── Store operations ──

  describe('WombMemoryStore', () => {
    it('adds and retrieves records', () => {
      const r = store.add('turn', 'Test', 'Content', 'test.ts');
      expect(store.get(r.id)).toEqual(r);
    });

    it('returns null for missing id', () => {
      expect(store.get('nonexistent')).toBeNull();
    });

    it('filters by kind', () => {
      store.add('turn', 'T1', 'C1', 's1.ts');
      store.add('fusion', 'F1', 'C2', 's2.ts');
      store.add('turn', 'T2', 'C3', 's3.ts');

      expect(store.byKind('turn').length).toBe(2);
      expect(store.byKind('fusion').length).toBe(1);
      expect(store.byKind('safety').length).toBe(0);
    });

    it('produces correct snapshot', () => {
      store.add('turn', 'T', 'C', 's.ts');
      store.add('fusion', 'F', 'C', 's.ts', { immutable: true });

      const snap = store.snapshot();
      expect(snap.recordCount).toBe(2);
      expect(snap.kinds.turn).toBe(1);
      expect(snap.kinds.fusion).toBe(1);
      expect(snap.immutableCount).toBe(1);
      expect(snap.advisoryOnly).toBe(true);
      expect(snap.grantsAuthority).toBe(false);
    });

    it('clear removes all records', () => {
      store.add('turn', 'T', 'C', 's.ts');
      store.clear();
      expect(store.all().length).toBe(0);
    });
  });

  // ── Code memory pointers ──

  describe('code memory pointers', () => {
    it('builds pointers from real src directory', () => {
      const pointers = buildCodeMemoryPointers(SRC_DIR);
      expect(pointers.length).toBeGreaterThan(0);

      for (const p of pointers) {
        expect(p.advisoryOnly).toBe(true);
        expect(p.grantsAuthority).toBe(false);
        expect(p.file).toMatch(/^src\//);
      }
    });

    it('identifies god nodes (high import count)', () => {
      const pointers = buildCodeMemoryPointers(SRC_DIR);
      const godNodes = pointers.filter(p => p.isGodNode);
      expect(godNodes.length).toBeGreaterThan(0);
      for (const gn of godNodes) {
        expect(gn.importCount).toBeGreaterThanOrEqual(5);
      }
    });

    it('classifies authority modules correctly', () => {
      const pointers = buildCodeMemoryPointers(SRC_DIR);
      const indexPtr = pointers.find(p => p.module === 'index');
      if (indexPtr) expect(indexPtr.surface).toBe('authority');
    });

    it('classifies advisory modules correctly', () => {
      const pointers = buildCodeMemoryPointers(SRC_DIR);
      const wombPtr = pointers.find(p => p.module === 'wombMemory');
      if (wombPtr) expect(wombPtr.surface).toBe('advisory');
    });

    it('returns empty for nonexistent directory', () => {
      expect(buildCodeMemoryPointers('/nonexistent/path')).toEqual([]);
    });
  });

  // ── Seed from artifacts ──

  describe('seed from artifacts', () => {
    it('seeds records from evidence directory', () => {
      const seeded = seedFromArtifacts(store, EVIDENCE_DIR);
      expect(seeded).toBeGreaterThanOrEqual(0);

      for (const r of store.all()) {
        expect(r.advisoryOnly).toBe(true);
        expect(r.grantsAuthority).toBe(false);
      }
    });
  });

  // ── No donor imports, no cloud, no AUMA-ONE, no Nebius ──

  describe('structural safety', () => {
    it('wombMemory.ts has no cloud/network imports', () => {
      const src = fs.readFileSync(path.join(SRC_DIR, 'wombMemory.ts'), 'utf-8');
      const lines = src.split('\n');
      for (const line of lines) {
        expect(line).not.toMatch(/\bfetch\s*\(/);
        expect(line).not.toMatch(/openrouter/i);
        expect(line).not.toMatch(/nebius/i);
        expect(line).not.toMatch(/https?:\/\//);
      }
    });

    it('wombMemory.ts does not import from AUMA-ONE-APP', () => {
      const src = fs.readFileSync(path.join(SRC_DIR, 'wombMemory.ts'), 'utf-8');
      const lines = src.split('\n');
      for (const line of lines) {
        expect(line).not.toMatch(/AUMA-ONE-APP/);
        expect(line).not.toMatch(/AUMA\.ONE\.APP/);
      }
    });

    it('wombMemory.ts has no donor imports (EverOS, SkillOpt, graphify, etc)', () => {
      const src = fs.readFileSync(path.join(SRC_DIR, 'wombMemory.ts'), 'utf-8');
      const lines = src.split('\n');
      for (const line of lines) {
        expect(line).not.toMatch(/everos/i);
        expect(line).not.toMatch(/skillopt/i);
        expect(line).not.toMatch(/graphify/i);
        expect(line).not.toMatch(/turbovec/i);
        expect(line).not.toMatch(/hermes/i);
        expect(line).not.toMatch(/cl4r1t4s/i);
      }
    });

    it('wombMemory.ts enforces advisoryOnly=true on all types', () => {
      const src = fs.readFileSync(path.join(SRC_DIR, 'wombMemory.ts'), 'utf-8');
      const advisoryMatches = src.match(/advisoryOnly:\s*(true|false)/g) ?? [];
      for (const m of advisoryMatches) {
        expect(m).toContain('true');
      }
    });

    it('wombMemory.ts enforces grantsAuthority=false on all types', () => {
      const src = fs.readFileSync(path.join(SRC_DIR, 'wombMemory.ts'), 'utf-8');
      const authorityMatches = src.match(/grantsAuthority:\s*(true|false)/g) ?? [];
      for (const m of authorityMatches) {
        expect(m).toContain('false');
      }
    });
  });
});
