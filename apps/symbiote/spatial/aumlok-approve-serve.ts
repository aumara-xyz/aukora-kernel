// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * #105b — the device-local AUMLOK APPROVAL GATE. A SEPARATE loopback door (never the read-only spatial
 * observer, whose "no write lane, period" invariant stays intact) that turns the terminal signing ceremony
 * into a local UI gesture WITHOUT changing the trust root:
 *   - the owner's private key never enters the browser (read server-side, in this local process, only);
 *   - approval requires the owner to complete a proposal-bound challenge phrase (anti-CSRF + informed consent);
 *   - the server signs LOCALLY with the existing key path and dispatchSignedLiveApply RE-VERIFIES before write;
 *   - one proposal → one challenge → one signature → one receipt. No bulk. No standing unlock.
 *
 * ON BY DEFAULT since 2026-07-08 (owner directive: AUMLOK lives natively in the shell; previously opt-in
 * via =1): AUKORA_AUMLOK_UI_APPROVE=0 is the explicit off-switch. Arming changes availability, never
 * authority — every signature still needs key custody + advisory mode + the owner's typed phrase.
 * Loopback-only; POSTs are origin-guarded.
 * "The AI does not sign." This door only makes PETER's approval easier; the receipts still say his key signed.
 */
import { buildAumlokAssistantView } from '../core/src/aumlokSigningAssistant';
import { aumlokKeyStatus, approveAndApplyProposal } from '../core/src/aumlokApproveCeremony';
import { rejectPendingProposal } from '../core/src/aumlokRejectCeremony';
import { mintChallenge, verifyAndConsumeChallenge, sweepExpiredChallenges, type ChallengeStore } from '../core/src/aumlokApproveChallenge';
import { evaluateApprovalGate } from '../core/src/aumlokApproveGuard';
import { challengeStalenessGate } from '../core/src/stalenessCore';
// Downstream evidence only (issue #244): after a signed apply succeeds, the freshly-recorded
// signed_applied disposition is projected into governed memory, fire-and-forget — a projection
// refusal can never touch the apply or this door's response. Grants nothing; signs nothing.
import { projectSelfModOutcomesNow } from './selfModOutcomeCapture';
import { readCapabilityMode } from './capabilityMode';
import { capabilityModePath } from '../authority/symbiotePaths';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const PORT = Number(process.env.AUKORA_AUMLOK_APPROVE_PORT ?? 7094); // 7094: 7092 belongs to the Auma Live / KNVS voice sidecar
const SYMBIOTE_HOME = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote');
const REPO_ROOT = path.resolve(__dirname, '..');

// ── The signing PHRASE ceremony — RETIRED HERE (canonical-ceremony round, #242) ─────────────────
// This door once carried its own acrostic mint/confirm/refresh panel that could rewrite the phrase
// fingerprint WITHOUT proof of the current phrase — a second, weaker phrase system in conflict with
// the real bind ceremony. That surface is retired, not patched: the ONE bind/rotation ceremony now
// lives at the binding door (:7095, core/src/aumlokBindCeremony.ts) — old-phrase proof before a new
// phrase, typed confirmation, lockout, versioned memory-hard fingerprint, durable evidence. The
// acrostic generation (the owner's ROOT·UNITE·RISE design) moved to core/src/aumlokPhrase.ts and is
// minted by that ceremony. This door keeps ONLY a read-only status endpoint (the organ's crest) and
// tombstones for the old write routes. The per-proposal approval challenge below is UNTOUCHED.
function phraseFingerprintPath(): string { return path.join(SYMBIOTE_HOME, 'aumlok', 'phrase-fingerprint.json'); }
function phraseStatus(): { hasPhrase: boolean; rotations: number; updatedAt: string | null } {
  try {
    const f = JSON.parse(fs.readFileSync(phraseFingerprintPath(), 'utf-8'));
    // v1 (legacy salted-sha) and v2 (scrypt) both count as "a phrase stands" — read-only, never verifies.
    const hasPhrase = typeof f.sha256Hex === 'string' || typeof f.hashHex === 'string';
    return { hasPhrase, rotations: f.rotations ?? 0, updatedAt: f.updatedAt ?? null };
  } catch { return { hasPhrase: false, rotations: 0, updatedAt: null }; }
}
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
// A loopback door answers only to its own Host — closes DNS-rebinding structurally, not just via Origin.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const challenges: ChallengeStore = new Map();

// Owner directive 2026-07-08 ("AUMLOK lives natively in the shell"): the gate is ON by default on a
// node that runs it — AUKORA_AUMLOK_UI_APPROVE=0 is the explicit off-switch. Every signature still
// requires key custody + advisory mode + the owner's typed phrase; arming changes availability, never
// authority. (Previous posture was opt-in =1; flagged for Codex review as a deliberate flip.)
function enabled(): boolean { return process.env.AUKORA_AUMLOK_UI_APPROVE !== '0'; }
function advisory(): boolean { return readCapabilityMode(capabilityModePath()) === 'advisory'; }
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// The gate that must hold for EVERY authority-bearing endpoint (challenge + approve). Pure decision lives in
// aumlokApproveGuard so the CSRF perimeter is unit-testable; this only marshals request headers into it.
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

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    sweepExpiredChallenges(challenges, Date.now());

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return new Response(APPROVE_PAGE_HTML, { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        // Embeddable ONLY inside the spatial shell (so approval can live in the AUMLOK screen) or standalone.
        // Locks out clickjacking by any other page; the phrase step defeats framing attacks regardless.
        'content-security-policy': "frame-ancestors 'self' http://127.0.0.1:7090 http://localhost:7090",
      } });
    }

    // ── PHRASE ceremony surface — RETIRED (#242): the ONE ceremony lives at the binding door. ──
    if (req.method === 'GET' && p === '/phrase') {
      return new Response(PHRASE_MOVED_HTML, { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "frame-ancestors 'self' http://127.0.0.1:7090 http://localhost:7090",
      } });
    }
    if (req.method === 'GET' && p === '/api/phrase/status') {
      // Non-secret status (hasPhrase / rotations / updatedAt — never the phrase). CORS-open so the
      // AUMLOK organ on :7090 can render the compact crest cross-origin without embedding the whole
      // ceremony iframe. Read-only; exposes nothing a local page couldn't already probe.
      return new Response(JSON.stringify({ ok: true, ...phraseStatus() }), { headers: {
        'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*',
      } });
    }
    // The old free mint/confirm writers are GONE (410) — they could rewrite the binding fingerprint
    // without proof of the current phrase. Rotation now requires the typed current phrase at :7095.
    if (req.method === 'POST' && (p === '/api/phrase/mint' || p === '/api/phrase/confirm')) {
      return json({ ok: false, reason: 'retired: the phrase ceremony moved to the binding door (http://127.0.0.1:7095) — rotation requires the typed current phrase there', movedTo: 'http://127.0.0.1:7095/' }, 410);
    }

    // READ-ONLY: the real pending proposals + diffs + status + key presence (no key bytes).
    if (req.method === 'GET' && p === '/api/pending') {
      const view = buildAumlokAssistantView({ homeDir: SYMBIOTE_HOME, repoRoot: REPO_ROOT });
      const key = aumlokKeyStatus(SYMBIOTE_HOME);
      return json({ enabled: enabled(), advisory: advisory(), keyPresent: key.keyPresent, pending: view.pending, gameFindings: view.gameFindings, status: view.status, seatRecords: view.seatRecords });
    }

    // REJECT: explicit owner removal of one unsigned proposal. This is not an approval shortcut:
    // no challenge, key read, signature, or apply exists on this path.
    if (req.method === 'POST' && p === '/api/reject') {
      const g = gate(req); if (g) return g;
      const body = await readJson(req);
      const hash = typeof body.proposalHash === 'string' ? body.proposalHash : '';
      if (body.confirmation !== 'REJECT') return json({ ok: false, reason: 'type REJECT to archive this unsigned proposal' }, 400);
      const result = rejectPendingProposal(hash, { homeDir: SYMBIOTE_HOME });
      if (!result.ok) return json({ ok: false, reason: result.reason }, 400);
      return json({ ok: true, proposalHash: result.proposalHash, disposition: 'rejected', duplicate: result.duplicate });
    }

    // MINT a proposal-bound challenge phrase (owner will re-enter it).
    if (req.method === 'POST' && p === '/api/challenge') {
      const g = gate(req); if (g) return g;
      const body = await readJson(req);
      const hash = typeof body.proposalHash === 'string' ? body.proposalHash : '';
      if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, reason: 'invalid proposal hash' }, 400);
      if (!aumlokKeyStatus(SYMBIOTE_HOME).keyPresent) return json({ ok: false, reason: 'no signing key present — keygen in your terminal first' }, 409);
      // the proposal must actually be a valid pending artifact before we mint a challenge for it
      const view = buildAumlokAssistantView({ homeDir: SYMBIOTE_HOME, repoRoot: REPO_ROOT });
      const prop = view.pending.find((x) => x.proposalHash === hash && x.valid);
      if (!prop) return json({ ok: false, reason: 'no valid pending proposal for that hash' }, 404);
      // #183 staleness core: a STALE (or unknown-age) draft is live ammo — it cannot mint a
      // challenge unless the owner EXPLICITLY revives it in this same gesture (body.revive).
      // FLAGGED, never hidden: the refusal carries the full verdict (age included) for the page.
      const decision = challengeStalenessGate(prop.staleness, body.revive === true);
      if (!decision.allow) return json({ ok: false, reason: 'proposal_stale', staleness: decision.verdict }, 409);
      const c = mintChallenge(challenges, hash, Date.now());
      // return ONLY the phrase + expiry — never the nonce (it stays server-side and binds the signature)
      return json({ ok: true, proposalHash: hash, phrase: c.phrase, expiresAt: c.expiresAt, goal: prop.goal, staleness: prop.staleness, revived: decision.allow ? decision.revived : false });
    }

    // APPROVE: verify the owner's phrase, then sign+apply LOCALLY. Never returns key bytes.
    if (req.method === 'POST' && p === '/api/approve') {
      const g = gate(req); if (g) return g;
      const body = await readJson(req);
      const hash = typeof body.proposalHash === 'string' ? body.proposalHash : '';
      const phrase = typeof body.phrase === 'string' ? body.phrase : '';
      if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, reason: 'invalid proposal hash' }, 400);
      const verdict = verifyAndConsumeChallenge(challenges, hash, phrase, Date.now());
      if (!verdict.ok) return json({ ok: false, reason: `approval phrase ${verdict.reason}` }, 403);
      const result = approveAndApplyProposal(hash, verdict.nonce, { homeDir: SYMBIOTE_HOME, repoRoot: REPO_ROOT });
      if (!result.ok) return json({ ok: false, reason: result.reason }, 400);
      // The apply is real and the response is decided; project its closure into her governed
      // memory fire-and-forget (issue #244) — she recalls the outcome without the owner relaying it.
      void projectSelfModOutcomesNow();
      return json({
        ok: true,
        proposalHash: result.proposalHash,
        commitSha: result.commitSha,
        rollbackCommand: result.rollbackCommand,
        receiptHash: result.receiptHash,
        dispositionRecorded: result.dispositionRecorded,
        dispositionWarning: result.dispositionWarning,
      });
    }

    return json({ ok: false, reason: 'not found' }, 404);
  },
});

// eslint-disable-next-line no-console
console.log(`AUMLOK approval gate on http://127.0.0.1:${PORT}  ·  ${enabled() ? 'ARMED (default; AUKORA_AUMLOK_UI_APPROVE=0 disables)' : 'OFF (AUKORA_AUMLOK_UI_APPROVE=0 set)'}`);

// ── self-contained approve page (same-origin; no external assets) ─────────────────────────────────────────
const APPROVE_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AUMLOK — approval gate</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 /* Trinity design language — the same grammar as spatial/app/style.css (owner directive 2026-07-08:
    AUMLOK lives IN the shell; this page is framed inside the AUMLOK organ and must read as one skin).
    Hues per lane, low-alpha borders/glows, glass fills — never solid brand fills. */
 :root{--hue-l:129,212,180;--hue-c:150,180,255;--hue-r:196,170,255;--hue-o:255,180,110;
   --text:rgba(244,246,255,0.92);--dim:rgba(228,232,248,0.60);--faint:rgba(220,226,245,0.34);
   --glass:rgba(255,255,255,0.045);--glass-border:rgba(255,255,255,0.10);
   --add:rgba(var(--hue-l),0.95);--del:#ff9696;--accent:rgba(var(--hue-r),0.95);
   --ease:cubic-bezier(0.22,1,0.36,1)}
 /* standalone = the same soft trinity stage as the shell (never flat black); framed = the stage shows through */
 *{box-sizing:border-box} body{margin:0;min-height:100vh;color:var(--text);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif;
   background:
     radial-gradient(1200px 800px at 18% -10%, rgba(var(--hue-l),0.10), transparent 60%),
     radial-gradient(1100px 760px at 82% 110%, rgba(var(--hue-r),0.12), transparent 60%),
     radial-gradient(900px 700px at 50% 50%, rgba(var(--hue-c),0.07), transparent 65%),
     linear-gradient(160deg,#090a12 0%,#0b0d18 55%,#080910 100%)}
 body.framed{background:transparent} /* inside the shell's AUMLOK organ the stage shows through */
 .wrap{max-width:820px;margin:0 auto;padding:18px 16px 60px}
 body.framed .wrap{padding-top:4px}
 .title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.title-row h1{font-size:15px;letter-spacing:.2em;margin:0 0 2px;color:var(--text)} .tag{color:var(--dim);font-size:12px;margin-bottom:16px}
 body.framed h1,body.framed .tag{display:none} /* the organ already carries the AUMLOK crest */
 .banner{padding:10px 12px;border-radius:11px;margin-bottom:14px;font-size:12.5px;border:1px solid var(--glass-border);background:var(--glass)}
 .banner.off{color:#ffc38a;border-color:rgba(255,180,120,.35)} .banner.on{color:var(--add);border-color:rgba(var(--hue-l),0.3)}
 .card{border:1px solid var(--glass-border);border-radius:14px;padding:13px 15px;margin-bottom:12px;background:var(--glass);transition:border-color .25s var(--ease)}
 .card:hover{border-color:rgba(var(--hue-r),0.35)}
 .goal{font-weight:640;font-size:15px;color:var(--text);line-height:1.45} .meta{font-family:ui-monospace,monospace;font-size:10.5px;color:var(--faint);margin-top:3px}
 .risk{font-size:11px;color:var(--dim);margin-top:7px} pre{margin:9px 0 0;padding:9px 0;border-radius:10px;background:rgba(0,0,0,.28);border:1px solid var(--glass-border);overflow-x:auto;font:11px/1.5 ui-monospace,monospace}
 .dl{padding:0 12px;white-space:pre} .dl.add{color:var(--add);background:rgba(var(--hue-l),0.07)} .dl.del{color:var(--del);background:rgba(230,80,80,.08)} .dl.hh{color:var(--faint)} .dl.ctx{color:var(--dim)}
 /* telescoping portal buttons (#194) — rings extend as the portal opens toward you */
 button{position:relative;font:inherit;font-size:12.5px;letter-spacing:.05em;padding:10px 22px;border-radius:999px;cursor:pointer;color:var(--text);
   --pc:var(--hue-r);border:1px solid rgba(var(--pc),0.55);background:rgba(var(--pc),0.10);
   transition:background .25s var(--ease),box-shadow .25s var(--ease)}
 button::before,button::after{content:"";position:absolute;inset:-5px;border-radius:999px;border:1px solid rgba(var(--pc),0.30);
   opacity:0;transform:scale(.94);transition:opacity .3s var(--ease),transform .3s var(--ease);pointer-events:none}
 button::after{inset:-10px;border-color:rgba(var(--pc),0.16)}
 button:hover:not(:disabled){background:rgba(var(--pc),0.22);box-shadow:0 0 24px rgba(var(--pc),0.30)}
 button:hover:not(:disabled)::before,button:hover:not(:disabled)::after{opacity:1;transform:scale(1)}
 button:disabled{opacity:.4;cursor:not-allowed}
 button.p-green{--pc:var(--hue-l)} button.p-blue{--pc:var(--hue-c)} button.p-reject{--pc:255,110,110}
 input{font:inherit;padding:9px 14px;border-radius:999px;border:1px solid var(--glass-border);background:rgba(255,255,255,0.06);color:var(--text);width:260px;letter-spacing:.04em}
 /* the simple face: one row of soft chips; everything technical lives in the fold below */
 .chips{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:8px}
 .chip{font-size:10.5px;letter-spacing:.05em;padding:3px 10px;border-radius:999px;border:1px solid var(--glass-border);background:var(--glass);color:var(--dim)}
 .chip.warn{color:#ffc38a;border-color:rgba(255,180,120,.4);background:rgba(255,180,120,.07)}
 .chip.bad{color:#ff8a8a;border-color:rgba(255,90,90,.5);background:rgba(255,60,60,.08)}
 details.fold{margin-top:11px} details.fold>summary{list-style:none;cursor:pointer;font-size:11px;letter-spacing:.06em;color:var(--faint);
   display:inline-flex;align-items:center;gap:6px;padding:4px 2px;transition:color .2s var(--ease)}
 details.fold>summary:hover{color:var(--dim)} details.fold>summary::before{content:"▸";font-size:9px;transition:transform .25s var(--ease)}
 details.fold[open]>summary::before{transform:rotate(90deg)} details.fold>summary::-webkit-details-marker{display:none}
 /* TELESCOPING PORTAL BUTTONS (#194 — owner directive 2026-07-08): each waiting change collapses to one
    line; click to open the approval flow. Danger (invalid / file-shrink) glows red even collapsed. */
 details.portal-card{margin-bottom:10px;border:1px solid rgba(var(--hue-r),0.34);border-radius:14px;background:rgba(var(--hue-r),0.06);
   transition:border-color .25s var(--ease),box-shadow .25s var(--ease)}
 details.portal-card[open]{border-color:rgba(var(--hue-r),0.5);box-shadow:0 0 22px rgba(var(--hue-r),0.14)}
 details.portal-card.warn{border-color:rgba(255,90,90,.5);background:rgba(255,60,60,.06)}
 details.portal-card>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:11px;padding:13px 15px;border-radius:14px;transition:background .2s var(--ease)}
 details.portal-card>summary::-webkit-details-marker{display:none}
 details.portal-card>summary:hover{background:rgba(var(--hue-r),0.06)}
 .portal-dot{flex:none;width:9px;height:9px;border-radius:50%;background:rgba(var(--hue-r),0.95);box-shadow:0 0 10px rgba(var(--hue-r),0.7)}
 details.portal-card.warn .portal-dot{background:#ff8a8a;box-shadow:0 0 10px rgba(255,90,90,.7)}
 .portal-goal{flex:1;min-width:0;font-weight:600;font-size:14px;color:var(--text);line-height:1.35;
   overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
 .portal-pill{position:relative;flex:none;font-size:10.5px;letter-spacing:.06em;padding:5px 14px;border-radius:999px;
   border:1px solid rgba(var(--hue-r),0.55);background:rgba(var(--hue-r),0.14);color:var(--text);transition:all .25s var(--ease)}
 details.portal-card>summary:hover .portal-pill{background:rgba(var(--hue-r),0.24);box-shadow:0 0 18px rgba(var(--hue-r),0.3)}
 details.portal-card[open] .portal-pill{opacity:.45}
 .portal-pill.warn{border-color:rgba(255,90,90,.55);background:rgba(255,60,60,.12);color:#ffb0b0}
 .portal-body{padding:2px 15px 14px}
 :focus-visible{outline:2px solid rgba(125,211,252,0.7);outline-offset:2px}
 .phrase{font-family:ui-monospace,monospace;font-size:15px;color:var(--accent);letter-spacing:.08em;margin:8px 0}
 .row{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:10px} .result{margin-top:10px;font-size:12.5px}
 .result.ok{color:var(--add)} .result.err{color:var(--del)} code{font-family:ui-monospace,monospace;color:var(--dim)}
 .note{color:var(--faint);font-size:11.5px;margin-top:18px;line-height:1.7}
 .age{font-size:11px;color:#ffc38a;margin-top:7px}
 /* Fusion Council reading (#178 round 2) — golden council hue, same glass grammar. Display-only. */
 .council{margin-top:9px;padding:9px 11px;border-radius:11px;border:1px solid rgba(240,195,110,0.22);background:rgba(240,195,110,0.05)}
 .crow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
 .cverdict{font-family:ui-monospace,monospace;font-size:11px;font-weight:750;letter-spacing:.06em;padding:2px 9px;border-radius:999px;border:1px solid}
 .v-GREEN{color:var(--add);border-color:rgba(var(--hue-l),0.5);background:rgba(var(--hue-l),0.1)}
 .v-YELLOW{color:#ffc38a;border-color:rgba(255,180,120,.45);background:rgba(255,180,120,.09)}
 .v-RED{color:#ff8a8a;border-color:rgba(255,90,90,.5);background:rgba(255,60,60,.09)}
 .v-NO_QUORUM{color:var(--dim);border-color:var(--glass-border);background:var(--glass)}
 .cmeta{font-size:10.5px;color:var(--faint)}
 .cphase{font-size:11.5px;color:#ff8a8a;margin-top:6px}
 .cinsight{font-size:12px;color:var(--dim);margin-top:6px}
 .crec{font-size:11.5px;color:var(--faint);margin-top:3px}
 .cnone{font-size:11px;color:var(--faint);margin-top:9px}
 .ctrack{font-size:11.5px;color:rgba(240,195,110,0.85);margin-top:6px}
 .ctrack-quiet{font-size:10.5px;color:var(--faint);margin-top:6px}
 .crefused{margin-top:9px;padding:8px 11px;border-radius:11px;font-size:11.5px;color:#ff8a8a;border:1px solid rgba(255,90,90,.4);background:rgba(255,60,60,.06)}
 .game{margin-top:9px;padding:9px 11px;border-radius:11px;border:1px solid rgba(var(--hue-c),0.28);background:rgba(var(--hue-c),0.06)}
 .grow{font-size:11px;font-weight:700;letter-spacing:.04em;color:rgb(var(--hue-c))}
 .gmeta{font-size:10.5px;color:var(--faint);margin-top:5px;line-height:1.5}
 .gsec{margin-top:20px;padding-top:14px;border-top:1px solid var(--glass-border)}
 .gsec-h{font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--faint);margin-bottom:10px}
 .gcard{border:1px solid rgba(var(--hue-c),0.18);border-radius:12px;padding:11px 13px;margin-bottom:10px;background:rgba(var(--hue-c),0.03)}
 .shrink{margin-top:11px;padding:11px 13px;border-radius:12px;border:1px solid rgba(255,90,90,.5);background:rgba(255,60,60,.09)}
 .shrink-h{font-weight:750;color:#ff8a8a;font-size:13px;letter-spacing:.02em}
 .shrink-f{font-family:ui-monospace,monospace;font-size:12px;color:#ffd0d0;margin-top:5px}
 .shrink-n{font-size:11.5px;color:#ffb0b0;margin-top:8px;line-height:1.5}
 .ack{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:#ffd0d0;margin:12px 0 6px;cursor:pointer}
 .ack .ackbox{width:auto;flex:none;margin-top:2px}
</style></head><body><script>document.addEventListener('DOMContentLoaded',()=>{if(window.self!==window.top)document.body.classList.add('framed')});</script><div class="wrap">
 <div class="title-row"><div><h1>AUMLOK</h1><div class="tag">the approval gate — your key signs, locally, on your machine</div></div><button id="refresh-pending" class="p-blue" title="Reload pending proposals">Refresh</button></div>
 <div id="banner" class="banner">loading…</div><div id="list"></div>
 <div class="note">Your private key never enters this page — the local gate signs with it and re-verifies before applying. One proposal, one phrase, one signature. Nothing here can sign without you completing the phrase.</div>
</div><script>
const $=(s,r=document)=>r.querySelector(s); const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n};
function diff(pre,hunk){for(const l of String(hunk).split("\\n")){const c=l[0]==="+"?"add":l[0]==="-"?"del":l.startsWith("@@")?"hh":"ctx";pre.append(el("div","dl "+c,l))}}
function humanAge(ms){const m=ms/60000;if(m<90)return Math.max(1,Math.round(m))+"m";const h=m/60;if(h<24)return Math.round(h)+"h";const d=h/24;if(d<30)return Math.round(d)+"d";return Math.round(d/30)+"mo"}
async function load(){
 const refresh=$("#refresh-pending"); if(refresh){refresh.disabled=true;refresh.textContent="Refreshing…"}
 let v; try{const r=await fetch("/api/pending",{cache:"no-store"});v=await r.json()}catch{v={enabled:false,pending:[]};}
 if(refresh){refresh.disabled=false;refresh.textContent="Refresh"}
 const b=$("#banner");
 if(!v.enabled){b.className="banner off";b.textContent="Local approval is OFF (AUKORA_AUMLOK_UI_APPROVE=0 is set). Unset it and restart this gate. (Until then, sign in your terminal.)"}
 else if(!v.keyPresent){b.className="banner off";b.textContent="No signing key found. Create one in your terminal first (keygen), then reload."}
 else if(!v.advisory){b.className="banner off";b.textContent="Capability mode is lockdown — approval is disabled."}
 else {b.className="banner on";b.textContent="Armed · key present · ready for your approval. "+v.pending.filter(p=>p.valid).length+" proposal(s) waiting."}
 const list=$("#list"); list.innerHTML="";
 for(const p of v.pending){
  // THE SIMPLE FACE (owner directive 2026-07-08: "no code and shit — SUPER simple to approve"):
  // goal + soft chips + one portal button. Everything technical — hash, risk, diffs, council depth —
  // lives in the fold below, one tap away. Safety stays LOUD: shrink gate + invalid never fold.
  const files=(p.files||[]);
  const shrinks=files.filter(f=>f&&f.shrinkWarning);
  const danger=(!p.valid)||shrinks.length>0;
  // Each pending proposal is a TELESCOPING PORTAL BUTTON: collapsed it's one line — a glowing dot, the
  // goal, an "approve" pill — so ten waiting changes don't bury the screen. Click and it opens to the
  // approval flow. Danger (invalid / file-shrink) turns the whole portal RED even collapsed, so nothing
  // risky can hide behind a fold.
  const card=el("details","portal-card"+(danger?" warn":""));
  if(v.pending.length===1)card.open=true; // a single waiting change opens itself
  const head=el("summary");
  head.append(el("span","portal-dot"));
  head.append(el("div","portal-goal",p.goal));
  head.append(el("span","portal-pill"+(danger?" warn":""),!p.valid?"review":(shrinks.length?"review →":"approve →")));
  card.append(head);
  const body=el("div","portal-body"); card.append(body);
  const chips=el("div","chips"); body.append(chips);
  chips.append(el("span","chip",files.length+" file"+(files.length===1?"":"s")));
  const ca=p.councilAdvisory;
  if(ca&&ca.state==="present"){
   chips.append(el("span","cverdict v-"+ca.verdict,"council "+ca.verdict.replace("_"," ").toLowerCase()));
   if(ca.phaseLocked)chips.append(el("span","chip warn","phase-lock ⚠ weigh lightly"));
  } else if(ca&&ca.state==="refused"){
   chips.append(el("span","chip warn","council reading failed its integrity check — look closer"));
  } else {
   chips.append(el("span","chip","no council read yet"));
  }
  // The game's eyes (#178 round 5). When a pending proposal descends from an arc3 pulse work order, fuse
  // the game's own receipt onto the card being signed — so the owner sees EXACTLY what MK·PULSE saw when it
  // named the door. Matched by the door name appearing in the proposal goal; display-only, never gates.
  const gf=(v.gameFindings||[]).find(f=>f.receipt&&f.receipt.state==="present"&&p.goal&&p.goal.indexOf(f.receipt.door)>=0);
  if(gf){ const g=gf.receipt; const gb=el("div","game");
   gb.append(el("div","grow","◈ what the game saw"));
   gb.append(el("div","gmeta","MK·PULSE named the '"+g.door+"' door silent — probed "+g.url+" "+g.probes+" time(s), the mark included, at level "+g.level+" of run "+g.guid+". A read-only loopback finding · advisory only — never gates your decision."));
   card.append(gb);
  }
  if(p.createdAt){ const ms=Date.now()-new Date(p.createdAt).getTime(); if(ms>3600000)chips.append(el("span","chip warn","drafted "+humanAge(ms)+" ago — re-read before approving")); }
  if(!p.valid)chips.append(el("span","chip bad","INVALID — do not sign"));
  // THE loud one stays loud: exactly how a stale proposal truncates a file. Portal is red when collapsed;
  // this spells it out on open. Never hidden.
  if(shrinks.length){
   const sb=el("div","shrink");
   sb.append(el("div","shrink-h","⚠ This REMOVES lines from a file that already exists"));
   for(const f of shrinks){ sb.append(el("div","shrink-f",f.relPath+":  "+f.beforeLines+" → "+f.afterLines+" lines  (removes "+(f.beforeLines-f.afterLines)+")")); }
   sb.append(el("div","shrink-n","A small change should not shrink a file — this is the shape of a stale proposal rewinding it. Open the full change below before you approve."));
   body.append(sb);
  }
  if(v.enabled&&v.keyPresent&&v.advisory&&p.valid){
   const area=el("div"); body.append(area);
   const res=el("div","result");
   const ask=el("button",null,"Approve this");
   if(shrinks.length){
    const totalDel=shrinks.reduce((s,f)=>s+(f.beforeLines-f.afterLines),0);
    const ackWrap=el("label","ack"); const ack=el("input",null); ack.type="checkbox"; ack.className="ackbox";
    ackWrap.append(ack, el("span",null," I read the diff and I mean to remove "+totalDel+" line(s)."));
    area.append(ackWrap);
    ask.disabled=true; ack.onchange=()=>{ ask.disabled=!ack.checked; };
   }
   const arow=el("div","row"); arow.append(ask); area.append(arow); area.append(res);
   const reject=el("button","p-reject","Reject proposal"); arow.append(reject);
   reject.onclick=()=>{
    reject.disabled=true;
    const confirm=el("input");confirm.placeholder="type REJECT to archive";confirm.autocomplete="off";
    const goReject=el("button","p-reject","Archive unsigned proposal");const rejectRow=el("div","row");rejectRow.append(confirm,goReject);area.append(rejectRow);
    goReject.onclick=async()=>{goReject.disabled=true;
     const rr=await fetch("/api/reject",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({proposalHash:p.proposalHash,confirmation:confirm.value.trim()})}).then(r=>r.json());
     if(rr.ok){res.className="result ok";res.textContent="Rejected and archived. No signature was created.";setTimeout(load,350)}
     else{res.className="result err";res.textContent=rr.reason;goReject.disabled=false;}
    };
   };
   ask.onclick=async()=>{ ask.disabled=true;
    const cr=await fetch("/api/challenge",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({proposalHash:p.proposalHash})}).then(r=>r.json());
    if(!cr.ok&&cr.reason==="proposal_stale"){
     // #183: stale draft — FLAGGED with its age, never hidden; reviving is an explicit second gesture.
     res.className="result err";
     res.textContent="STALE DRAFT ("+((cr.staleness&&cr.staleness.ageLabel)||"age unknown")+") — this proposal passed its review-by horizon. Revive it only if you still mean it.";
     const revive=el("button",null,"Revive & continue");
     area.append(revive);
     revive.onclick=async()=>{ revive.remove();
      const rr=await fetch("/api/challenge",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({proposalHash:p.proposalHash,revive:true})}).then(r=>r.json());
      if(!rr.ok){res.textContent=rr.reason;ask.disabled=false;return}
      ask.remove();
      area.append(el("div",null,"Revived ("+((rr.staleness&&rr.staleness.ageLabel)||"")+"). To approve, type this phrase exactly:")); area.append(el("div","phrase",rr.phrase));
      const inp2=el("input"); inp2.placeholder="type the phrase"; inp2.autocomplete="off";
      const go2=el("button",null,"Sign & apply"); const row2=el("div","row"); row2.append(inp2,go2); area.append(row2);
      go2.onclick=async()=>{ go2.disabled=true;
       const ar2=await fetch("/api/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({proposalHash:p.proposalHash,phrase:inp2.value.trim()})}).then(r=>r.json());
       if(ar2.ok){res.className="result ok";res.innerHTML="Applied · commit <code>"+ar2.commitSha.slice(0,12)+"</code> · rollback: <code>"+ar2.rollbackCommand+"</code>";row2.remove()}
       else{res.className="result err";res.textContent=ar2.reason;go2.disabled=false}
      };
     };
     return}
    if(!cr.ok){res.className="result err";res.textContent=cr.reason;ask.disabled=false;return}
    ask.remove();
    area.append(el("div",null,"Type this phrase to say yes:")); area.append(el("div","phrase",cr.phrase));
    const inp=el("input"); inp.placeholder="type the phrase"; inp.autocomplete="off";
    const go=el("button","p-green","Sign & apply"); const row=el("div","row"); row.append(inp,go); area.append(row);
    inp.addEventListener("keydown",(e)=>{if(e.key==="Enter")go.click();});
    go.onclick=async()=>{ go.disabled=true;
     const ar=await fetch("/api/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({proposalHash:p.proposalHash,phrase:inp.value.trim()})}).then(r=>r.json());
     if(ar.ok){res.className="result ok";res.innerHTML="Applied ✓ commit <code>"+ar.commitSha.slice(0,12)+"</code> · rollback: <code>"+ar.rollbackCommand+"</code>";row.remove()}
     else{res.className="result err";res.textContent=ar.reason;go.disabled=false}
    };
   };
  }
  // the fold: full change — hash, risk, council depth, diffs. There if you want it, silent if not.
  const fold=el("details","fold"); const sum=el("summary",null,"open the full change — diff & details"); fold.append(sum);
  fold.append(el("div","meta","#"+p.proposalHash.slice(0,12)+" · authored by Auma"));
  if(p.riskHint)fold.append(el("div","risk",p.riskHint));
  if(ca&&ca.state==="present"){
   const box=el("div","council");
   const ageMs=Date.now()-new Date(ca.readAt).getTime();
   box.append(el("div","cmeta","Fusion Council · "+ca.councilCount+" mind(s) · votes G"+ca.votes.green+"/Y"+ca.votes.yellow+"/R"+ca.votes.red+"/N"+ca.votes.non+" · read "+humanAge(ageMs)+" ago · advisory only — never gates your decision"));
   if(ca.phaseLocked)box.append(el("div","cphase","⚠ phase-lock flagged — the minds converged suspiciously fast; weigh this reading lightly"));
   if(ca.insight)box.append(el("div","cinsight",ca.insight));
   for(const rec of (ca.recommendations||[]))box.append(el("div","crec","· "+rec));
   fold.append(box);
  } else if(ca&&ca.state==="refused"){
   fold.append(el("div","crefused","⚠ a council reading exists for this proposal but FAILED its integrity check ("+ca.reason+") — treat it as absent, and as a reason to look closer."));
  } else {
   fold.append(el("div","cnone","no council reading for this proposal — \\"run fusion review\\" in the workbench writes one"));
  }
  for(const pv of (p.preview||[])){ if(pv.refusedReason){fold.append(el("div","risk","preview withheld: "+pv.refusedReason));continue} if(!pv.hunk)continue; const pre=el("pre");diff(pre,pv.hunk);fold.append(pre); }
  body.append(fold);
  list.append(card);
 }
 // Game findings not yet fused onto a proposal card (the intent is drafted but has not been rehearsed
 // into a proposal yet). Shown so the owner sees the game's findings even before they become signable —
 // read-only, provenance + age visible, never a gate.
 const shownDoors=new Set((v.pending||[]).filter(p=>p.goal).flatMap(p=>(v.gameFindings||[]).filter(f=>f.receipt&&f.receipt.state==="present"&&p.goal.indexOf(f.receipt.door)>=0).map(f=>f.intentId)));
 const loose=(v.gameFindings||[]).filter(f=>!shownDoors.has(f.intentId));
 if(loose.length){
  const gsec=el("div","gsec"); gsec.append(el("div","gsec-h","◈ Game findings awaiting a proposal — MK·PULSE named these; none is signable until it becomes a rehearsed proposal"));
  for(const f of loose){ const c=el("div","gcard"); c.append(el("div","goal",f.goal));
   const rc=f.receipt;
   if(rc.state==="present"){ const ageMs=Date.now()-new Date(rc.readAt).getTime();
    c.append(el("div","gmeta","the '"+rc.door+"' door · probed "+rc.url+" "+rc.probes+" time(s) · level "+rc.level+" · run "+rc.guid+" · seen "+humanAge(ageMs)+" ago · advisory only")); }
   else if(rc.state==="refused"){ c.append(el("div","crefused","⚠ a game receipt exists but FAILED its integrity check ("+rc.reason+") — treat it as absent, look closer.")); }
   else { c.append(el("div","cnone","no structured receipt for this finding — the intent's rationale carries the prose record.")); }
   gsec.append(c);
  }
  list.append(gsec);
 }
}
$("#refresh-pending").onclick=load;
load();
</script></body></html>`;

// ── the phrase ceremony page (self-contained, same-origin, framed-aware) ──
// The owner's acrostic design: a 6-letter ANCHOR as a vertical spine, six words running horizontally
// off their letters — the first letters spell the anchor, top to bottom. Seven words in all. The
// reveal glows whole; the type-back starts dark and each letter LIGHTS as its word lands.
const PHRASE_MOVED_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AUMLOK — ceremony moved</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;background:#111520;color:rgba(244,246,255,.92);font:15px/1.7 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;min-height:60vh;text-align:center}
a{color:rgba(196,170,255,.95)} .quiet{color:rgba(228,232,248,.6);font-size:12.5px;max-width:460px;margin:10px auto 0}</style></head>
<body><div><div style="letter-spacing:.22em;font-size:15px;margin-bottom:10px">A U M L O K</div>
<p>The phrase ceremony now lives at the <a href="http://127.0.0.1:7095/">binding door</a>.</p>
<div class="quiet">One ceremony, one law: rotating your phrase requires typing the current one first — no free resets, ever. Your key and your standing phrase are unchanged.</div>
</div></body></html>`;
