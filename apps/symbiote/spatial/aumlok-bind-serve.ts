// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The AUMLOK BINDING DOOR — the native first-binding ceremony (docs/SPEC_sovereign_ceremony.md), the
 * no-terminal keygen the owner asked for (2026-07-08). A SEPARATE one-shot loopback door, exactly the
 * #105b approve-door posture: never the read-only observer, Host+Origin pinned, loopback only.
 *
 * Lifetime discipline (this is the owner-approved amendment to the draft spec's manual start):
 *   - started by `bun run start` on BOTH postures (canonical-ceremony round, #242): UNBOUND it serves
 *     the first binding; SOVEREIGN it serves ONLY in-app phrase rotation — the kernel refuses keygen
 *     when bound, so there is still no standing keygen surface on a sovereign node.
 *   - one successful ceremony → the door logs, lingers briefly so the page can finish, then EXITS.
 *   - rotation's deliberate act is the TYPED CURRENT PHRASE (with lockout) — never an env flag.
 *
 * What can never happen here: the private key is generated + written to disk by the ceremony kernel
 * (core/src/aumlokBindCeremony.ts) inside THIS local process and is never serialized into any HTTP
 * response; the phrase is never persisted (salted fingerprint only); nothing here signs or applies
 * anything — binding grants no authority, it only makes the owner's future signature possible.
 */
import {
  freshBindStore, bindPosture, mintBindCandidate, beginPhraseRotation, completeCeremony, loadRotateGuardIntoStore,
  revokeBindCandidate, candidateAlive, classifyBindStartup, legacyRecoveryRequired, recoverLegacyReceipt,
  bindStatusCorsHeaders,
} from '../core/src/aumlokBindCeremony';
import { fetchDrandAnchor } from '../core/src/drandAnchor';
import { evaluateApprovalGate } from '../core/src/aumlokApproveGuard';
// aumlok-ceremony-echo-v1 (#288, AURA lane): display/evidence seam ONLY. Constructed HERE — the
// door's success path is the contract's single construction site — from exactly three inputs:
// the public authority-root id, a content-free receipt reference, and an optional verified drand
// round. Fail-soft and one-way: a missing input yields NO echo (never an error, never a ceremony
// change); nothing about the echo ever flows back into ceremony or authority code.
import { buildCeremonyEchoPacket, deriveReceiptRef, echoEnvelopeParams, ceremonyEchoProvenanceLine, type CeremonyEchoEvent } from '../core/src/aumlokCeremonyEcho';
// aumlok-genesis-aura-v1 (#288, AURA lane): the STANDING half of the identity visual. Read-only,
// reconstructed on every load from the two rotation-stable public facts (manifest keyId + receipt
// boundAt) — no event is minted, no phrase is requested, and a rotation lays the transient echo
// OVER this base but can never replace it (nothing rotation-varying is an input).
import { buildGenesisAuraPacket, genesisAuraParams, genesisAuraCaption } from '../core/src/aumlokGenesisAura';
import { resolveGenesisBindingFacts } from '../core/src/aumlokGenesisBridge';
import { hybridV2StatePresent } from '../core/src/aumlokBindV2';
import { readCapabilityMode } from './capabilityMode';
import { capabilityModePath } from '../authority/symbiotePaths';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PORT = Number(process.env.AUKORA_AUMLOK_BIND_PORT ?? 7095); // 7094 is the approve gate; this is its sibling
const SPATIAL_PORT = Number(process.env.AUKORA_SPATIAL_PORT ?? 7090);
const SPATIAL_ORIGINS = [`http://127.0.0.1:${SPATIAL_PORT}`, `http://localhost:${SPATIAL_PORT}`] as const;
const SPATIAL_URL = `http://127.0.0.1:${SPATIAL_PORT}/`;
const SYMBIOTE_HOME = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote');
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const EXIT_LINGER_MS = 20_000;

const store = freshBindStore();
// Codex review fix (#284): the rotation lockout is DURABLE — load it at boot so a door restart never
// hands out fresh guesses (the kernel additionally re-reads the guard on every rotation attempt).
loadRotateGuardIntoStore(store, SYMBIOTE_HOME);
// Bounded-life guarantee (lifecycle brick): even if no request ever arrives, an abandoned
// candidate's in-memory phrase is reaped within a minute of its expiry — never process-lifetime.
setInterval(() => candidateAlive(store, Date.now()), 60_000);
// Atomic-bind brick: startup detects and LOUDLY classifies interrupted identity state. Disposable
// staging is cleaned automatically (and journaled); a partial bundle is journaled and shouted here
// but never touched — detection is not repair, and standing identity is never replaced silently.
{
  const bundle = classifyBindStartup(SYMBIOTE_HOME, Date.now());
  if (bundle.state === 'partial') {
    // eslint-disable-next-line no-console
    console.error(`AUMLOK binding door: INTERRUPTED/PARTIAL identity bundle detected — present: [${bundle.present.join(', ')}], missing: [${bundle.missing.join(', ')}]. Nothing was touched. This node reports UNBOUND until the owner resolves it; a fresh bind will quarantine (never delete) key-less partials.`);
  }
}

// Legacy-migration UX (#305-era bindings): the UI may know only the phrase FORMAT — never hashes,
// salts, keys, phrase text, word counts inferred from hashes, or any private metadata. The format is
// derived from the fingerprint file's schema STRING alone; a missing or unreadable file is
// 'unrecognized' (fail-soft, content-free). A legacy-v1 binding proves with its six words only, so
// the door tells its own page to render the anchor spine as display, not entry.
function phraseFormat(): 'legacy-v1' | 'seven-word-v2' | 'unrecognized' {
  if (hybridV2StatePresent(SYMBIOTE_HOME)) return 'seven-word-v2';
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(SYMBIOTE_HOME, 'aumlok', 'phrase-fingerprint.json'), 'utf-8')) as { schema?: unknown };
    if (raw && raw.schema === 'aumlok-phrase-fingerprint-v1') return 'legacy-v1';
    if (raw && raw.schema === 'aumlok-phrase-fingerprint-v2') return 'seven-word-v2';
  } catch { /* unbound or unreadable — nothing to reveal */ }
  return 'unrecognized';
}

function advisory(): boolean { return readCapabilityMode(capabilityModePath()) === 'advisory'; }
/** The door is alive for exactly two owners' errands, decided by POSTURE (canonical-ceremony round —
 *  no env flag): UNBOUND → the first binding; SOVEREIGN → phrase rotation ONLY, gated by the typed
 *  current phrase + lockout in the kernel. There is still no standing keygen surface on a bound node:
 *  the kernel refuses mint/bind when sovereign, and this door one-shots after any success. */
function enabled(): boolean { return true; }
function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders } });
}
function gate(req: Request): Response | null {
  const d = evaluateApprovalGate({
    enabled: enabled(),
    advisory: advisory(),
    host: req.headers.get('host'),
    origin: req.headers.get('origin'),
    secFetchSite: req.headers.get('sec-fetch-site'),
    allowedHosts: ALLOWED_HOSTS,
    allowedOrigins: ALLOWED_ORIGINS,
  });
  return d.ok ? null : json({ ok: false, reason: d.reason }, d.status);
}
async function readJson(req: Request): Promise<Record<string, unknown>> {
  try { const b = await req.json(); return b && typeof b === 'object' ? b as Record<string, unknown> : {}; } catch { return {}; }
}
function scheduleOneShotExit(what: string): void {
  // eslint-disable-next-line no-console
  console.log(`AUMLOK binding door: ${what} — closing itself in ${EXIT_LINGER_MS / 1000}s (one-shot by design).`);
  setTimeout(() => process.exit(0), EXIT_LINGER_MS);
}

/** The standing genesis base, rebuilt read-only on every load. The two rotation-stable facts come
 *  from the bridge (legacy-migration round): the real receipt's boundAt whenever the receipt file
 *  exists; ONLY on the legacy pre-receipt shape, the validated root manifest's stable createdAt.
 *  Honest absence (`present:false`) on an unbound/malformed node — never an error, never a guess,
 *  never a prompt. Deliberately NO single-use semantics: a standing base is re-read every load. */
function readGenesisAura() {
  const facts = resolveGenesisBindingFacts(SYMBIOTE_HOME);
  if (!facts.present) return { present: false as const };
  const verdict = buildGenesisAuraPacket({ rootId: facts.rootId, boundAt: facts.boundAt });
  if (!verdict.ok) return { present: false as const };
  return { present: true as const, packet: verdict.packet, base: genesisAuraParams(verdict.packet), caption: genesisAuraCaption(verdict.packet) };
}

// ── ceremony echo (#288): single-use per receipt, this process's lifetime — a replayed ref refuses. ──
const seenEchoRefs = new Set<string>();

/** Build the display-only echo AFTER a successful ceremony. Reads ONLY public artifacts (manifest
 *  keyId, receipt boundAt); derives a content-free ref; carries an optional ALREADY-VERIFIED drand
 *  round. Fail-soft by contract: any missing/invalid input → null (the ceremony response is never
 *  blocked, and a failed/abandoned ceremony never reaches this function at all). */
function buildEchoForSuccess(event: CeremonyEchoEvent, drandRound: number | undefined) {
  try {
    const facts = resolveGenesisBindingFacts(SYMBIOTE_HOME);
    if (!facts.present) return null;
    const keyId = facts.rootId;
    const boundAt = facts.boundAt;
    const atMs = Date.now();
    const receiptRef = deriveReceiptRef({ keyId, boundAt, event, atIso: new Date(atMs).toISOString() });
    const verdict = buildCeremonyEchoPacket({ event, rootId: keyId, receiptRef, atMs, drandRound }, seenEchoRefs);
    if (!verdict.ok) return null; // refusal is categorical and silent here — display never blocks ceremony
    return { packet: verdict.packet, envelope: echoEnvelopeParams(verdict.packet), provenance: ceremonyEchoProvenanceLine(verdict.packet) };
  } catch { return null; }
}

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return new Response(BIND_PAGE_HTML, { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': `frame-ancestors 'self' ${SPATIAL_ORIGINS.join(' ')}`,
      } });
    }

    // READ-ONLY status — CORS permits exactly the shell origins (:7090) so the AUMLOK organ can
    // render Create/Rotate. Presence only; never key bytes, never a phrase.
    if (req.method === 'GET' && p === '/api/bind/status') {
      return json({ ok: true, posture: bindPosture(SYMBIOTE_HOME), enabled: enabled(), advisory: advisory(), candidateAlive: candidateAlive(store, Date.now()), phraseFormat: phraseFormat(), recoveryRequired: legacyRecoveryRequired(SYMBIOTE_HOME) }, 200, bindStatusCorsHeaders(req.headers.get('origin'), SPATIAL_ORIGINS));
    }

    // READ-ONLY genesis base (#288, AURA) — the standing silver pattern, rebuilt deterministically
    // from the two rotation-stable public facts on EVERY read. Mints nothing, requests nothing;
    // same exact-origin CORS posture as status. Unbound node → honest `present:false`.
    if (req.method === 'GET' && p === '/api/bind/genesis') {
      return json({ ok: true, ...readGenesisAura() }, 200, bindStatusCorsHeaders(req.headers.get('origin'), SPATIAL_ORIGINS));
    }

    // THE CEREMONY EMBLEM (#288 revision): one bounded same-origin asset route — the existing
    // on-disk Aukora trefoil, byte-served as-is. Exact path only, GET only, one fixed file; never
    // inlined, never duplicated, never hot-linked. Silver/charcoal treatment happens in page CSS.
    if (req.method === 'GET' && p === '/assets/aumara-icon.png') {
      try {
        return new Response(fs.readFileSync(path.join(import.meta.dir, 'assets', 'aumara-icon.png')), {
          headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' },
        });
      } catch { return new Response('emblem unavailable', { status: 404 }); }
    }
    // The birth/chamber renderer (#357) + its vendored MIT Three.js — served SAME-ORIGIN so the
    // completion birth sequence loads without a CDN. Strict allowlist of exact filenames (no path
    // traversal), GET only, static JS. These are display assets; they touch no ceremony/key state.
    if (req.method === 'GET' && (p === '/assets/aura-birth.js' || p === '/assets/vendor/three.module.min.js')) {
      try {
        const rel = p.slice('/assets/'.length); // 'aura-birth.js' | 'vendor/three.module.min.js'
        if (rel.includes('..')) return new Response('no', { status: 400 });
        return new Response(fs.readFileSync(path.join(import.meta.dir, 'assets', rel)), {
          headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' },
        });
      } catch { return new Response('renderer unavailable', { status: 404 }); }
    }

    // MINT / RESHUFFLE the ceremony phrase (unbound nodes only — the kernel refuses otherwise).
    if (req.method === 'POST' && p === '/api/bind/phrase') {
      const g = gate(req); if (g) return g;
      const v = mintBindCandidate(store, SYMBIOTE_HOME, Date.now());
      return v.ok ? json(v) : json(v, 409);
    }

    // BEGIN ROTATION: in-app, no env flag (canonical-ceremony round). The deliberate act IS the typed
    // current phrase — the kernel verifies it against the versioned fingerprint (with lockout) before
    // any fresh candidate is revealed.
    // OWNER CANCEL (candidate-lifecycle brick): revoke the in-memory candidate — the
    // pre-commitment dies; the standing phrase, fingerprint, key, lockout, genesis base, and
    // receipts are untouched. Idempotent; content-free; same gate as every other POST.
    if (req.method === 'POST' && p === '/api/bind/cancel') {
      const g = gate(req); if (g) return g;
      const r = revokeBindCandidate(store);
      return json({ ok: true, revoked: r.revoked, candidateAlive: false });
    }

    // LEGACY LINEAGE RECOVERY (#345): the ONLY door action offered over standing key material that
    // lacks a receipt. Same gate + lockout as rotation; writes only the advisory recovery receipt.
    if (req.method === 'POST' && p === '/api/bind/recover') {
      const g = gate(req); if (g) return g;
      const body = await readJson(req);
      const current = typeof body.currentPhrase === 'string' ? body.currentPhrase : '';
      const v = recoverLegacyReceipt(store, SYMBIOTE_HOME, current, Date.now());
      return v.ok ? json(v) : json(v, 403);
    }

    if (req.method === 'POST' && p === '/api/bind/rotate') {
      const g = gate(req); if (g) return g;
      const body = await readJson(req);
      const current = typeof body.currentPhrase === 'string' ? body.currentPhrase : '';
      const v = beginPhraseRotation(store, SYMBIOTE_HOME, current, Date.now());
      return v.ok ? json(v) : json(v, 403);
    }

    // COMPLETE — the type-back. On success the kernel does all writing; this door only relays the verdict.
    if (req.method === 'POST' && p === '/api/bind/complete') {
      const g = gate(req); if (g) return g;
      const body = await readJson(req);
      const typed = typeof body.phrase === 'string' ? body.phrase : '';
      const nonce = typeof body.nonce === 'string' ? body.nonce : '';
      // Advisory proof-of-time: verified drand round folded into the receipt when the owner armed
      // AUKORA_DRAND_ANCHOR=1 (the module is fail-closed + egress-gated; absence is honest).
      const stamp = await fetchDrandAnchor();
      const v = completeCeremony(store, SYMBIOTE_HOME, typed, nonce, Date.now(), stamp.ok ? stamp.anchor : undefined);
      if (v.ok) scheduleOneShotExit(v.mode === 'bind' ? 'node bound (sovereign)' : 'phrase rotated');
      if (!v.ok) return json(v, 403); // failed/abandoned ceremony → NO echo packet exists, by contract
      // SUCCESS: attach the display-only ceremony echo (one-way; fail-soft; never alters the verdict).
      const echo = buildEchoForSuccess(v.mode, stamp.ok && Number.isSafeInteger(stamp.anchor?.round) && stamp.anchor.round > 0 ? stamp.anchor.round : undefined);
      return json(echo ? { ...v, echo } : v);
    }

    return json({ ok: false, reason: 'not found' }, 404);
  },
});

// eslint-disable-next-line no-console
console.log(`AUMLOK binding door on http://127.0.0.1:${PORT}  ·  ${bindPosture(SYMBIOTE_HOME) === 'unbound' ? 'UNBOUND — binding ceremony available' : 'SOVEREIGN — phrase rotation available (typed current phrase required; keygen refused)'}`);

// ── the ceremony page (self-contained; same-origin; no external assets) ───────────────────────────────────
// Visual-repair round (2026-07-10): presentation only — the routes, kernel calls, CORS, and custody above
// are untouched. Trinity grammar throughout (no raw black surface anywhere); framed mode is compact and
// reports a content-free measured height to the shell so the ceremony iframe never shows a dead field;
// phrase entry is a STRUCTURED PHRASE RAIL — word zero (anchor) plus six themed positions in the
// acrostic's own hue grammar. Only nonempty slots serialize (in order), so a legacy five/six-word
// standing phrase still proves; new phrases remain seven words by kernel law. Rail values are the
// owner's keystrokes only: never prefilled, never stored, never logged.
const BIND_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AUMLOK — the binding</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 /* Trinity design language — same grammar as spatial/app/style.css; this page frames inside the
    AUMLOK organ (owner directive 2026-07-08: the ceremony lives IN the shell). */
 :root{--hue-l:129,212,180;--hue-c:150,180,255;--hue-r:196,170,255;
   --text:rgba(244,246,255,0.92);--dim:rgba(228,232,248,0.60);--faint:rgba(220,226,245,0.34);
   --glass:rgba(255,255,255,0.045);--glass-bright:rgba(226,232,248,0.055);--glass-border:rgba(255,255,255,0.10);--input-fill:rgba(255,255,255,0.06);
   --ok:rgba(var(--hue-l),0.95);--err:#ff9696;--accent:rgba(var(--hue-r),0.95);--ease:cubic-bezier(0.22,1,0.36,1)}
 *{box-sizing:border-box}
 /* standalone (#242): a FULL-STAGE first contact — the app's lighter gray-blue substrate carrying a
    balanced, vertically-centred composition, not a small dark card in a void. Framed = the stage
    shows through and the organ's crest is the shelf (no nested shelf). */
 body{margin:0;min-height:100vh;color:var(--text);font:14.5px/1.65 ui-sans-serif,system-ui,-apple-system,sans-serif;
   display:flex;flex-direction:column;justify-content:center;align-items:center;
   background:
     radial-gradient(1300px 900px at 18% -8%, rgba(var(--hue-l),0.16), transparent 62%),
     radial-gradient(1200px 820px at 82% 108%, rgba(var(--hue-r),0.18), transparent 62%),
     radial-gradient(1000px 760px at 50% 42%, rgba(var(--hue-c),0.12), transparent 66%),
     linear-gradient(160deg,#141827 0%,#191d2e 55%,#121420 100%)}
 body.framed{background:transparent;min-height:0;display:block}
 body.framed h1,body.framed .tag{display:none} /* the organ carries the crest */
 /* the standing composition sits ON the stage — a soft, wide, low-contrast surface (not a hard card
    floating in darkness). Framed, it dissolves entirely so the organ's crest is the only shelf. */
 .wrap{width:100%;max-width:620px;margin:0 auto;padding:44px 30px 48px;text-align:center;
   background:linear-gradient(180deg, rgba(226,232,248,0.05), rgba(226,232,248,0.02));
   border:1px solid rgba(255,255,255,0.06);border-radius:22px;
   box-shadow:0 0 90px rgba(var(--hue-c),0.06), inset 0 0 60px rgba(255,255,255,0.012)}
 body.framed .wrap{padding:6px 10px 14px;margin:0 auto;max-width:none;background:transparent;border:0;border-radius:0;box-shadow:none}
 /* a shelf floats WITHIN the stage — at narrow widths it keeps side breathing room instead of
    clipping its rounded corners against the viewport (framed mode outranks this by specificity) */
 @media (max-width:600px){ .wrap{margin:0 12px;padding:34px 20px 40px} }
 /* the wordmark wears the trinity (owner rule: never dim generic text) — larger, readable first
    impression. Owner round 2 (#358): FULL-strength brand gradient with the stops pulled inward so
    the visible glyphs actually reach green and purple (letter-spacing pads the text box), plus a
    soft brand glow. */
 h1{font-size:27px;letter-spacing:.32em;margin:0 auto 8px;font-weight:700;width:max-content;max-width:100%;
   background:linear-gradient(90deg, rgba(var(--hue-l),1) 4%, rgba(var(--hue-c),1) 50%, rgba(var(--hue-r),1) 96%);
   -webkit-background-clip:text;background-clip:text;color:transparent;
   filter:drop-shadow(0 0 16px rgba(var(--hue-c),0.30))}
 /* the tagline reads BIG and confident, one line, never the tiny dim whisper (owner order 2026-07-12) */
 .tag{color:rgba(255,255,255,0.78);font-size:16.5px;font-weight:500;max-width:60ch;margin:0 auto 26px;text-wrap:balance}
 .step{display:none} .step.on{display:block;animation:rise .5s ease both;isolation:isolate} /* isolate so the z-index:-1 echo sits BEHIND the words */
 @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
 @media (prefers-reduced-motion: reduce){.step.on{animation:none}.trefoil{animation:none}}
 /* copy discipline (owner rule): balanced ragging, no orphan words dangling on their own line */
 .lead{font-size:17px;margin:0 auto 16px;line-height:1.6;max-width:44ch;text-wrap:balance;color:var(--text)}
 .quiet{color:var(--dim);font-size:12.5px;line-height:1.65;margin:16px auto 0;max-width:52ch;text-wrap:balance}
 /* FACT PANELS (#358 owner pass, round 3): each critical truth is its own telescoping panel. The
    header is LEFT-justified with a subtle chevron on the right (owner order 2026-07-12: no
    "tell me more"/"show me the math" buttons — a quiet arrow says it opens). Click anywhere on the
    header → the detail unfolds BELOW: super-simple first, then the real math with formulas. Color is
    UI SEMANTICS only, in ceremony order — green=key · blue=your yes · purple=receipt · GOLD=you (the
    AURA is the owner made visible). Bigger, higher-contrast type. */
 .facts{display:flex;flex-direction:column;gap:16px;max-width:490px;margin:6px auto 20px;text-align:left}
 details.fact{--fc:255,255,255;position:relative;border-radius:16px;overflow:hidden;
   border:1px solid rgba(var(--fc),0.58);
   background:linear-gradient(155deg, rgba(var(--fc),0.22), rgba(var(--fc),0.07) 55%, rgba(var(--fc),0.14));
   box-shadow:inset 0 0 34px rgba(var(--fc),0.07), 0 0 22px rgba(var(--fc),0.05)}
 details.fact.f-l{--fc:var(--hue-l)} details.fact.f-c{--fc:var(--hue-c)}
 details.fact.f-r{--fc:var(--hue-r)} details.fact.f-o{--fc:255,193,122}
 .fact-sum{list-style:none;cursor:pointer;display:flex;align-items:center;gap:14px;padding:16px 18px}
 .fact-sum::-webkit-details-marker{display:none}
 .fact-txt{flex:1;min-width:0}
 .fact-t{font-size:17px;line-height:1.4;color:#fff;font-weight:600;text-wrap:balance}
 .fact-t b{color:#fff;font-weight:750}
 .fact-s{font-size:13.5px;line-height:1.5;color:rgba(255,255,255,0.74);margin-top:5px}
 /* the subtle telescope arrow — a thin chevron, no button chrome; rotates up when the panel opens */
 .fact-sum::after{content:"";flex:none;width:9px;height:9px;margin-right:2px;
   border-right:2px solid rgba(var(--fc),0.9);border-bottom:2px solid rgba(var(--fc),0.9);
   transform:rotate(45deg) translateY(-2px);transition:transform .3s var(--ease);opacity:.85}
 .fact-sum:hover::after{opacity:1}
 details.fact[open] .fact-sum::after{transform:rotate(225deg) translateY(2px)}
 /* the detail — super-simple first, then a hard-math block with real formulas (owner order: go hard
    so nobody thinks this is a gimmick). Left-justified, readable, higher contrast than before. */
 .fact-detail{padding:2px 18px 17px;font-size:14px;line-height:1.62;color:rgba(255,255,255,0.82);text-align:left}
 .fact-detail p{margin:0 0 10px} .fact-detail p:last-child{margin-bottom:0}
 .fact-detail b{color:#fff;font-weight:650}
 .fact-math{margin-top:11px;padding:12px 14px;border-radius:12px;
   background:rgba(var(--fc),0.09);border-left:2px solid rgba(var(--fc),0.55)}
 .fact-math .ml{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:rgba(var(--fc),0.95);
   font-weight:650;margin-bottom:7px}
 .fact-math p{font-size:13px;line-height:1.62;color:rgba(255,255,255,0.78);margin:0 0 8px}
 .fact-math .f{display:block;font-family:ui-monospace,monospace;font-size:12.5px;letter-spacing:.01em;
   color:rgba(var(--fc),0.98);background:rgba(18,22,36,0.55);border-radius:8px;padding:8px 11px;margin:8px 0;
   overflow-x:auto;white-space:nowrap}
 .fact-math .note{font-size:12px;color:rgba(255,255,255,0.58);font-style:italic}
 /* the honest time-anchor status — now a PLAIN readable line inside the receipt panel's detail
    (owner order 2026-07-12: the mono 'not time-anchored' jargon was off and hard to read) */
 .anchor-truth{font-size:13.5px;line-height:1.55;color:rgba(255,255,255,0.8);margin:10px 0 0}
 .anchor-truth b{color:#fff;font-weight:650}
 /* the ONE line of aftercare under the bound recap — short and readable, never a whisper wall */
 .aftercare{font-size:13px;line-height:1.6;color:var(--dim);max-width:46ch;margin:14px auto 0;text-wrap:balance}
 /* the big primary CTA (owner order 2026-07-12): full panel width, larger — the door's one clear next step */
 .cta-wide{width:100%;max-width:490px;font-size:15px;padding:15px 22px;letter-spacing:.06em;margin:2px auto 0}
 /* THE ANCHOR HERO (#358 owner order 2026-07-12): word zero gets its OWN gold bar across the top —
    big, single box, no breaks — so it is unmistakably THE anchor. Ephemeral: shown only now, wiped
    with the step, never stored or logged. */
 /* the anchor hero matches the width of the boxes below it (owner order 2026-07-12: never wider) */
 .anchor-hero{max-width:460px;margin:0 auto 22px;padding:16px 20px;border-radius:16px;text-align:center;
   --fc:255,193,122;border:1px solid rgba(var(--fc),0.6);
   background:linear-gradient(150deg, rgba(var(--fc),0.24), rgba(var(--fc),0.09) 60%, rgba(var(--fc),0.16));
   box-shadow:inset 0 0 34px rgba(var(--fc),0.09), 0 0 26px rgba(var(--fc),0.08)}
 .anchor-hero-k{font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:rgba(var(--fc),0.98);font-weight:700}
 .anchor-hero-w{font-family:ui-monospace,monospace;font-size:36px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
   color:rgba(var(--fc),1);margin-top:6px;line-height:1.1;overflow-wrap:anywhere}
 .anchor-hero-s{font-size:13px;line-height:1.5;color:rgba(255,255,255,0.78);margin-top:8px}
 /* the THREE-THEME row (owner order 2026-07-12): three color boxes left-to-right, one label on top +
    a short line below — NOT a stacked blob. Above it, one floating intro line names the Balinese
    Tri Hita Karana the pairs mirror. */
 .theme-intro{font-size:13.5px;line-height:1.55;color:var(--dim);max-width:460px;margin:26px auto 12px;text-align:center;text-wrap:balance}
 .theme-intro b{color:rgba(255,255,255,0.9)}
 .theme-row{display:flex;gap:11px;max-width:460px;margin:0 auto;text-align:center}
 .theme-box{--tc:var(--hue-c);flex:1;min-width:0;padding:14px 9px;border-radius:14px;
   border:1px solid rgba(var(--tc),0.42);
   background:linear-gradient(160deg, rgba(var(--tc),0.16), rgba(var(--tc),0.05) 70%);
   box-shadow:inset 0 0 22px rgba(var(--tc),0.06)}
 .theme-box.h-l{--tc:var(--hue-l)} .theme-box.h-r{--tc:var(--hue-r)}
 .theme-box .tl{font-size:14.5px;font-weight:750;letter-spacing:.1em;color:rgba(var(--tc),1);text-transform:uppercase}
 .theme-box .td{font-size:12.5px;line-height:1.4;color:rgba(255,255,255,0.82);margin-top:7px}
 .theme-box .tp{font-size:11px;letter-spacing:.02em;color:rgba(var(--tc),0.85);margin-top:6px;font-style:italic}
 /* the WRITE-IT-DOWN slap (owner order: "a slap in the face"). Centered, three short lines, an SVG
    pen (owner order 2026-07-12: NEVER an emoji). */
 .writedown{max-width:460px;margin:26px auto 4px;padding:17px 18px;border-radius:14px;text-align:center;
   --wc:255,193,122;border:1.5px solid rgba(var(--wc),0.72);background:rgba(var(--wc),0.12);
   box-shadow:0 0 26px rgba(var(--wc),0.15),inset 0 0 30px rgba(var(--wc),0.06)}
 .writedown .wk{display:flex;align-items:center;justify-content:center;gap:10px;font-size:16.5px;font-weight:750;color:#fff;letter-spacing:.02em}
 .writedown .wk svg{width:20px;height:20px;flex:none}
 .writedown .wv{font-size:14px;line-height:1.5;color:rgba(255,255,255,0.9);margin-top:9px}
 .writedown .ws{font-size:12px;line-height:1.5;color:rgba(255,255,255,0.58);margin-top:5px}
 /* the ephemeral anchor line kept as a hidden aria fallback — the hero is the visible word */
 .anchor-line{font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.14em;margin:0 auto 16px;
   color:rgba(226,232,248,0.72)}
 .anchor-line b{color:var(--accent);font-weight:650}
 /* ceremony echo (#288) — the first ripple, named SILVER. Slow silver-white rings that rise, hold
    briefly, and settle back to the standing state. Display only; reduced-motion renders none. */
 /* the ceremony emblem (#288 revision) — the Aukora trefoil. The STANDING icon on the initial,
    rotate, and bound steps: never a generic circle. Full trinity color on the opening steps
    (owner order 2026-07-11); silver/charcoal ONLY on .genesis, where silver is the named state.
    Deterministic genesis params add only subtle opacity/glow; echo ripples stay behind/around it. */
 .emblem{position:relative;width:116px;height:116px;margin:4px auto 22px}
 /* the birth/chamber canvas (#357): full-stage, replaces the static emblem on completion. Charcoal
    substrate carries it; it settles into the silver genesis base. Hidden until the birth begins. */
 #birth-canvas{display:none;width:320px;height:320px;max-width:84vw;margin:0 auto 10px}
 #s-bound.birthing .emblem{display:none}       /* the canvas replaces the static emblem entirely (halo included) */
 #s-bound.birthing #birth-canvas{display:block}
 .birth-cap{min-height:14px;margin:-2px 0 8px;text-align:center;font-size:11px;letter-spacing:.14em;
   text-transform:uppercase;color:rgba(226,232,240,.5);transition:opacity .5s ease}
 #s-bound:not(.birthing) .birth-cap{display:none}
 /* Owner order (2026-07-11): the ceremony trefoil wears its TRUE trinity colors on the opening
    steps — the silver treatment was the old rule and it belongs only where silver MEANS something:
    the .genesis emblem (the named silver state of a standing/bound identity). */
 .trefoil{display:block;position:relative;width:116px;height:116px;-webkit-user-drag:none;
   filter:saturate(1.12) brightness(1.05) drop-shadow(0 0 18px rgba(var(--hue-c),0.28));opacity:.96;animation:breathe 4.5s ease-in-out infinite}
 .trefoil.genesis{filter:grayscale(1) brightness(1.06) contrast(.94);opacity:.82}
 .trefoil.genesis.open{filter:grayscale(1) brightness(1.16) contrast(.92);opacity:.92}
 .genesis-cap{min-height:15px;margin:-8px 0 10px;text-align:center;font-family:ui-monospace,monospace;
   font-size:10.5px;letter-spacing:.08em;color:rgba(226,232,240,.55)}
 /* the ONE gold rule (owner ruling): a faint static halo at the alchemy center, visible only on the
    success step by construction — never animated, never a count, never a state name. Silver keeps
    the motion; gold marks only the completed center. */
 #s-bound .emblem::after{content:"";position:absolute;inset:16px;border-radius:50%;
   box-shadow:0 0 30px 8px rgba(255,180,110,0.16);pointer-events:none}
 /* the ripple lives BEHIND the words (z-index:-1) and blooms only a little, softly — a silver halo
    around the trefoil, never hard rings sweeping across the text below it. */
 #echo{position:absolute;inset:0;pointer-events:none;z-index:-1}
 .echo-ripple{position:absolute;inset:0;border-radius:50%;border:1px solid rgba(226,232,240,.5);
   box-shadow:0 0 22px rgba(226,232,240,.28),0 0 46px rgba(203,213,225,.16) inset;opacity:0;
   animation-name:echo-rise;animation-timing-function:cubic-bezier(.22,.61,.36,1);animation-fill-mode:forwards}
 @keyframes echo-rise{0%{transform:scale(1);opacity:0}14%{opacity:.55}45%{transform:scale(1.5);opacity:.3}
   65%{transform:scale(1.75);opacity:.18}100%{transform:scale(2);opacity:0}}
 .echo-prov{min-height:16px;margin:-6px 0 8px;font-family:ui-monospace,monospace;font-size:11px;
   letter-spacing:.06em;color:rgba(226,232,240,.75);opacity:0;transition:opacity 1.2s ease}
 .echo-prov.on{opacity:1}
 @media (prefers-reduced-motion: reduce){.echo-ripple{animation:none;opacity:0}}
 @keyframes breathe{0%,100%{transform:scale(1);opacity:.75}50%{transform:scale(1.05);opacity:1}}
 /* the PHRASE RAIL — the crest's OWN anchor/themed-row grammar (spatial/app/aumlok.js: .aum-mini-spine
    rows and the .aum-word/.aum-tie rows): a faint position number, the square hue tile with its masked
    dot, then the word surface. A vertical spine, exactly like the "your signing phrase" crest — hues
    follow POSITION only: 1-2 root (green) · 3-4 unite (blue) · 5-6 rise (purple); word zero rides the
    neutral spine tile. One grammar for entry (inputs) and reveal (read-only words). */
 .rail{display:flex;flex-direction:column;gap:20px;margin:14px auto 0;max-width:460px;text-align:left}
 /* three hue BANDS (root/unite/rise): each pair carries its hue. Owner order 2026-07-12: the RUR
    label is HORIZONTAL and bigger, vertically centered on the left; the anchor-letter column stays
    on the left; the whole band breathes. */
 .rail-band{display:flex;align-items:center;gap:14px;--tc:var(--hue-c);
   padding:14px 15px;border-radius:14px;
   border:1px solid rgba(var(--tc),0.32);border-left:3px solid rgba(var(--tc),0.6);
   background:linear-gradient(90deg, rgba(var(--tc),0.11), rgba(var(--tc),0.075) 50%, rgba(var(--tc),0.04));
   box-shadow:inset 0 0 24px rgba(var(--tc),0.05)}
 .rail-band.h-l{--tc:var(--hue-l)} .rail-band.h-r{--tc:var(--hue-r)}
 .rail-lab{flex:none;align-self:center;width:48px;text-align:center;
   font-size:12.5px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;color:rgba(var(--tc),1)}
 .rail-pair{flex:1;display:flex;flex-direction:column;gap:11px;min-width:0}
 .rail-row{display:flex;align-items:center;gap:11px}
 .rail-n{flex:none;width:14px;font:11px ui-monospace,monospace;color:var(--faint);text-align:right}
 /* the ANCHOR letter tiles — GOLD and UPPERCASE (owner order 2026-07-12), bigger; read down the left */
 .rail-ch{--ac:255,193,122;flex:none;width:42px;height:42px;box-sizing:border-box;text-align:center;border-radius:11px;
   border:1px solid rgba(var(--ac),0.4);background:rgba(var(--ac),0.08);color:rgba(var(--ac),1);
   font:600 19px ui-monospace,monospace;text-transform:uppercase;padding:0;outline:none;
   transition:border-color .2s var(--ease),box-shadow .2s var(--ease)}
 input.rail-ch::placeholder{color:var(--faint);text-transform:none}
 input.rail-ch:focus{border-color:rgba(var(--ac),0.75);box-shadow:0 0 14px rgba(var(--ac),0.18)}
 span.rail-ch{display:grid;place-items:center;box-shadow:inset 0 0 14px rgba(var(--ac),0.12)}
 /* legacy-v1: the spine is DISPLAY — softer, letters arrive as the words are typed */
 span.rail-ch.derived{border-color:rgba(var(--ac),0.22);color:rgba(var(--ac),0.7);box-shadow:none}
 span.rail-ch.derived:empty::before{content:"·";color:var(--faint)}
 .rail-row input.rail-w{flex:1;min-width:0;font:15px ui-monospace,monospace;letter-spacing:.07em;height:42px;padding:0 13px;
   border-radius:11px;border:1px solid rgba(var(--tc),0.2);background:var(--input-fill);color:var(--text);outline:none;
   transition:border-color .2s var(--ease),box-shadow .2s var(--ease)}
 .rail-row input.rail-w::placeholder{color:var(--faint);letter-spacing:.04em}
 .rail-row input.rail-w:focus{border-color:rgba(var(--tc),0.6);box-shadow:0 0 14px rgba(var(--tc),0.14),inset 0 0 10px rgba(var(--tc),0.07)}
 .rail-word{flex:1;min-width:0;font:16px ui-monospace,monospace;letter-spacing:.08em;color:var(--text);overflow-wrap:anywhere}
 /* one portal-button treatment (#194 telescoping rings), same as the approval gate */
 .actions{display:flex;gap:10px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:16px}
 button{position:relative;font:inherit;font-size:12.5px;letter-spacing:.05em;padding:9px 20px;border-radius:999px;cursor:pointer;color:var(--text);
   --pc:var(--hue-r);border:1px solid rgba(var(--pc),0.55);background:rgba(var(--pc),0.10);
   transition:background .25s var(--ease),box-shadow .25s var(--ease)}
 button::before,button::after{content:"";position:absolute;inset:-5px;border-radius:999px;border:1px solid rgba(var(--pc),0.30);
   opacity:0;transform:scale(.94);transition:opacity .3s var(--ease),transform .3s var(--ease);pointer-events:none}
 button::after{inset:-10px;border-color:rgba(var(--pc),0.16)}
 button:hover:not(:disabled){background:rgba(var(--pc),0.22);box-shadow:0 0 24px rgba(var(--pc),0.30)}
 button:hover:not(:disabled)::before,button:hover:not(:disabled)::after{opacity:1;transform:scale(1)}
 button:disabled{opacity:.4;cursor:not-allowed}
 button.ghost{border-color:var(--glass-border);background:transparent;color:var(--dim)}
 button.ghost::before,button.ghost::after{content:none}
 button.ghost:hover:not(:disabled){background:var(--glass);box-shadow:none;color:var(--text)}
 :focus-visible{outline:2px solid rgba(var(--hue-c),0.7);outline-offset:2px}
 .msg{margin-top:10px;font-size:12.5px;min-height:18px} .msg.ok{color:var(--ok)} .msg.err{color:var(--err)}
 code{font-family:ui-monospace,monospace;color:var(--dim);font-size:11.5px;word-break:break-all}
 .keyline{margin-top:6px;font-size:12px;color:var(--dim)}
 .banner{padding:10px 13px;border-radius:11px;border:1px solid rgba(255,180,120,.35);background:var(--glass);color:#ffc38a;font-size:12.5px}
</style></head><body><script>if(window.self!==window.top&&document.body)document.body.classList.add('framed');</script><div class="wrap">
 <h1>A U M L O K</h1><div class="tag">One key, born on this machine — and it answers only to you.</div>
 <div id="offline" class="banner" style="display:none"></div>

 <div id="s-arrive" class="step"><div class="emblem"><img class="trefoil" src="/assets/aumara-icon.png" alt=""></div>
  <p class="lead">This node is <b>unbound</b> — nothing lands until you can sign.</p>
  <div class="facts">
   <details class="fact f-l"><summary class="fact-sum"><div class="fact-txt">
     <div class="fact-t">This machine makes a <b>secret key</b>. It never leaves.</div>
     <div class="fact-s">Made here. Not shown, not sent — to us or anyone.</div></div></summary>
    <div class="fact-detail">
     <p>Think of a signature stamp sealed inside this machine. Everything your node ever does gets stamped by it, so anyone can check a thing really came from you — but the stamp itself never leaves, so no one can pretend to be you.</p>
     <div class="fact-math"><div class="ml">the actual crypto</div>
      <p>Your authority is one mandatory <b>Ed25519 + ML-DSA-65 hybrid</b>. Two independent seeds come from OS randomness; both signatures must verify for a governed apply:</p>
      <span class="f">P = k · B   (k = secret scalar, B = fixed base point)</span>
      <p>To forge you, an attacker must recover <b>k</b> from <b>P</b> — the elliptic-curve discrete-log problem. Best known attack (Pollard's rho) costs about:</p>
      <span class="f">√ℓ ≈ 2¹²⁶ operations   (ℓ ≈ 2²⁵² = curve order)</span>
      <p>That's more tries than there have been nanoseconds since the Big Bang — squared. The key file is written in one atomic, key-last step, so a crash can never leave half an identity.</p>
      <p class="note">There is no optional post-quantum fallback and no second identity. If either half is absent or invalid, authority refuses.</p></div></div></details>
   <details class="fact f-c"><summary class="fact-sum"><div class="fact-txt">
     <div class="fact-t">You get <b>seven words</b>. They are your <b>yes</b>.</div>
     <div class="fact-s">Nothing important happens unless your hand types them.</div></div></summary>
    <div class="fact-detail">
     <p>The words are not the key, and not a password to some account. They are the proof-of-<i>you</i> this machine asks for before anything real changes. You'll see them on the next screen — and learn a trick that makes seven words genuinely easy to keep.</p>
     <div class="fact-math"><div class="ml">how your words stay safe</div>
      <p>Your words never touch a disk. What's kept is a slow, one-way <b>scrypt</b> fingerprint — deliberately <b>memory-hard</b>:</p>
      <span class="f">scrypt(words, salt) · N=32768, r=8, p=1 → ~32 MB RAM per guess</span>
      <p>So a stolen file is a brute-force wall that costs real memory and time per attempt — not your words. Wrong guesses also trip a lockout that survives restarts.</p></div></div></details>
   <details class="fact f-r"><summary class="fact-sum"><div class="fact-txt">
     <div class="fact-t">You get a signed <b>birth certificate</b>.</div>
     <div class="fact-s">Your exact beginning — checkable forever.</div></div></summary>
    <div class="fact-detail">
     <p>The instant you bind, your node writes a receipt — "this identity began now" — and signs it with the brand-new key. A birth certificate that math, not trust, can verify.</p>
     <div class="fact-math"><div class="ml">the chain &amp; the world-clock</div>
      <p>The receipt is the first link of a signed hash chain — every future act chains onto it, so your history can be verified but never quietly rewritten:</p>
      <span class="f">hᵢ = SHA-256( hᵢ₋₁ ‖ event ‖ signature )</span>
      <p>When armed, it also folds in a round from <b>drand</b> — a public randomness beacon run by a global League of Entropy — checked against a pinned <b>BLS12-381</b> key by a pairing equation:</p>
      <span class="f">e( sig , g₂ ) = e( H(round) , pk )</span>
      <p>A birthday vouched for by a clock nobody owns.</p>
      <p class="note">Honest: drand proves "no earlier than time T" — it's a public beacon, not a proof-of-elapsed-time.</p></div></div></details>
   <details class="fact f-o"><summary class="fact-sum"><div class="fact-txt">
     <div class="fact-t">A living figure is born — your <b>AURA</b>. This is <b>you</b>.</div>
     <div class="fact-s">Grown from your identity. Same figure, every time.</div></div></summary>
    <div class="fact-detail">
     <p>When the ceremony finishes you'll watch it happen: a line becomes a triangle, then the five Platonic solids, then a sphere, then a knot wearing a wave. That's your <b>AURA</b> — a living portrait grown from your identity alone. It unlocks nothing and hides nothing; today it's a mirror.</p>
     <div class="fact-math"><div class="ml">why it's alien, not decoration</div>
      <p>Zero randomness at draw time. <b>SHA-256</b> of your public birth-fact seeds a deterministic generator, and the only thing it shapes is a family of <b>standing waves</b> rippling the surface of a <b>(2,3) trefoil knot</b> — the simplest curve that cannot be untied:</p>
      <span class="f">knot: x=sin t+2sin2t,  y=cos t−2cos2t,  z=−sin3t</span>
      <span class="f">skin: r(u,v)=r₀·(1+Σ Aᵢ·sin(kᵤu+φᵤ)·cos(kᵥv+φᵥ))</span>
      <p>Flip one bit of the seed → the whole being redraws differently. Keep it → any machine on Earth redraws <i>yours</i> point-for-point, 4,200 points, forever.</p>
      <p><b>Where this goes:</b> as your node lives, signs and grows, its AURA deepens — silver toward gold. One day it becomes your <b>offline ID</b>: hold it up and another node reads who you are with no server, no internet, no account. Like a QR code, but alive — and impossible to fake, because only your key could have grown it. <span class="note">(That future is designed, not built yet.)</span></p></div></div></details>
  </div>
  <div class="actions"><button id="begin" class="cta-wide">Begin the binding</button></div>
 </div>

 <div id="s-recover" class="step"><div class="emblem"><img class="trefoil genesis" src="/assets/aumara-icon.png" alt=""></div>
  <div class="genesis-cap"></div>
  <p class="lead">This node holds a <b>standing key</b> — but its lineage receipt is missing.<br>Prove your current phrase to restore it. Your key is never touched.</p>
  <div id="rec-rail" class="rail" role="group" aria-label="current phrase, word by word"></div>
  <div class="quiet" id="rec-hint">An older five- or six-word phrase? Leave the whole letter column empty and type your words in order.</div>
  <div class="actions"><button id="recbegin">Restore my lineage</button></div>
  <div id="recmsg" class="msg"></div>
 </div>

 <div id="s-view" class="step"><div class="emblem"><img class="trefoil genesis" src="/assets/aumara-icon.png" alt=""></div>
  <div class="genesis-cap"></div>
  <p class="lead">This node is <b>sovereign</b> — bound, and answering only to its owner's hand.<br>This view holds no form and asks for nothing.</p>
  <div class="actions"><button id="torotate">Rotate my phrase</button><a href="${SPATIAL_URL}" target="_top"><button class="ghost">return to your node</button></a></div>
  <div class="quiet">Rotation retires your current phrase and hands you a new one.<br>You will be asked to speak the current phrase first — deliberately, word by word.</div>
 </div>

 <div id="s-rotate0" class="step"><div class="emblem"><img class="trefoil genesis" src="/assets/aumara-icon.png" alt=""></div>
  <div class="genesis-cap"></div>
  <p class="lead">To retire your phrase and receive a new one, first speak the current one.</p>
  <div id="cur-rail" class="rail" role="group" aria-label="current phrase, word by word"></div>
  <div class="quiet" id="cur-hint">An older five- or six-word phrase? Leave the whole letter column empty and type your words in order.</div>
  <div class="actions"><button id="rotcancel" class="ghost">keep my current phrase</button><button id="rotbegin">It is mine — continue</button></div>
  <div id="rotmsg" class="msg"></div>
 </div>

 <div id="s-reveal" class="step"><div class="emblem"><img class="trefoil" src="/assets/aumara-icon.png" alt=""></div>
  <p class="lead">Meet your phrase — one <b>anchor</b>, then <b>six words</b>.</p>
  <div class="anchor-hero">
   <div class="anchor-hero-k">word zero · your anchor</div>
   <div id="anchor-hero-w" class="anchor-hero-w"></div>
   <div class="anchor-hero-s">This one word is the key to the other six.</div>
  </div>
  <div id="anchor-line" class="anchor-line" role="text" style="position:absolute;left:-9999px"></div>
  <div id="reveal-rail" class="rail" role="group" aria-label="your six words"></div>
  <div class="theme-intro">One more layer for remembering: each pair mirrors the Balinese <b>Tri Hita Karana</b> — the three harmonies of nature, people, and spirit.</div>
  <div class="theme-row">
   <div class="theme-box h-l"><div class="tl">Root</div><div class="td">nature &amp; health</div><div class="tp">Palemahan</div></div>
   <div class="theme-box"><div class="tl">Unite</div><div class="td">people &amp; relationship</div><div class="tp">Pawongan</div></div>
   <div class="theme-box h-r"><div class="tl">Rise</div><div class="td">purpose &amp; spirit</div><div class="tp">Parahyangan</div></div>
  </div>
  <div class="writedown">
   <div class="wk"><svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,193,122,0.98)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> WRITE THESE DOWN NOW</div>
   <div class="wv">You will not be shown these again.</div>
   <div class="ws">(you can refresh your phrase later, from your AUMLOK screen)</div>
  </div>
  <div class="actions"><button id="revcancel" class="ghost" style="display:none">keep my current phrase</button><button id="shuffle" class="ghost">shuffle again</button><button id="mine">I saved it — this one is mine</button></div>
  <div id="revmsg" class="msg"></div>
 </div>

 <div id="s-confirm" class="step"><div class="emblem"><img class="trefoil" src="/assets/aumara-icon.png" alt=""></div>
  <p class="lead">Type your phrase back.<br><span class="quiet">Typing — not pasting — is the deliberate act that binds you.</span></p>
  <div id="typed-rail" class="rail" role="group" aria-label="type your phrase back, word by word"></div>
  <div class="actions"><button id="back" class="ghost">show it once more</button><button id="bind">Bind me to this node</button></div>
  <div id="cmsg" class="msg"></div>
 </div>

 <div id="s-bound" class="step"><div class="emblem"><div id="echo" aria-hidden="true"></div><img id="bound-trefoil" class="trefoil genesis open" src="/assets/aumara-icon.png" alt=""></div>
  <canvas id="birth-canvas" aria-hidden="true"></canvas>
  <div id="birth-cap" class="birth-cap"></div>
  <p class="lead" id="boundlead">You are bound. Here is everything that just happened.</p>
  <div id="echo-prov" class="echo-prov"></div>
  <div id="bound-recap" class="facts">
   <details class="fact f-l"><summary class="fact-sum"><div class="fact-txt">
     <div class="fact-t">Your <b>secret key</b> was born here.</div>
     <div class="fact-s">Only this machine will ever hold it.</div></div></summary>
    <div class="fact-detail">
     <p>Your hybrid root's public fingerprint is <code id="keyline"></code> — safe to show anyone. Its independent Ed25519 and ML-DSA-65 private seeds are sealed in locked files here and shown to no one.</p></div></details>
   <details class="fact f-c"><summary class="fact-sum"><div class="fact-txt">
     <div class="fact-t">Your <b>seven words</b> now gate every change.</div>
     <div class="fact-s">Did you write them down? Nothing here can recover them.</div></div></summary>
    <div class="fact-detail">
     <p>The words were never stored — only their slow one-way scrypt fingerprint. From now on, anything important asks your hand to type them again. Keep the paper copy somewhere safe and private.</p></div></details>
   <details class="fact f-r"><summary class="fact-sum"><div class="fact-txt">
     <div class="fact-t">Your <b>birth certificate</b> is signed and saved.</div>
     <div class="fact-s">Your exact beginning, provable forever.</div></div></summary>
    <div class="fact-detail">
     <p>It says "this identity began now," signed by your new key — the first link of a chain every future act hangs from, so your history can be checked but never quietly rewritten.</p>
     <p id="anchor-truth" class="anchor-truth"></p></div></details>
   <details class="fact f-o"><summary class="fact-sum"><div class="fact-txt">
     <div class="fact-t">The figure born just now is <b>you</b> — your <b>AURA</b>.</div>
     <div class="fact-s">It lives in your AURA organ now, redrawn forever.</div></div></summary>
    <div class="fact-detail">
     <p>Your key is the identity. This figure is its <b>deterministic visual echo</b> — a repeatable portrait computed from public proof only. It never signs and never proves a person. The same figure now lives in your <b>AURA</b> organ, redrawn point-for-point every time you open it.</p>
     <p><b>Where it's headed:</b> as your node lives and signs, its AURA deepens — silver toward gold. One day you'll hold it up as an <b>offline ID</b> another node can read with no server and no internet — like a QR code, but alive and impossible to fake. <span class="fact-s" style="display:inline">(designed, not built yet).</span></p></div></details>
  </div>
  <div id="aftercare" class="aftercare">The vault on your AUMLOK screen is now open. This door closes itself — it never stands guard once you are bound.</div>
  <div class="actions"><a href="${SPATIAL_URL}?setup=openrouter" target="_top"><button>connect Auma</button></a></div>
 </div>
</div><script>
const $=(s)=>document.querySelector(s);
let nonce="", mode="bind";
/* content-free size report — the shell fits the ceremony frame to its content (no dead field).
   Height only; nothing about the phrase, the step, or the owner ever leaves this page. */
function postSize(){ if(window.self===window.top) return;
 window.parent.postMessage({type:"aumlok-bind-size",height:Math.ceil(document.body.scrollHeight)},"*"); }
if(window.ResizeObserver){ new ResizeObserver(postSize).observe(document.body); }
function show(id){ for(const s of document.querySelectorAll('.step')) s.classList.remove('on'); $(id).classList.add('on'); clearRails(); postSize(); }
function msg(sel,text,cls){ const m=$(sel); m.textContent=text||""; m.className="msg "+(cls||""); }
async function api(p,body){ const r=await fetch(p,{method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined}); return r.json(); }
/* the phrase rail — the acrostic's ORIGINAL composition (grammar-correction round): the six-letter
   anchor is a VERTICAL neutral spine — six stacked single-character tiles that concatenate, read
   downward, into word zero. The six themed words ride horizontally, one beside each letter, in
   three hue bands labelled once per pair (root/unite/rise). value() joins [anchor, word1..word6]
   keeping only nonempty tokens, so a legacy five/six-word phrase — the whole letter column left
   empty, the deliberate blank-anchor path — proves as typed; the kernel's normalizePhrase treats
   spaces and dashes alike. Values are never prefilled. */
const BANDS=[["l","root"],["c","unite"],["r","rise"]];
function railSkeleton(host){ /* three bands x two rows: [faint number] awaits its letter tile + word */
 host.textContent="";
 const rows=[];
 for(let b=0;b<3;b++){
  const band=document.createElement("div"); band.className="rail-band h-"+BANDS[b][0];
  const lab=document.createElement("span"); lab.className="rail-lab"; lab.textContent=BANDS[b][1];
  const pair=document.createElement("div"); pair.className="rail-pair";
  band.append(lab,pair); host.append(band);
  for(let r=0;r<2;r++){
   const row=document.createElement("div"); row.className="rail-row";
   const n=document.createElement("span"); n.className="rail-n"; n.textContent=String(rows.length+1);
   row.append(n); pair.append(row); rows.push(row);
  }
 }
 return rows;
}
function buildRail(hostSel,name,blockPaste,derivedAnchor){
 /* derivedAnchor (legacy-v1 rotation proof): the six word fields are the ONLY editable inputs; the
    vertical spine is a NON-EDITABLE live display of the entered initials — legacy bindings prove
    with the words alone, so the derived letters never join the serialized phrase. */
 const host=$(hostSel); const rows=railSkeleton(host);
 const chars=[]; const words=[];
 const refuse=(e)=>{ e.preventDefault(); msg("#cmsg","typing is the ceremony — pasting proves nothing","err"); };
 const mint=(cls,ph,aria)=>{ const inp=document.createElement("input");
  inp.type="text"; inp.className=cls; inp.placeholder=ph;
  inp.autocomplete="off"; inp.autocapitalize="none"; inp.spellcheck=false;
  inp.setAttribute("autocorrect","off"); // Safari: spellcheck=false alone does not stop autocorrect learning words
  inp.setAttribute("aria-label",aria); return inp; };
 const syncDerived=()=>{ if(!derivedAnchor) return;
  for(let c=0;c<6;c++) chars[c].textContent=(words[c].value.trim()[0]||""); };
 const spread=(toks,fromWord)=>{ /* a pasted multi-word phrase spreads over the composition (entry convenience only) */
  let k=0;
  if(fromWord<0){ const a=toks.length>6?toks[0]:""; /* seven tokens: first is the anchor, down the spine */
   for(let c=0;c<6;c++) chars[c].value=a.charAt?a.charAt(c):""; if(a) k=1; fromWord=0; }
  let last=null;
  for(let w=fromWord; w<6 && k<toks.length; w++,k++){ words[w].value=toks[k]; last=words[w]; }
  syncDerived();
  (last||words[5]).focus(); };
 for(let i=0;i<6;i++){
  if(derivedAnchor){ /* display tile only — never an input, never part of the proof */
   const ch=document.createElement("span"); ch.className="rail-ch derived";
   ch.setAttribute("aria-hidden","true"); chars.push(ch); continue;
  }
  const ch=mint("rail-ch","\\u00b7",name+" — anchor letter "+(i+1)+" of 6, read down");
  ch.maxLength=1;
  ch.addEventListener("input",()=>{ if(!ch.value) return; if(i<5) chars[i+1].focus(); else words[0].focus(); });
  ch.addEventListener("keydown",(e)=>{ if(e.key==="Backspace"&&!ch.value&&i>0){ e.preventDefault(); chars[i-1].focus(); } });
  if(blockPaste){ ch.addEventListener("paste",refuse); ch.addEventListener("drop",refuse); }
  else if(i===0){ ch.addEventListener("paste",(e)=>{ const t=(e.clipboardData?e.clipboardData.getData("text"):"")||"";
   const toks=t.trim().split(/[\\s_-]+/).filter(Boolean); if(toks.length<2) return; e.preventDefault(); spread(toks,-1); }); }
  chars.push(ch);
 }
 for(let i=0;i<6;i++){
  const inp=mint("rail-w","word "+(i+1),name+" — word "+(i+1));
  inp.addEventListener("keydown",(e)=>{
   if(e.key===" "||e.key==="Enter"){ e.preventDefault(); if(words[i+1]) words[i+1].focus(); return; }
   /* owner fix 2026-07-12: Tab from a WORD goes to the NEXT WORD, never back to the anchor column
      (the natural DOM order interleaves anchor letters between words and jumped focus backward). */
   if(e.key==="Tab" && !e.shiftKey && words[i+1]){ e.preventDefault(); words[i+1].focus(); }
   else if(e.key==="Tab" && e.shiftKey && i>0){ e.preventDefault(); words[i-1].focus(); }
  });
  if(derivedAnchor) inp.addEventListener("input",syncDerived);
  if(blockPaste){ inp.addEventListener("paste",refuse); inp.addEventListener("drop",refuse); } // drag-drop is paste by another door
  else { inp.addEventListener("paste",(e)=>{ const t=(e.clipboardData?e.clipboardData.getData("text"):"")||"";
   const toks=t.trim().split(/[\\s_-]+/).filter(Boolean); if(toks.length<2) return; e.preventDefault(); spread(toks,i); }); }
  words.push(inp);
 }
 rows.forEach((row,i)=>{ row.append(chars[i],words[i]); });
 return {
  chars, words,
  value(){ if(derivedAnchor) return words.map((x)=>x.value.trim()).filter(Boolean).join(" "); // words ONLY — the displayed initials never serialize
   const a=chars.map((x)=>x.value.trim()).join("");
   return [a].concat(words.map((x)=>x.value.trim())).filter(Boolean).join(" "); },
  clear(){ if(!derivedAnchor) for(const x of chars) x.value="";
   for(const x of words) x.value=""; syncDerived(); },
  focus(){ (derivedAnchor?words[0]:chars[0]).focus(); },
 };
}
let curRail=null, recRail=null; // built at boot, once the door has said which FORMAT this binding proves in
const typedRail=buildRail("#typed-rail","type-back",true); // typing is the ceremony — the type-back rail refuses paste (always seven-word-v2: new phrases are canonical)
function clearRails(){ if(curRail) curRail.clear(); typedRail.clear(); } // no INPUT rail value survives a step change (the reveal-rail + anchor are managed by renderReveal/completion)
function renderReveal(tokens){
 const host=$("#reveal-rail");
 const rows=railSkeleton(host);
 const letters=String(tokens[0]||"").split("");
 // the ephemeral anchor (#242): word zero shown explicitly — now in its OWN gold hero bar so it is
 // unmistakably THE anchor. Client-only, wiped on every step change (clearRails), never posted,
 // stored, or logged. The off-screen #anchor-line keeps 'ANCHOR · word' as an aria-text fallback.
 const hero=$("#anchor-hero-w"); if(hero) hero.textContent=String(tokens[0]||"");
 const al=$("#anchor-line"); al.textContent=""; al.append(document.createTextNode("ANCHOR · "));
 const b=document.createElement("b"); b.textContent=String(tokens[0]||""); al.append(b);
 for(let i=1;i<tokens.length&&i<=6;i++){
  const row=rows[i-1];
  const ch=document.createElement("span"); ch.className="rail-ch"; ch.textContent=letters[i-1]||"";
  const word=document.createElement("span"); word.className="rail-word"; word.textContent=tokens[i];
  row.append(ch,word);
 }
}
async function boot(){
 let st; try{ st=await api("/api/bind/status"); }catch(e){ $("#offline").style.display="block"; $("#offline").textContent="The binding door is not reachable."; postSize(); return; }
 if(!st.advisory){ $("#offline").style.display="block"; $("#offline").textContent="Capability mode is lockdown — the ceremony waits."; postSize(); return; }
 // the door tells its own page only the phrase FORMAT (legacy-v1 / seven-word-v2 / unrecognized);
 // legacy-v1 proof = six words alone, so the spine renders as a live display of initials, not entry
 const legacy=(st.phraseFormat==="legacy-v1");
 curRail=buildRail("#cur-rail","current phrase",false,legacy);
 recRail=buildRail("#rec-rail","current phrase",false,legacy); // #345 recovery proof — same grammar
 const curHint=legacy
  ?"Your standing phrase is six words — type them in order (an older five-word phrase: leave the last field empty). The letter column fills itself from first letters; it is display only. Legacy bindings prove with the words alone."
  :"An older five- or six-word phrase? Leave the whole letter column empty and type your words in order.";
 $("#cur-hint").textContent=curHint; $("#rec-hint").textContent=curHint;
 /* Peter's finding (2026-07-11): a direct visit must NEVER look like a login. Sovereign boot lands
    on the READ-ONLY bound view — trefoil, genesis caption, no form, no focus. The proof form exists
    only behind the explicit Rotate command; opening, canceling, or backing out mints nothing
    (candidates mint ONLY in the POST rotate proof — no GET route can create one).
    #345: a standing key WITHOUT a receipt is NEVER offered a fresh identity — it lands on the
    recovery step (prove the current phrase to restore the missing lineage). */
 if(st.posture==="sovereign"){ mode="rotate"; show("#s-view"); renderGenesisBase(); }
 else if(st.recoveryRequired){ mode="recover"; show("#s-recover"); renderGenesisBase(); }
 else { show("#s-arrive"); }
}
$("#recbegin").onclick=async()=>{
 let v; try{ v=await api("/api/bind/recover",{currentPhrase:recRail.value()}); }
 catch(e){ msg("#recmsg","the binding door is not answering — is it still up?","err"); return; }
 if(!v.ok){ msg("#recmsg", v.reason, "err"); return; }
 msg("#recmsg",""); mode="rotate"; show("#s-view"); renderGenesisBase(); // lineage restored → the standing view
};
$("#torotate").onclick=()=>{ show("#s-rotate0"); renderGenesisBase(); curRail.focus(); }; // the ONE deliberate entrance to the proof form
$("#rotcancel").onclick=()=>{ msg("#rotmsg",""); show("#s-view"); renderGenesisBase(); }; // no API call — nothing was minted, nothing to undo
/* candidate-lifecycle brick: AFTER a successful proof a rotation candidate exists — this cancel
   REVOKES it in the door process (the pre-commitment dies; the standing phrase keeps gating) and
   walks back to the read-only view. Rotate mode only: the first-binding flow has no standing
   phrase to keep. */
$("#revcancel").onclick=async()=>{
 /* FAIL CLOSED (Codex review, #333): the view must never imply a revocation that did not happen.
    We leave the reveal ONLY when the door explicitly proves ok:true AND candidateAlive:false —
    transport, gate, parse, and semantic failures all stay here with a plain retry message. */
 let v=null;
 try{ v=await api("/api/bind/cancel",{}); }catch(e){ v=null; }
 if(!v || v.ok!==true || v.candidateAlive!==false){
  msg("#revmsg","the cancel did not go through — the pending phrase may still be alive. Try again.","err");
  return;
 }
 msg("#revmsg",""); show("#s-view"); renderGenesisBase();
};
/* genesis base (#288, revised) — read-only reconstruction of the standing state. Fetched on load
   (and re-fetched after a successful bind, when the binding first exists). Mints nothing, asks for
   nothing; honest absence renders nothing. The deterministic params now drive only a SUBTLE
   trefoil treatment — opacity and glow, bounded renderer floats, never displayed, never a ring,
   no element created, no attribute exposed. Same node → same silver treatment, every refresh. */
/* #357 BIRTH SEQUENCE — first bind only. The one-time dimensional-emergence choreography plays on a
   full-stage Three.js canvas seeded ONLY by the public genesis reference (phrase-blind), then settles
   into the silver genesis base. Display only; grants nothing; never reads back into the ceremony.
   Fail-soft: if the renderer or genesis packet is unavailable, the static silver trefoil stands. */
let birthHandle=null;
async function startBirth(){
 try{
  const g=await api("/api/bind/genesis");
  const ref=(g&&g.present&&g.packet&&typeof g.packet.genesisRef==="string")?g.packet.genesisRef:null;
  if(!ref) return; // no public seed → keep the static trefoil, honestly
  const mod=await import("/assets/aura-birth.js");
  const c=$("#birth-canvas"); if(!c) return;
  $("#s-bound").classList.add("birthing");
  if(birthHandle&&birthHandle.dispose) birthHandle.dispose();
  const capEl=$("#birth-cap");
  birthHandle=mod.mountAuraBirth(c,{ seed:ref, mode:"birth", onCaption:(txt)=>{ if(capEl) capEl.textContent=txt||""; } });
 }catch(e){ /* renderer optional — the static silver trefoil is the honest fallback */ }
}
async function renderGenesisBase(){
 let g; try{ g=await api("/api/bind/genesis"); }catch(e){ return; }
 if(!g || !g.present || !g.base || g.base.state!=="silver") return;
 const r=g.base.rings;
 for(const t of document.querySelectorAll(".trefoil.genesis")){
  const bright=(1.04+r[0].radius*0.14).toFixed(3);          // bounded, deterministic silver lift
  const blur=Math.round(6+r[1].phase*8);                    // bounded, deterministic glow reach
  const glow=(0.16+r[2].weight*0.18).toFixed(3);            // bounded, deterministic glow strength
  t.style.filter="grayscale(1) brightness("+bright+") contrast(.94) drop-shadow(0 0 "+blur+"px rgba(226,232,240,"+glow+"))";
  t.style.opacity=(0.78+r[0].weight*0.16).toFixed(3);
 }
 /* owner ruling (#288 presentation pass): the ceremony surface speaks HUMAN — the named state only,
    no hexadecimal. The content-free genesis reference stays in the packet for receipt/history
    machinery; it is simply not ceremony text. */
 for(const cap of document.querySelectorAll(".genesis-cap")) cap.textContent="silver · genesis";
 postSize();
}
async function reveal(freshFromRotate){
 let v;
 try{ v = freshFromRotate ? freshFromRotate : await api("/api/bind/phrase",{}); }
 catch(e){ v = { ok:false, reason:"the binding door is not answering — is it still up?" }; }
 if(!v.ok){ // the banner is visible on EVERY step (a step-local msg element may be hidden right now)
  $("#offline").style.display="block"; $("#offline").textContent=v.reason; return; }
 $("#offline").style.display="none";
 nonce=v.nonce;
 // show ALL SEVEN words (anchor first, then the six themed words) — the full phrase to type back
 const seven=(v.tokens&&v.tokens.length)?v.tokens:(v.anchor?[v.anchor].concat(v.words||[]):(v.phrase||"").split("-"));
 $("#revcancel").style.display=(mode==="rotate")?"":"none"; // the owner's way back exists exactly where a standing phrase does
 renderReveal(seven); show("#s-reveal");
}
$("#begin").onclick=()=>reveal();
$("#shuffle").onclick=()=>reveal();
$("#mine").onclick=()=>{ msg("#cmsg",""); show("#s-confirm"); typedRail.focus(); };
$("#back").onclick=()=>show("#s-reveal");
$("#rotbegin").onclick=async()=>{
 let v; try{ v=await api("/api/bind/rotate",{currentPhrase:curRail.value()}); }
 catch(e){ msg("#rotmsg","the binding door is not answering — is it still up?","err"); return; }
 if(!v.ok){ msg("#rotmsg", v.reason, "err"); return; }
 msg("#rotmsg","");
 reveal(v);
};
$("#bind").onclick=async()=>{
 $("#bind").disabled=true;
 let v; try{ v=await api("/api/bind/complete",{phrase:typedRail.value(),nonce}); }
 catch(e){ msg("#cmsg","the binding door is not answering — is it still up?","err"); return; }
 finally{ $("#bind").disabled=false; }
 if(!v.ok){ msg("#cmsg", v.reason, "err"); if(v.ceremonyDead){ setTimeout(()=>reveal(),900); } return; }
 if(v.mode==="bind"){
  // your identity's SHORT fingerprint only — a human handle, not a wall of hex. This is the PUBLIC
  // half (safe to show; it's how others verify your signatures); the private key is never shown,
  // never sent, 0600 on this machine alone.
  // your identity's SHORT public fingerprint, set into the <code> inside the green recap detail
  const k=$("#keyline"); if(k) k.textContent=v.keyId;
  $("#bound-recap").style.display="";
 } else { $("#boundlead").innerHTML="Your phrase is retired.<br>The new one now gates your hand."; $("#keyline").textContent="";
  /* rotation is not a birth: the recap portals describe the FIRST bind (key born, figure born) —
     hiding them here keeps the screen honest; the aftercare line tells rotation's own truth */
  $("#bound-recap").style.display="none";
  $("#aftercare").textContent="Your rotation receipt was written. This door closes itself — it never stands guard."; }
 $("#reveal-rail").textContent=""; $("#anchor-line").textContent=""; { const h=$("#anchor-hero-w"); if(h) h.textContent=""; } // the shown words AND the ephemeral anchor (rail + hero) leave the page the moment the ceremony completes
 show("#s-bound");
 renderGenesisBase(); // bind: the base first exists; rotate: rebuilt IDENTICAL (rotation-stable) — the echo layers over it
 if(v.mode==="bind") startBirth(); // #357: FIRST bind only plays the one-time dimensional-emergence birth
 /* honest time-truth (#358 owner pass): drand is OPTIONAL, owner-armed, pinned-BLS verified, fail-soft.
    The echo carries a verified drand round ONLY when the beacon was armed+reachable+verified. Say the
    truth plainly either way — never overclaim a time anchor that was not taken. The future aging
    mechanism is unbuilt and is deliberately never surfaced on this page. */
 { const at=$("#anchor-truth"); const anchored=!!(v.echo&&v.echo.packet&&v.echo.packet.drand&&v.echo.packet.drand.round);
   if(at){ at.innerHTML=anchored
    ? "<b>Time anchor: verified.</b> A public world-clock round (drand) was folded in, so even the exact moment can be proven — not just claimed."
    : "<b>Time anchor: local only.</b> No public world-clock round was captured this time. Your birthday is still fully signed and valid — just not independently timestamped."; } }
 /* ceremony echo (#288) — display only, one-way. Renders ONLY when the door attached a validated
    content-free packet; a missing echo is honest absence (no error, no fallback visual). The ripple
    is aesthetic inference: the binding FACT is the receipt, named on the provenance line. */
 if(v.echo && v.echo.packet && v.echo.envelope && v.echo.envelope.state==="silver"){
  const env=v.echo.envelope, total=env.riseMs+env.sustainMs+env.settleMs;
  const echoEl=$("#echo"); echoEl.textContent="";
  for(let i=0;i<3;i++){
   const rip=document.createElement("div"); rip.className="echo-ripple";
   rip.style.animationDuration=(total/1000)+"s";
   rip.style.animationDelay=((env.phase[i]||0)*1.2)+"s"; // drand-seeded transient phase — public randomness only
   echoEl.append(rip);
  }
  const prov=$("#echo-prov"); prov.textContent=v.echo.provenance||"";
  prov.classList.add("on");
  setTimeout(()=>{ echoEl.textContent=""; prov.classList.remove("on"); postSize(); }, total+1400); // settle → the standing state returns
  postSize();
 }
};
boot();
</script></body></html>`;
