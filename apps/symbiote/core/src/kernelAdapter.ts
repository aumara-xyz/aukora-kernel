// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * ⚠ DEPRECATED (2026-07-05) — NOT on any live path. Verified: nothing calls `kernelMintHostApplyReceipt`
 * (grep clean; only doc references remain). It targets `aukoraDevReceipt:mintHostApplyReceipt`, a mutation
 * the S1a vendor did NOT bring into `aukora-symbiote/convex/`, from a RETIRED cwd (`../../../node-template`)
 * and a RETIRED key path (`~/aukora-convex-backend/admin-key.txt`, the pre-W3b location). The real,
 * live-proven memory transport is `core/src/memoryKernelTransport.ts` (admin key at
 * `~/.aukora-symbiote/convex/`, use-time custody, loud typed failures, one registered function). This file
 * is kept only until the deploy-lifecycle brick decides whether the host-apply-receipt lane is revived on
 * the new backend or removed; do not wire it into anything meanwhile.
 *
 * ── historical purpose (what it DID) ────────────────────────────────────────────────────────────────
 * 24Z.54 — Aukora Host → Aukora Kernel ADAPTER. The Host does NOT implement receipts. This shim CALLED the
 * Aukora kernel receipt path — the Convex mutation `aukoraDevReceipt:mintHostApplyReceipt`, composing the
 * kernel's own primitives (single-use grant → submitIntentCore → verifyAndConsumeDecisionToken →
 * writeReceiptRow → ML-DSA-65 signed head → verifyReceiptChainCore) on a self-hosted local backend. It
 * returned a REAL verified receipt, or null when unreachable/unverified — NEVER a fabricated receipt.
 */
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const NODE_TEMPLATE_DIR = resolve(__dirname, '../../../node-template');
const DURABLE_KEY_PATH = join(homedir(), 'aukora-convex-backend', 'admin-key.txt');
const DURABLE_URL = process.env.AUKORA_CONVEX_URL || 'http://127.0.0.1:3210';

export interface KernelReceipt {
  receiptId: string;
  chainKey: string;
  chainHash: string | null;
  headSig: string | null;
  headSigAlg: string | null;
  headSignedAt: number | null;
  scope: string;
  verified: true;
  source: 'real_kernel_receipt';
  chainBacking: string;
}

/**
 * Accept a kernel-mutation result ONLY if it carries the kernel verifier's PASS verdict and the expected receipt shape;
 * anything else (error/empty/unverified/wrong-source/missing id or signature-alg) → null (no fake label). Pure + testable.
 *
 * Honest trust model (not overclaimed): this is a HOST-SIDE SHAPE/SANITY GATE, not an independent re-verification. The
 * real cryptographic trust anchor is SERVER-SIDE: the kernel mutation sets `verified` from its own
 * `verifyReceiptChainCore` (recompute the chain hash from the receipt payload + check the ML-DSA-65 signed head), and the
 * diff hash lives in the receipt payload (actionsJson/proofJson) that IS hashed into that signed chain head — so a
 * tampered/substituted diff hash fails the kernel verifier. The host adapter trusts the local backend it spawned; it
 * does not (and in this lab cannot) re-run the ML-DSA verification itself. This gate stops error/empty/unverified blobs;
 * it is NOT a defense against a compromised local backend (that is outside the lab trust boundary).
 */
export function acceptKernelReceipt(parsed: unknown): KernelReceipt | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;
  if (r.verified !== true) return null;
  if (r.source !== 'real_kernel_receipt') return null;
  if (typeof r.receiptId !== 'string' || !r.receiptId) return null;
  if (typeof r.headSigAlg !== 'string' || !r.headSigAlg) return null;   // a real signed head must name its algorithm
  return r as unknown as KernelReceipt;
}

export function kernelBackendConfigured(): boolean { return existsSync(DURABLE_KEY_PATH); }

function runKernelMutation(fn: string, args: Record<string, unknown>): KernelReceipt | null {
  if (!existsSync(DURABLE_KEY_PATH)) return null;   // no admin key → backend not set up → no receipt (honest null)
  try {
    const adminKey = readFileSync(DURABLE_KEY_PATH, 'utf-8').trim();
    const raw = execFileSync('npx', ['convex', 'run', fn, JSON.stringify(args)], {
      cwd: NODE_TEMPLATE_DIR, timeout: 30_000, stdio: 'pipe',
      env: { ...process.env, CONVEX_SELF_HOSTED_URL: DURABLE_URL, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey },
    }).toString();
    const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    return acceptKernelReceipt(JSON.parse(raw.slice(a, b + 1)));
  } catch { return null; }   // backend unreachable / mutation error → null, never a fake receipt
}

/** Mint a REAL Aukora kernel receipt for a Host apply (or undo), bound to the diff hash, via the existing kernel path. */
export function kernelMintHostApplyReceipt(diffHash: string, fileCount: number, applyStatus: string): KernelReceipt | null {
  return runKernelMutation('aukoraDevReceipt:mintHostApplyReceipt', { diffHash, fileCount, applyStatus });
}
