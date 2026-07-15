// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Hermetic tests for the Windows-native key custody verifier and its wiring into the strict
// custody readers. All ACL outputs are mocked (runs identically on any OS); fixture shapes mirror
// real icacls.exe output captured live on zeb-windows-node 2026-07-07.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { verifyWindowsKeyFileCustody, WindowsCustodyError } from '../src/windowsKeyCustody';
import { readAdminKeyStrict, MemoryKernelTransportError } from '../src/memoryKernelTransport';
import { readOwnerSeedStrict, MemoryRecallError } from '../src/memoryRecall';

const P = 'C:\\k\\admin-key.txt';
const ID = { userDomain: 'ZEB', userName: 'HP' };

const out = (aces: string[]) =>
  `${P} ${aces[0]}\n` +
  aces.slice(1).map((a) => `                   ${a}\n`).join('') +
  '\nSuccessfully processed 1 files; Failed processing 0 files\n';

const PROTECTED = out(['NT AUTHORITY\\SYSTEM:(I)(F)', 'BUILTIN\\Administrators:(I)(F)', 'ZEB\\HP:(I)(F)']);

function expectRefuse(fn: () => void, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(WindowsCustodyError);
    expect((e as WindowsCustodyError).code).toBe(code);
    return;
  }
  throw new Error(`expected refusal ${code}, but custody PASSED`);
}

describe('verifyWindowsKeyFileCustody — allowlist, fail-closed', () => {
  it('passes the canonical protected ACL (owner user + SYSTEM + Administrators)', () => {
    expect(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => PROTECTED, ...ID })).not.toThrow();
  });

  it('refuses an Everyone grant', () => {
    const acl = out(['Everyone:(I)(R)', 'ZEB\\HP:(I)(F)']);
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID }), 'windows_custody_open');
  });

  it('refuses a BUILTIN\\Users grant', () => {
    const acl = out(['ZEB\\HP:(I)(F)', 'BUILTIN\\Users:(I)(RX)']);
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID }), 'windows_custody_open');
  });

  it('refuses an Authenticated Users grant', () => {
    const acl = out(['NT AUTHORITY\\Authenticated Users:(I)(M)', 'ZEB\\HP:(I)(F)']);
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID }), 'windows_custody_open');
  });

  it('refuses a grant to a DIFFERENT user on the same machine', () => {
    const acl = out(['ZEB\\Mallory:(I)(F)', 'ZEB\\HP:(I)(F)']);
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID }), 'windows_custody_open');
  });

  it('refuses an unresolved SID (cannot positively identify = cannot certify)', () => {
    const acl = out(['S-1-5-21-1111111111-222222222-3333333333-1001:(I)(F)', 'ZEB\\HP:(I)(F)']);
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID }), 'windows_custody_open');
  });

  it('a DENY ace is protective and never counts as a grant', () => {
    const acl = out(['Everyone:(DENY)(F)', 'ZEB\\HP:(I)(F)', 'NT AUTHORITY\\SYSTEM:(I)(F)']);
    expect(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID })).not.toThrow();
  });

  it('parses multi-flag inheritance aces ((OI)(CI)(IO)(F))', () => {
    const acl = out(['ZEB\\HP:(OI)(CI)(F)', 'BUILTIN\\Administrators:(OI)(CI)(IO)(F)']);
    expect(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID })).not.toThrow();
  });

  it('refuses malformed icacls output', () => {
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => 'complete garbage\n', ...ID }), 'windows_custody_unparseable');
  });

  it('refuses output whose first line is not the queried path', () => {
    const acl = 'D:\\other.txt ZEB\\HP:(F)\n\nSuccessfully processed 1 files; Failed processing 0 files\n';
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID }), 'windows_custody_unparseable');
  });

  it('refuses when the success summary is missing (localized/truncated output cannot certify)', () => {
    const acl = `${P} ZEB\\HP:(I)(F)\n`;
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID }), 'windows_custody_unparseable');
  });

  it('refuses an empty ACL listing', () => {
    const acl = `${P} \n\nSuccessfully processed 1 files; Failed processing 0 files\n`;
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => acl, ...ID }), 'windows_custody_unparseable');
  });

  it('refuses when icacls itself is unavailable/erroring', () => {
    expectRefuse(
      () => verifyWindowsKeyFileCustody(P, { runIcacls: () => { throw new Error('spawn icacls.exe ENOENT'); }, ...ID }),
      'windows_custody_icacls_unavailable',
    );
  });

  it('refuses when the current user cannot be resolved', () => {
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => PROTECTED, userDomain: '', userName: '' }), 'windows_custody_identity_unknown');
  });

  it('with no domain known, the username must still match exactly', () => {
    const aclOk = out(['ANYBOX\\HP:(I)(F)']);
    expect(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => aclOk, userDomain: '', userName: 'HP' })).not.toThrow();
    const aclBad = out(['ANYBOX\\HPX:(I)(F)']);
    expectRefuse(() => verifyWindowsKeyFileCustody(P, { runIcacls: () => aclBad, userDomain: '', userName: 'HP' }), 'windows_custody_open');
  });
});

describe('strict readers — per-platform custody wiring (POSIX law untouched)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-wincust-'));
  const keyFile = path.join(tmp, 'admin-key.txt');
  const seedFile = path.join(tmp, 'memory-root.seed');
  fs.writeFileSync(keyFile, 'test-admin-key-value\n', { mode: 0o644 });
  fs.writeFileSync(seedFile, 'a'.repeat(64) + '\n', { mode: 0o644 });

  const protectedFor = (p: string) =>
    `${p} NT AUTHORITY\\SYSTEM:(I)(F)\n                   ZEB\\HP:(I)(F)\n\nSuccessfully processed 1 files; Failed processing 0 files\n`;

  it('win32 branch: a protected ACL admits the admin key; an open ACL refuses with a typed code', () => {
    const custodyOk = { platform: 'win32' as const, windows: { runIcacls: protectedFor, ...ID } };
    expect(readAdminKeyStrict(keyFile, custodyOk)).toBe('test-admin-key-value');
    const openAcl = (p: string) => `${p} Everyone:(I)(F)\n\nSuccessfully processed 1 files; Failed processing 0 files\n`;
    try {
      readAdminKeyStrict(keyFile, { platform: 'win32', windows: { runIcacls: openAcl, ...ID } });
      throw new Error('expected refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(MemoryKernelTransportError);
      expect((e as MemoryKernelTransportError).code).toBe('admin_key_windows_custody_open');
    }
  });

  it('POSIX branch is UNCHANGED: group/other-readable modes still refuse (0644 fixture)', () => {
    // On real POSIX this file is 0644; on Windows hosts stat fabricates 0666 — both trip the law.
    try {
      readAdminKeyStrict(keyFile, { platform: 'linux' });
      throw new Error('expected refusal');
    } catch (e) {
      expect((e as MemoryKernelTransportError).code).toBe('admin_key_permissions_open');
    }
  });

  it('win32 branch: owner seed read follows the same law', () => {
    const custodyOk = { platform: 'win32' as const, windows: { runIcacls: protectedFor, ...ID } };
    expect(readOwnerSeedStrict(seedFile, custodyOk)).toBe('a'.repeat(64));
    const openAcl = (p: string) => `${p} BUILTIN\\Users:(I)(R)\n\nSuccessfully processed 1 files; Failed processing 0 files\n`;
    try {
      readOwnerSeedStrict(seedFile, { platform: 'win32', windows: { runIcacls: openAcl, ...ID } });
      throw new Error('expected refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(MemoryRecallError);
      expect((e as MemoryRecallError).code).toBe('owner_seed_windows_custody_open');
    }
  });

  it('POSIX branch for the owner seed is UNCHANGED (0644 fixture refuses)', () => {
    try {
      readOwnerSeedStrict(seedFile, { platform: 'linux' });
      throw new Error('expected refusal');
    } catch (e) {
      expect((e as MemoryRecallError).code).toBe('owner_seed_permissions_open');
    }
  });
});
