/**
 * 24Z.27 — Local LOOPBACK model client (the only network surface; loopback-hard, bounded, no key).
 *
 * The first real model wire for OpenCode. It speaks ONLY to a loopback endpoint (127.0.0.1 / localhost / [::1]),
 * never an external host: the URL is strictly validated BEFORE every request (no userinfo, no disguised host, no
 * decimal/hex IP), redirects are refused outright (`redirect: 'error'` — a 3xx to an external host can never be
 * followed), the request is hard-timed-out, and the response is read with a byte cap. No API key is ever required
 * or sent. The raw text is returned UNTRUSTED — the caller MUST pass it through the Canonicalization Sentinel
 * before it can become a patch candidate. If the endpoint is unreachable, the caller stays PARKED honestly.
 */

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 256 * 1024;

/** STRICT loopback check: protocol http(s), host EXACTLY a loopback literal/name, no userinfo. Rejects everything
 *  else (127.0.0.1.evil, localhost.evil, [::1]@evil, 0.0.0.0, userinfo tricks). NOTE: decimal/hex notations OF the
 *  loopback IP (2130706433 / 0x7f000001) are normalized by the URL parser to 127.0.0.1 — they genuinely point to
 *  loopback and cannot resolve elsewhere, so they are accepted (equivalent to the literal). A non-loopback decimal
 *  IP normalizes to its own non-loopback host and is rejected.
 *
 *  24Z.33: `strictLiteralOnly` (DEFAULT for the readiness path) additionally rejects the NAME `localhost` — only the
 *  literals 127.0.0.1 / ::1 are accepted. RESIDUAL (documented, not silently accepted): `localhost` is resolved by
 *  the OS resolver and could in principle be DNS-rebound to a non-loopback address by a hostile resolver; a literal
 *  IP cannot be rebound. Accepting `localhost` is therefore a policy decision left to the caller, off by default. */
export function isStrictLoopbackUrl(raw: string, opts: { strictLiteralOnly?: boolean } = {}): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;                 // no userinfo (host-spoofing vector)
  const host = u.hostname.toLowerCase();
  if (host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;     // literals (un-rebindable)
  if (host === 'localhost') return !opts.strictLiteralOnly;    // name: accepted only when policy allows (rebind residual)
  return false;
}

export interface LocalEndpointProbe { reachable: boolean; status?: number; reason?: string }

/** Probe a loopback endpoint with a bounded request. Never reaches an external host; never follows a redirect. */
export async function probeLocalEndpoint(endpoint: string, opts: { timeoutMs?: number } = {}): Promise<LocalEndpointProbe> {
  if (!isStrictLoopbackUrl(endpoint)) return { reachable: false, reason: 'endpoint is not a strict loopback URL' };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, { method: 'GET', redirect: 'error', signal: ac.signal, headers: { accept: 'application/json' } });
    return { reachable: true, status: res.status };
  } catch (e) {
    return { reachable: false, reason: e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(t); }
}

export interface CallLocalModelOptions { timeoutMs?: number; maxBytes?: number; model?: string | null }
export interface LocalModelResult { ok: boolean; text?: string; reason?: string; bytes?: number }

/** Read a fetch Response body up to maxBytes, aborting if exceeded (no unbounded buffering of a hostile endpoint). */
async function readBounded(res: Response, maxBytes: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) { const t = await res.text(); return { text: t.slice(0, maxBytes), bytes: Buffer.byteLength(t, 'utf8'), truncated: Buffer.byteLength(t, 'utf8') > maxBytes }; }
  const chunks: Uint8Array[] = []; let bytes = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { bytes += value.byteLength; if (bytes > maxBytes) { truncated = true; await reader.cancel(); break; } chunks.push(value); }
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), bytes, truncated };
}

/**
 * Call a LOOPBACK model endpoint with a bounded prompt; return the raw (UNTRUSTED) text. Loopback-hard, no key,
 * redirect-refused, hard-timeout, byte-capped. The caller must canonicalize the result before trusting it.
 * Posts an OpenAI-ish chat body; tolerant of the response shape (returns the raw text for the sentinel/parser).
 */
export async function callLocalModel(endpoint: string, prompt: string, opts: CallLocalModelOptions = {}): Promise<LocalModelResult> {
  if (!isStrictLoopbackUrl(endpoint)) return { ok: false, reason: 'endpoint is not a strict loopback URL' };
  if (typeof prompt !== 'string' || prompt.length > 8000) return { ok: false, reason: 'prompt must be a bounded string (<=8000)' };
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',                                   // a redirect (even to a loopback) is refused — no external follow
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },      // NO authorization header — local provider needs no key
      body: JSON.stringify({ model: opts.model ?? 'local', messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 2048 }),
    });
    if (!res.ok) return { ok: false, reason: `local model HTTP ${res.status}` };
    const { text, bytes, truncated } = await readBounded(res, maxBytes);
    if (truncated) return { ok: false, reason: `local model response exceeded ${maxBytes} bytes`, bytes };
    // pull the text out of common shapes; fall back to the raw body (the sentinel/parser handles either).
    let out = text;
    try {
      const j = JSON.parse(text);
      out = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? j?.content ?? j?.response ?? text;
    } catch { /* not JSON-wrapped — use the raw text */ }
    return { ok: true, text: typeof out === 'string' ? out : JSON.stringify(out), bytes };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(t); }
}
