import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { acceptKernelReceipt } from '../src/kernelAdapter';

/**
 * 24Z.54 — Host→Kernel ADAPTER. The Host does not implement receipts; it CALLS the existing kernel path. acceptKernelReceipt
 * is the host-side SHAPE/VERDICT gate: it shows a kernel receipt ONLY when the result carries the kernel verifier's PASS
 * verdict (verified===true, set server-side by verifyReceiptChainCore) AND the expected shape; error/empty/unverified →
 * null (no fake label). It is not an independent re-verification — the cryptographic anchor is the kernel, server-side.
 */

const REAL = { receiptId: 'rcpt_abc', verified: true, source: 'real_kernel_receipt', headSigAlg: 'ml-dsa-65-chainhead-v4', chainHash: 'deadbeef', scope: 'host.apply on aukora_host:worktree_apply' };

describe('acceptKernelReceipt — no fake receipts', () => {
  it('accepts a genuinely verified real kernel receipt', () => {
    expect(acceptKernelReceipt(REAL)).not.toBeNull();
    expect(acceptKernelReceipt(REAL)!.headSigAlg).toBe('ml-dsa-65-chainhead-v4');
  });
  it('rejects unverified / wrong-source / missing-id / missing-alg (→ null, never faked)', () => {
    expect(acceptKernelReceipt({ ...REAL, verified: false })).toBeNull();
    expect(acceptKernelReceipt({ ...REAL, verified: undefined })).toBeNull();
    expect(acceptKernelReceipt({ ...REAL, source: 'simulated' })).toBeNull();
    expect(acceptKernelReceipt({ ...REAL, receiptId: '' })).toBeNull();
    expect(acceptKernelReceipt({ ...REAL, headSigAlg: '' })).toBeNull();   // a real signed head must name its algorithm
    expect(acceptKernelReceipt(null)).toBeNull();
    expect(acceptKernelReceipt('rcpt_fake')).toBeNull();
    expect(acceptKernelReceipt({})).toBeNull();
  });
});

describe('adapter discipline (structural) — no duplicate receipt system; calls the existing kernel path; no fake labels', () => {
  const adapter = readFileSync(join(__dirname, '../src/kernelAdapter.ts'), 'utf-8');
  it('the adapter CALLS the existing kernel mutation (does not reimplement receipt primitives)', () => {
    expect(adapter).toMatch(/aukoraDevReceipt:mintHostApplyReceipt/);   // calls the existing kernel path
    // it imports ONLY node builtins → it provably cannot reimplement the kernel receipt primitives (no kernel imports);
    // it must delegate to the deployed mutation. (Comment mentions of the primitives are fine; imports are the proof.)
    const imports = [...adapter.matchAll(/^import[^;]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const imp of imports) expect(['child_process', 'fs', 'path', 'os'], `adapter imports ${imp}`).toContain(imp);
  });
  it('returns a receipt ONLY through the verified gate (acceptKernelReceipt)', () => {
    expect(adapter).toMatch(/acceptKernelReceipt\(/);
    // the only place a receipt object is returned is via acceptKernelReceipt — no hand-built receipt
    expect(adapter).not.toMatch(/return\s*\{[^}]*verified:\s*true/);
  });
  it('host receipt and kernel receipt are NOT conflated (kernelReceipt is a separate attached field)', () => {
    const vite = readFileSync(join(__dirname, '../../tauri-womb/vite.config.ts'), 'utf-8');
    expect(vite).toMatch(/kind: 'host_receipt_v0'/);                    // host record is its own kind
    expect(vite).toMatch(/kernelReceipt(,| =|:)/);                      // kernel receipt attached as a separate field
    expect(vite).toMatch(/kernelMintHostApplyReceipt\(/);              // minted via the adapter
  });
});
