// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Build a D6 EvidencePack for an exact review target. Pure: uses the frozen D6 evidence sealer/validator
 * as-is (never modifies `src/evidence/*`). A single complete text file per target path; the pack's
 * `headCommit`/`headTree` bind the exact target the council reviewed. Secret-shaped or oversized content
 * is refused by the frozen validator (that is the intended refusal, requirement 9).
 */
import {
  EVIDENCE_PACK_SCHEMA, catalogueId, sha256Hex, sealEnvelope, packDigest, validatePackBody,
  type EvidencePackV1, type EvidenceFileV1,
} from '../../src/evidence/index';

export interface PackTargetFile { readonly path: string; readonly content: string; }
export interface PackBuildInput {
  readonly repoId: string;
  readonly headCommit: string; // 40-hex exact target commit
  readonly headTree: string;   // 40-hex exact target tree
  readonly files: readonly PackTargetFile[];
  readonly toolVersions: Readonly<Record<string, string>>;
}
export type PackBuildResult =
  | { readonly ok: true; readonly body: EvidencePackV1; readonly digest: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function buildTargetPack(input: PackBuildInput): PackBuildResult {
  const enc = new TextEncoder();
  const files: EvidenceFileV1[] = input.files.map((f) => {
    const bytes = enc.encode(f.content);
    const h = sha256Hex(bytes);
    return {
      path: f.path, kind: 'text', originalSizeBytes: bytes.length,
      includedByteStart: 0, includedByteEnd: bytes.length, truncated: false,
      fullSha256: h, includedSha256: h, encoding: 'utf8', content: f.content,
    };
  });
  const rootAllowlist = [...files.map((f) => f.path)].sort();
  const body: EvidencePackV1 = {
    schema: EVIDENCE_PACK_SCHEMA, advisoryOnly: true, grantsAuthority: false,
    repoId: input.repoId, headCommit: input.headCommit, headTree: input.headTree,
    baseCommit: null, baseTree: null,
    files, omissions: [], testRuns: [], rootAllowlist,
    limitsProfileId: 'default-v1', builderToolVersions: input.toolVersions, catalogueId: catalogueId(),
  };
  const v = validatePackBody(body);
  if (!v.ok) return { ok: false, code: v.code, message: `${v.code}:${v.path}` };
  try { sealEnvelope(body); } catch (e) { return { ok: false, code: 'E_SEAL', message: String((e as Error).message ?? e) }; }
  return { ok: true, body, digest: packDigest(body) };
}
