// Issue #76: signed-receipt file reads must be confined to trusted dirs with realpath / symlink-escape /
// size / schema checks — the filesystem read itself scoped, not just the JSON validated afterward.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readSignedPromotionReceiptFromFile, resolveTrustedReceiptPath } from '../src/nativeLiveApply';

let home: string;
let receiptsDir: string;
let tmpReal: string;

function validReceipt(extra?: Record<string, unknown>) {
  return JSON.stringify({
    schema: 'aumlok-signed-promotion-v1',
    authorization: { keyId: 'k', proposalHash: 'a'.repeat(64), draftHash: 'a'.repeat(64), nonce: 'n', issuedAt: '2026-07-03T00:00:00.000Z', expiresAt: null },
    algorithm: 'ed25519', signature: 'ab'.repeat(64), mode: 'dev_real', humanSignedAuthorization: true, promotionExecuted: false,
    ...(extra ?? {}),
  });
}

beforeEach(() => {
  tmpReal = fs.realpathSync(os.tmpdir());
  home = fs.mkdtempSync(path.join(tmpReal, 'aukora-76-home-'));
  receiptsDir = path.join(home, 'aumlok', 'receipts');
  fs.mkdirSync(receiptsDir, { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('#76 trusted signed-receipt reads: legitimate paths accepted', () => {
  it('a valid receipt in <home>/aumlok/receipts is accepted', () => {
    const p = path.join(receiptsDir, 'r.json');
    fs.writeFileSync(p, validReceipt());
    const r = readSignedPromotionReceiptFromFile(p, { homeDir: home });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.signedReceipt.schema).toBe('aumlok-signed-promotion-v1');
  });

  it('a valid receipt in <home>/aumlok/pending-proposals is accepted', () => {
    const pend = path.join(home, 'aumlok', 'pending-proposals');
    fs.mkdirSync(pend, { recursive: true });
    const p = path.join(pend, 'r.json');
    fs.writeFileSync(p, validReceipt());
    expect(readSignedPromotionReceiptFromFile(p, { homeDir: home }).ok).toBe(true);
  });

  it('the sign→apply temp pattern (signed-*.json directly under a temp root) is accepted', () => {
    const p = path.join(tmpReal, `signed-${'deadbeef'}-76.json`);
    try {
      fs.writeFileSync(p, validReceipt());
      expect(readSignedPromotionReceiptFromFile(p, { homeDir: home }).ok).toBe(true);
    } finally { fs.rmSync(p, { force: true }); }
  });
});

describe('#76 trusted signed-receipt reads: untrusted / hostile paths refused', () => {
  it('arbitrary JSON in a temp root that is NOT the signed-*.json pattern is refused', () => {
    const p = path.join(tmpReal, `random-${'x'}-76.json`);
    try {
      fs.writeFileSync(p, validReceipt());
      const r = readSignedPromotionReceiptFromFile(p, { homeDir: home });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/outside the trusted/);
    } finally { fs.rmSync(p, { force: true }); }
  });

  it('a valid receipt outside any trusted dir (e.g. home root) is refused', () => {
    const p = path.join(home, 'loose-receipt.json'); // home root is NOT a trusted dir
    fs.writeFileSync(p, validReceipt());
    const r = readSignedPromotionReceiptFromFile(p, { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/outside the trusted/);
  });

  it('a symlink inside a trusted dir pointing OUTSIDE is refused (realpath resolves the escape)', () => {
    const outside = path.join(home, 'outside-secret.json'); // outside the receipts dir
    fs.writeFileSync(outside, validReceipt());
    const link = path.join(receiptsDir, 'sneaky.json');
    fs.symlinkSync(outside, link);
    const r = readSignedPromotionReceiptFromFile(link, { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/outside the trusted/);
  });

  it('a missing file / broken symlink is refused cleanly (no throw)', () => {
    const r = readSignedPromotionReceiptFromFile(path.join(receiptsDir, 'nope.json'), { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cannot resolve/);
  });
});

describe('#76 trusted signed-receipt reads: content checks fail closed', () => {
  it('an oversized file is refused BEFORE parse', () => {
    const p = path.join(receiptsDir, 'big.json');
    fs.writeFileSync(p, '{"schema":"aumlok-signed-promotion-v1","pad":"' + 'A'.repeat(70 * 1024) + '"}');
    const r = readSignedPromotionReceiptFromFile(p, { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large.*before parse/);
  });

  it('malformed JSON in a trusted dir fails closed', () => {
    const p = path.join(receiptsDir, 'bad.json');
    fs.writeFileSync(p, '{ not json ');
    const r = readSignedPromotionReceiptFromFile(p, { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid JSON/);
  });

  it('a wrong schema fails closed', () => {
    const p = path.join(receiptsDir, 'wrongschema.json');
    fs.writeFileSync(p, JSON.stringify({ schema: 'something-else' }));
    const r = readSignedPromotionReceiptFromFile(p, { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/schema/);
  });

  it('an extra top-level key fails closed (reuses the canonical allow-list)', () => {
    const p = path.join(receiptsDir, 'extrakey.json');
    fs.writeFileSync(p, validReceipt({ injectedAuthority: true }));
    const r = readSignedPromotionReceiptFromFile(p, { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unknown top-level field/);
  });

  it('a JSON array (not an object) fails closed', () => {
    const p = path.join(receiptsDir, 'arr.json');
    fs.writeFileSync(p, '[]');
    const r = readSignedPromotionReceiptFromFile(p, { homeDir: home });
    expect(r.ok).toBe(false);
  });
});

describe('#76 resolveTrustedReceiptPath (unit)', () => {
  it('refuses empty / non-string input without throwing', () => {
    expect(resolveTrustedReceiptPath('', { homeDir: home }).ok).toBe(false);
    // @ts-expect-error — intentional bad input
    expect(resolveTrustedReceiptPath(null, { homeDir: home }).ok).toBe(false);
  });
});
