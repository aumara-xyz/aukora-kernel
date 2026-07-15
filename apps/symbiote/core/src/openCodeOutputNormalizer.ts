/**
 * 24Z.25 — OpenCode output defensive boundary (GLOSSOPETRAE/VK doctrine: normalize → scan → parse-as-data).
 *
 * A coding agent's output is UNTRUSTED text and a known hidden-channel/stego surface (zero-width, private-use,
 * tag chars, bidi overrides, homoglyphs — see the GLOSSOPETRAE donor classification). Before any model output
 * becomes a patch candidate, it crosses THIS boundary: Unicode is NFC-normalized; hidden-channel payloads are
 * detected and the candidate is REFUSED fail-closed (human-opacity refusal — a payload a human can't see must
 * never become an instruction); the structured patch is parsed AS DATA (never executed); metadata is scanned
 * with the shared forbiddenContent scanner. NO GLOSSOPETRAE mechanics are ported — only defensive detection.
 *
 * Doctrine: hidden channels are EVIDENCE, never authority. If a human couldn't see it, Aukora won't trust it.
 */
import { scanForbiddenValues } from './forbiddenContent';
// 24Z.26: the unicode primitives now live in the Canonicalization Sentinel (the boundary kernel). Re-exported here
// for back-compat; parseOpenCodePatch routes the DECODED candidate through the sentinel before establishing trust.
import { scanHiddenChannels, normalizeModelText, canonicalizeBoundary, type HiddenChannelFinding, type CanonicalizationReceipt } from './canonicalizationSentinel';
export { scanHiddenChannels, normalizeModelText, type HiddenChannelFinding };

export interface OpenCodePatchFile { relPath: string; content: string }
export interface OpenCodePatchCandidate { objective: string; files: OpenCodePatchFile[]; engineSource: 'opencode'; sanitized: true; canonReceipt: CanonicalizationReceipt }

export class HiddenChannelError extends Error {}
export class PatchParseError extends Error {}

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_OBJECTIVE = 2000;

function assertSafeRelPath(rel: unknown): asserts rel is string {
  if (typeof rel !== 'string' || !rel.length) throw new PatchParseError('file relPath must be a non-empty string');
  if (rel.length > 300) throw new PatchParseError('file relPath too long');
  if (rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel) || rel.includes('\0')) throw new PatchParseError(`relPath must be repo-relative: ${rel}`);
  if (rel.split(/[\\/]/).some((seg) => seg === '..')) throw new PatchParseError(`relPath must not escape (..): ${rel}`);
}

/**
 * Parse raw OpenCode stdout into a sanitized patch candidate, FAIL-CLOSED at every step:
 * 1. bounded size; 2. NFC-normalize; 3. REFUSE if any hidden channel is present (human-opacity refusal);
 * 4. parse as strict JSON {objective, files:[{relPath, content}]} (data, never executed); 5. shape + path-escape
 * + size bounds; 6. forbiddenContent scan on the metadata (objective + relPaths). Returns the candidate or throws.
 */
export function parseOpenCodePatch(rawOutput: string): OpenCodePatchCandidate {
  if (typeof rawOutput !== 'string') throw new PatchParseError('output must be a string');
  if (Buffer.byteLength(rawOutput, 'utf8') > MAX_OUTPUT_BYTES) throw new PatchParseError('output exceeds bound');

  // PRE-parse scan (defense-in-depth: literal INVISIBLE chars in the raw text). Bare homoglyph code points are
  // NOT refused here — a legitimate non-Latin string (e.g. a Russian comment) carries confusables but no covert
  // payload; the post-parse Sentinel decides homoglyphs in an AUTHORITY-word-scoped way (24Z.26 false-positive fix).
  const { normalized, findings } = normalizeModelText(rawOutput);
  const invisible = findings.filter((f) => f.kind !== 'homoglyph_risk');
  if (invisible.length) {
    throw new HiddenChannelError(`refused: ${invisible.length} hidden-channel finding(s) (e.g. ${invisible[0].kind} U+${invisible[0].codepoint.toString(16)})`);
  }

  let parsed: unknown;
  try { parsed = JSON.parse(normalized); } catch { throw new PatchParseError('output is not valid JSON (expected {objective, files:[{relPath, content}]})'); }
  if (!parsed || typeof parsed !== 'object') throw new PatchParseError('output must be a JSON object');
  const obj = parsed as Record<string, unknown>;

  const objective = typeof obj.objective === 'string' ? obj.objective.slice(0, MAX_OBJECTIVE) : '';
  if (!Array.isArray(obj.files) || obj.files.length === 0) throw new PatchParseError('files[] must be a non-empty array');
  if (obj.files.length > MAX_FILES) throw new PatchParseError('too many files in candidate');

  const files: OpenCodePatchFile[] = obj.files.map((f) => {
    if (!f || typeof f !== 'object') throw new PatchParseError('each file must be an object');
    const ff = f as Record<string, unknown>;
    assertSafeRelPath(ff.relPath);
    if (typeof ff.content !== 'string') throw new PatchParseError(`file content must be a string: ${ff.relPath}`);
    if (Buffer.byteLength(ff.content, 'utf8') > MAX_FILE_BYTES) throw new PatchParseError(`file content too large: ${ff.relPath}`);
    return { relPath: ff.relPath, content: ff.content };
  });

  // 24Z.26: route the DECODED candidate through the Canonicalization Sentinel as an AUTHORITY/apply-bound boundary.
  // This re-scans the post-JSON.parse text (24Z.25 HIGH: \uXXXX escapes decode into live hidden codepoints) across
  // EVERY field incl. content (the injection vector), adds confusables-skeleton authority-word detection, enforces
  // the human-legibility gate, and produces a receipt. Authority-bound ⇒ ANY hidden channel/homoglyph'd authority
  // word ⇒ REFUSE (human-opacity refusal). The candidate is NEVER silently sanitized into trust.
  const decodedJoined = [objective, ...files.flatMap((f) => [f.relPath, f.content])].join('\n');
  const sentinel = canonicalizeBoundary(decodedJoined, { boundary: 'opencode_output', authorityBound: true });
  if (!sentinel.ok || sentinel.action !== 'allow') {
    throw new HiddenChannelError(`canonicalization sentinel refused opencode_output: removed=[${sentinel.receipt.removed.join(',')}] flagged=[${sentinel.receipt.flagged.join(',')}] legible=${sentinel.receipt.legible}`);
  }

  // forbiddenContent scan on METADATA (objective + relPaths) — these must never carry secrets/overclaims.
  // (file CONTENT is arbitrary code; the sentinel above is its injection defense, not the overclaim regex.)
  const metaHits = scanForbiddenValues(objective).concat(files.flatMap((f) => scanForbiddenValues(f.relPath)));
  if (metaHits.length) throw new PatchParseError(`forbidden content in patch metadata: ${metaHits[0]}`);

  return { objective, files, engineSource: 'opencode', sanitized: true, canonReceipt: sentinel.receipt };
}
