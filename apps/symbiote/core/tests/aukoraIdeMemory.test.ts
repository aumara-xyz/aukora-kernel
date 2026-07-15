import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// 24Z.70 P1 — governed memory acceptance. Env files MUST be set before the module captures them, so we dynamic-import.
let mem: typeof import('../../memory/memory');
let chain: typeof import('../../memory/chain');
let dir: string, MEM: string, REC: string, SESS: string;
const setSession = (unlocked: boolean) => writeFileSync(SESS, JSON.stringify({ unlocked, expiresAt: unlocked ? Date.now() + 3600_000 : undefined }));
const receipts = () => (existsSync(REC) ? readFileSync(REC, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'auma-mem-'));
  MEM = join(dir, 'mem.jsonl'); REC = join(dir, 'rec.jsonl'); SESS = join(dir, 'sess.json');
  process.env.AUKORA_IDE_MEMORY_FILE = MEM;
  process.env.AUKORA_IDE_RECEIPTS_FILE = REC;
  process.env.AUKORA_IDE_SESSION_FILE = SESS;
  setSession(true);
  mem = await import('../../memory/memory');
  chain = await import('../../memory/chain');
});
beforeEach(() => { if (existsSync(MEM)) rmSync(MEM); if (existsSync(REC)) rmSync(REC); setSession(true); });

describe('24Z.70 P1 — governed persistent memory', () => {
  it('remember (AUMLOK unlocked) → stored + receipt-coupled (no plaintext in receipt)', () => {
    const r = mem.remember({ content: 'Peter prefers honest partials over over-claims', tier: 'fact' });
    expect(r.ok).toBe(true);
    const recs = receipts().filter((x) => x.kind === 'aukora_memory_v0');
    expect(recs.length).toBe(1);
    expect(recs[0].hash).toBe(r.entry!.hash);
    expect(JSON.stringify(recs[0])).not.toContain('honest partials'); // receipt carries contentHash, never plaintext
  });

  it('CROSS-SESSION: a fact written now is recalled by a FRESH read of the store (file-backed, not in-context)', () => {
    mem.remember({ content: 'the invariant: OpenCode is the body, Aukora is the law' });
    // simulate a brand-new session: read the store fresh from disk
    const recalled = mem.recall();
    expect(recalled.count).toBe(1);
    expect(recalled.facts[0].content).toContain('OpenCode is the body');
    expect(recalled.advisory).toBe(true);
    expect(recalled.banner).toMatch(/NAVIGATES.*does NOT AUTHORIZE/i);
  });

  it('RTBF: forget erases plaintext, keeps the row + chain link, appends a forget receipt; recall drops it', () => {
    const w = mem.remember({ content: 'a secret-free fact to forget' });
    const f = mem.forget({ hash: w.entry!.hash });
    expect(f.ok).toBe(true);
    expect(mem.recall().count).toBe(0); // gone from advisory recall
    const entries = mem.loadEntries(MEM);
    const tomb = entries.find((e) => e.hash === w.entry!.hash)!;
    expect(tomb.status).toBe('tombstoned');
    expect(tomb.content).toBeNull();                       // plaintext erased
    expect(entries.some((e) => e.payload.operation === 'forget' && e.payload.covers === w.entry!.hash)).toBe(true);
    expect(receipts().some((x) => x.kind === 'aukora_memory_forget_v0')).toBe(true);
    expect(mem.verifyChain().ok).toBe(true);               // chain STILL provable after erasure
  });

  it('chain is tamper-evident: corrupting an entry payload breaks verifyChain', () => {
    mem.remember({ content: 'fact one' }); mem.remember({ content: 'fact two' });
    expect(mem.verifyChain().ok).toBe(true);
    const entries = mem.loadEntries(MEM);
    entries[0].payload.contentHash = 'deadbeef';            // tamper
    writeFileSync(MEM, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    expect(mem.verifyChain().ok).toBe(false);
  });

  it('GOVERNED: an apparent secret in a fact → DENY, nothing stored', () => {
    const r = mem.remember({ content: 'my key is sk-abcdef0123456789ABCDEF' });
    expect(r.ok).toBe(false);
    expect(r.effect).toBe('deny');
    expect(mem.loadEntries(MEM).length).toBe(0);
  });

  it('GOVERNED (red-team gaps closed): JWT and key/cert blocks → DENY', () => {
    expect(mem.remember({ content: 'tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJ' }).effect).toBe('deny');
    expect(mem.remember({ content: '-----BEGIN CERTIFICATE-----\nMIIDXTCC\n-----END CERTIFICATE-----' }).effect).toBe('deny');
    expect(mem.loadEntries(MEM).length).toBe(0);
  });

  it('CHAIN-FORGE: a store-only re-chain with a VALID internal hash but NO backing receipt is caught (cross-check)', () => {
    const w = mem.remember({ content: 'a real receipted fact' });
    const entries = mem.loadEntries(MEM);
    const prev = entries[entries.length - 1];
    const payload = { v: 0, actor: 'attacker', chainKey: 'auma-ide', seq: prev.payload.seq + 1, operation: 'remember', tier: 'fact', contentHash: 'f'.repeat(64), createdAt: '2026-01-01T00:00:00.000Z' };
    const hash = chain.buildReceiptChainHash(payload as any, prev.hash); // internally VALID hash
    entries.push({ payload, hash, prevHash: prev.hash, content: 'forged fact', status: 'active' } as any);
    writeFileSync(MEM, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const v = mem.verifyChain();
    expect(v.ok).toBe(false);                       // internal-consistent, but the receipts log has no such entry
    expect(v.reason).toMatch(/store-only forge|no matching receipt/i);
  });

  it('GOVERNED: AUMLOK locked → PAUSE, nothing stored', () => {
    setSession(false);
    const r = mem.remember({ content: 'should not persist while locked' });
    expect(r.ok).toBe(false);
    expect(r.effect).toBe('pause');
    expect(mem.loadEntries(MEM).length).toBe(0);
  });

  it('FAIL-CLOSED (Codex P0): a failing receipt write → remember ok:false, NO orphan row', () => {
    rmSync(REC, { force: true });
    mkdirSync(REC); // REC is now a DIRECTORY → openSync(REC,"a") throws EISDIR → appendReceiptDurable throws
    const r = mem.remember({ content: 'must not persist without a receipt' });
    expect(r.ok).toBe(false);
    expect(mem.loadEntries(MEM).length).toBe(0); // receipt-first: the row was never written
    rmSync(REC, { recursive: true, force: true });
  });

  it('FAIL-CLOSED: entries present but the receipts log is empty → verifyChain ok:false (not ok)', () => {
    mem.remember({ content: 'a receipted fact' });
    expect(mem.verifyChain().ok).toBe(true);
    writeFileSync(REC, ''); // wipe the independent receipts log
    const v = mem.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.receiptsBacked).toBe(false);
  });

  it('FAIL-CLOSED: a corrupt store line → verifyChain BROKEN + recall surfaces corrupt (never ok-empty)', () => {
    mem.remember({ content: 'real fact before corruption' });
    writeFileSync(MEM, readFileSync(MEM, 'utf-8') + 'THIS_IS_NOT_JSON\n');
    const v = mem.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/corrupt/i);
    const r = mem.recall();
    expect(r.corrupt).toBe(true);
    expect(r.count).toBe(0);
  });

  it('ADVISORY/NO-AUTHORITY: recall is read-only — it writes no receipt and exercises no authority', () => {
    mem.remember({ content: 'advisory check' });
    const before = receipts().length;
    mem.recall(); mem.recall();
    expect(receipts().length).toBe(before); // recall never appends a receipt
  });
});
