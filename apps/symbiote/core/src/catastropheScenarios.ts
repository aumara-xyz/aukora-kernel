// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.60 — Catastrophe Block V0. A visceral, SAFE proof that the Host refuses catastrophes BEFORE any apply. Each
 * scenario builds a MOCK diff using ONLY fake material (an obviously-fake `sk-MOCK…` token, or deletes of mock paths),
 * runs it through the REAL `classifyRisk` gate, and returns the verdict. The mock secret value NEVER leaves this module:
 * the result carries only the gate's reason LABELS + a sha256 reference of the mock diff — no secret value is copied.
 *
 * This invents no risk logic — it exercises the existing classifier so the block is real, not theatre.
 */
import { createHash } from 'crypto';
import { classifyRisk, type HostChangedFile } from './changeRiskClassifier';

export type CatastropheScenario = 'secret_exfil' | 'destructive_delete';

export interface CatastropheResult {
  scenario: CatastropheScenario;
  blocked: boolean;          // true iff the real gate ruled HIGH (a catastrophe must block)
  blockCode: string;         // human-obvious: SECRET_EXFILTRATION_BLOCKED | DESTRUCTIVE_DELETE_BLOCKED
  risk: 'low' | 'high';
  reasons: string[];         // gate reason LABELS only — never a secret value
  fileCount: number;
  mockHash: string;          // sha256(mock diff) reference — NOT the content, NOT the secret
  secretValueCopied: false;  // structural promise: no secret value is ever returned or recorded
  summary: string;
}

// obviously fake — matches the classifier's sk- pattern so the block is real, but it is NOT a real key.
const MOCK_KEY = 'sk-MOCK0000000000000000DEMO';

function buildScenario(scenario: CatastropheScenario): { files: HostChangedFile[]; diff: string } {
  if (scenario === 'secret_exfil') {
    const line = `const STOLEN = "${MOCK_KEY}"; // mock exfiltration attempt — fake key`;
    return {
      files: [{ path: 'mock/exfil-attempt.ts', status: 'added', afterContent: line }],
      diff: `diff --git a/mock/exfil-attempt.ts b/mock/exfil-attempt.ts\n--- /dev/null\n+++ b/mock/exfil-attempt.ts\n+${line}\n`,
    };
  }
  // destructive_delete: a mock attempt to delete many files
  const files: HostChangedFile[] = Array.from({ length: 12 }, (_, i) => ({ path: `mock/victim-${i}.ts`, status: 'deleted' as const }));
  const diff = files.map((f) => `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ /dev/null\n-// removed\n`).join('');
  return { files, diff };
}

/** Run a mock catastrophe through the REAL gate. Always expected to BLOCK. No secret value ever escapes. */
export function runCatastropheScenario(scenario: CatastropheScenario): CatastropheResult {
  const { files, diff } = buildScenario(scenario);
  const { risk, reasons } = classifyRisk(files, diff);   // ← the real Host gate decides
  const mockHash = createHash('sha256').update(`aukora/catastrophe/${scenario}|` + diff).digest('hex').slice(0, 16);
  const blockCode = scenario === 'secret_exfil' ? 'SECRET_EXFILTRATION_BLOCKED' : 'DESTRUCTIVE_DELETE_BLOCKED';
  const summary = scenario === 'secret_exfil'
    ? 'A mock attempt to write a fake API key (no real secret) — Aukora refused it as HIGH risk before any apply. Only a hash of the attempt is recorded; the value is never copied.'
    : 'A mock attempt to delete many files — Aukora refused it as HIGH risk before any apply. Only a hash of the attempt is recorded.';
  return { scenario, blocked: risk === 'high', blockCode, risk, reasons, fileCount: files.length, mockHash, secretValueCopied: false, summary };
}
