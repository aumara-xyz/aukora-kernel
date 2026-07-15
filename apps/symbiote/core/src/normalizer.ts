export interface RawIntent {
  [key: string]: any;
}

export interface NormalizedIntent {
  action: string;
  resource: string;
  ring: string;
}

const SACRED_PATTERNS: RegExp[] = [
  /(^|_)aukora_?(config|secret|token|grant|kill|runtime|intent|salama)/,
  /(^|_)token_?secret/,
  /(^|_)(aumlok|auth|credential)(?:es|s)?(_|$)/,
  /(^|_)founder(?:s)?(_|$)/,
  /(^|_)kill_?switch(?:es)?(_|$)/,
  /(^|_)(?:self_?)?doctrine(?:s)?(_|$)/,
  /(^|_)identity_?core/,
  /(^|_)(other|cross)_?user(?:s)?(_|$)/,
];

const MAX_SACRED_RAW = 8192;
const MAX_SACRED_INPUT = 256;

function normalizeForSacred(s: string): string {
  let t = (s ?? "").slice(0, MAX_SACRED_RAW);
  try { t = t.normalize("NFKD"); } catch { }
  return t
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SACRED_INPUT);
}

export function isSacredTarget(action: string, resource: string): boolean {
  const a = normalizeForSacred(action);
  const r = normalizeForSacred(resource);
  return SACRED_PATTERNS.some((re) => re.test(a) || re.test(r));
}

const AUKORA_ASCII_PRINTABLE = /^[\x20-\x7E]*$/;

export function normalizeProposal(raw: RawIntent): NormalizedIntent {
  // 1. Enforce strict typing
  const action = typeof raw.action === 'string' ? raw.action : 'unknown';
  const resource = typeof raw.resource === 'string' ? raw.resource : 'unknown';
  const ring = typeof raw.ring === 'string' ? raw.ring : 'unknown';

  // 2. Length limits (prevent ReDoS or memory exhaustion)
  if (action.length > 256 || resource.length > 256 || ring.length > 64) {
    return { action: 'refused_length', resource: 'unknown', ring: 'unknown' };
  }

  // 3. ASCII Printable enforcement for ALL fields
  if (!AUKORA_ASCII_PRINTABLE.test(action) || !AUKORA_ASCII_PRINTABLE.test(resource) || !AUKORA_ASCII_PRINTABLE.test(ring)) {
    return { action: 'refused_charset', resource: 'unknown', ring: 'unknown' };
  }

  // 4. Sacred Boundary check (Ring-0 absolute refusal)
  if (isSacredTarget(action, resource)) {
    return { action: 'sacred_violation', resource: 'sacred_violation', ring: 'unknown' };
  }

  // Strip all authority-claiming fields. Only return the strict tuple.
  // We recreate the object to guarantee exactly 3 keys exist.
  return { action, resource, ring };
}
