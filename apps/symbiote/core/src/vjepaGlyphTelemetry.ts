/**
 * 24Z.1 — V-JEPA glyph telemetry REGISTER (design-input absorption; NOT a model, NOT training).
 *
 * Gemini's V-JEPA glyph encoder is treated as DESIGN INPUT ONLY. The single useful, safe idea absorbed:
 *   "latent visual/glyph vectors are ADVISORY TELEMETRY ONLY and require a DETERMINISTIC decode-to-audit
 *    summary. Raw latent vectors must NEVER be read by Gate / evaluateIntent / executor."
 *
 * This module is a register + a deterministic decoder. It does NOT run a model, train, or touch a tensor
 * runtime (no torch/tensor/WebGPU/Vulkan). `decodeJepaState` turns a payload into a human-readable AUDIT
 * SUMMARY (scalars + words), never returning the raw latent. Untranslatable / non-finite / oversize
 * payloads are REJECTED (fail closed). The latent grants no authority and is not an authority confidence.
 *
 * PURE: arithmetic only. No authority path. Must NOT be imported by Gate / evaluateIntent / executor.
 */

export interface VkJepaPayload {
  payloadId: string;
  /** Advisory telemetry latent — NEVER read by Gate/evaluateIntent/executor; only decoded to a summary. */
  latent: number[];
  dims: number;
  /** A known codebook tag so the latent can be deterministically translated; unknown → untranslatable. */
  codebookTag: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export type JepaDecodeVerdict =
  | 'decoded'
  | 'rejected_untranslatable'
  | 'rejected_nonfinite'
  | 'rejected_oversize';

export interface JepaAuditSummary {
  verdict: JepaDecodeVerdict;
  /** Deterministic human-readable summary (scalars + words). NEVER contains the raw latent vector. */
  summary: string;
  dims: number;
  /** Deterministic L2 norm (audit scalar) — null when rejected. NOT the vector. */
  norm: number | null;
  /** Deterministic coarse bucket of the norm, for human audit. */
  bucket: 'flat' | 'low' | 'mid' | 'high' | null;
  codebookTag: string;
  reason: string;
  advisoryOnly: true;
  /** STRUCTURAL: telemetry never authorizes and is not an authority confidence. */
  grantsAuthority: false;
}

const MAX_DIMS = 4096;
const KNOWN_CODEBOOK_TAGS = new Set(['glyph-v0', 'resting-glyph', 'scene-telemetry']);

function rejected(verdict: JepaDecodeVerdict, dims: number, codebookTag: string, reason: string): JepaAuditSummary {
  return { verdict, summary: `[rejected:${verdict}]`, dims, norm: null, bucket: null, codebookTag, reason, advisoryOnly: true, grantsAuthority: false };
}

function bucketOf(norm: number): 'flat' | 'low' | 'mid' | 'high' {
  if (norm < 0.5) return 'flat';
  if (norm < 2) return 'low';
  if (norm < 8) return 'mid';
  return 'high';
}

/**
 * Deterministically decode a payload into an audit summary, or reject it (fail closed). Same payload →
 * same summary. Never returns the raw latent; only scalars + words a human/auditor can read.
 */
export function decodeJepaState(payload: VkJepaPayload): JepaAuditSummary {
  const tag = typeof payload?.codebookTag === 'string' ? payload.codebookTag : '(none)';
  const latent = payload?.latent;
  const dims = typeof payload?.dims === 'number' ? payload.dims : Array.isArray(latent) ? latent.length : -1;

  if (!Array.isArray(latent)) return rejected('rejected_untranslatable', dims, tag, 'latent is not an array');
  if (latent.length !== payload.dims) return rejected('rejected_untranslatable', dims, tag, `dims ${payload.dims} != latent length ${latent.length}`);
  if (latent.length === 0) return rejected('rejected_untranslatable', dims, tag, 'empty latent');
  if (latent.length > MAX_DIMS) return rejected('rejected_oversize', dims, tag, `latent length ${latent.length} > MAX_DIMS ${MAX_DIMS}`);
  if (!latent.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    return rejected('rejected_nonfinite', dims, tag, 'latent contains NaN/Infinity/non-number');
  }
  if (!KNOWN_CODEBOOK_TAGS.has(tag)) return rejected('rejected_untranslatable', dims, tag, `unknown codebook tag: ${tag}`);

  const norm = Math.sqrt(latent.reduce((s, x) => s + x * x, 0));
  const bucket = bucketOf(norm);
  // deterministic, bounded, human-readable — scalars + words ONLY, never the raw vector
  const summary = `glyph[${tag}] dims=${latent.length} norm=${norm.toFixed(4)} energy=${bucket}`;
  return { verdict: 'decoded', summary, dims: latent.length, norm, bucket, codebookTag: tag, reason: 'decoded to audit summary', advisoryOnly: true, grantsAuthority: false };
}

/** V-JEPA latent telemetry NEVER authorizes and is not an authority confidence — structural constant. */
export function jepaTelemetryGrantsAuthority(): false {
  return false;
}
