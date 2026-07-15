// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Aukora Spatial — chat door. The governed workbench pipeline, served to the
 * trinity shell's chats lane.
 *
 * This is DELIBERATELY a separate process from spatial/serve.ts: that server
 * is the advisory read surface (GET-only, never writes). This one is the front
 * door to the governed loop, and a chat turn CAN write — through the engine's
 * own governed lanes only:
 *   - `propose patch` / `agent:` → ~/.aukora-symbiote/aumlok/pending-proposals/
 *     (awaiting the owner's Ed25519 signature) + advisory Kira memory capture
 *   - sandbox/test commands → temp dirs under os.tmpdir()
 *   - `apply signed proposal` → the ONE live write lane, gated by signature
 *     verification + replay ledger + sacred-path guard (nativeLiveApply.ts)
 * Everything else (help/status/map/list/read/search) is a pure read.
 *
 * The core loop is imported LAZILY on the first chat request (then cached), so
 * this server boots and reports honestly even if core/ is mid-edit by another
 * session. Restart this process to pick up new core/ code.
 *
 * Port 7091 (env AUKORA_SPATIAL_CHAT_PORT). Loopback only. CORS is restricted
 * to the spatial shell's own origin (7090).
 */

const PORT = Number(process.env.AUKORA_SPATIAL_CHAT_PORT ?? 7091);
const SHELL_PORT = Number(process.env.AUKORA_SPATIAL_PORT ?? 7090);
const SHELL_ORIGINS = new Set([
  `http://127.0.0.1:${SHELL_PORT}`,
  `http://localhost:${SHELL_PORT}`,
  // The preview lane (mesh note 2026-07-07: ":7090 held by another checkout — preview
  // lane :7098 works"). Same shell, same loopback box, different port — without this,
  // a :7098 tab gets a CORS-refused door and reads as "the chat door isn't running"
  // (observed on sam-mac, 2026-07-08).
  'http://127.0.0.1:7098',
  'http://localhost:7098',
]);
const LOCAL_POST_TOKEN = process.env.AUKORA_LOCAL_POST_TOKEN || '';

type LoopModule = {
  freshWorkbenchSession: () => unknown;
  runWorkbenchCommand: (input: string, session: unknown) => Promise<unknown[]>;
};

import { isLockdownCommand, engageLockdown, lockdownConfirmationEntries } from './capabilityMode';
import { recordCapabilityEvent } from '../core/src/flightRecorder';
import { checkLocalPostGuard } from '../core/src/localPostGuard';
import { capabilityModePath, flightRecorderDir } from '../authority/symbiotePaths';
import * as fs from 'fs';
import * as path from 'path';

let loop: LoopModule | null = null;
let session: unknown = null;
// The workbench loop was written as a single-driver REPL: concurrent commands
// on one session would clobber lastProposal/lastSandboxPath mid-await. All
// commands serialize through this chain.
let commandQueue: Promise<void> = Promise.resolve();

// Free-text handling, two tiers (issue #31, partial):
//   1. VOICE — a conversation model over OpenRouter (env AUKORA_CHAT_MODEL,
//      default anthropic/claude-fable-5). ADVISORY ONLY: the voice has no
//      tools and no authority; it cannot read/change files or apply anything.
//      Governed work still goes only through the grammar commands + signature.
//   2. FALLBACK — when no OpenRouter key resolves (or the call fails), the
//      original model-free Kira recall answers instead of a dead end.
// The voice lane's logic lives in ./voiceLane so it can be imported and unit
// tested without triggering this file's top-level Bun.serve side effect.
import type { ChatEntry, VoiceAttachment } from './voiceLane';
// sanitizeAttachments lives in voiceLane (issue #53 hardening) so its bounds + server-recomputed
// truncation are unit-testable; the door just calls it. Attachment content/filename are escaped in
// voiceLane.buildAttachmentFrames, never here.
import { VOICE_MODEL, VOICE_ROSTER, VOICE_MAX_IMAGES, VOICE_MAX_IMAGE_CHARS, liveRoster, voiceReply, kiraFallback, sanitizeAttachments, resetVoiceHistoryForRecovery } from './voiceLane';
// Fusion Council as a voice: free text with the fusion-council model id routes to a
// bounded two-wave council deliberation (all seats concurrent inside each wave)
// instead of a single-model call. Advisory only — the lane returns entries, touches nothing.
import { fusionReading, fusionCouncilNames, fusionCouncilDetail, FUSION_COUNCIL_ID } from './fusionReadingLane';
// AUMA · LIVE presence lane: streaming, abortable, tool-free sibling of the
// voice lane (same key; ephemeral ring, no Kira writes). Her MIND has three
// depths (deep=Fable / balanced=Kimi / quick=Llama) the owner switches live;
// the chat lane's VOICE_MODEL stays unchanged.
import { presenceStream, resetPresence, PRESENCE_MODEL, PRESENCE_MINDS, DEFAULT_MIND, resolvePresenceModel, resolvePresenceProvider } from './presenceLane';
// Governed shadow-capture of completed voice turns (env-gated, default OFF; fire-and-forget —
// a capture refusal can never touch the turn). Gate + glue live in ./shadowCapture.
import { captureCompletedTurn } from './shadowCapture';

function isUnrecognized(entries: unknown[]): boolean {
  const errs = (entries as ChatEntry[]).filter((e) => e?.kind === 'error');
  return errs.length > 0 && errs.every((e) => /unrecognized command/i.test(e.text ?? ''));
}

async function ensureLoop(): Promise<LoopModule> {
  if (!loop) {
    // Lazy import, cached after first success: a compile break in core/ fails
    // THIS request with an honest error instead of killing the server at boot.
    // Picking up new core/ code requires a restart (Bun caches the module).
    loop = (await import('../core/src/workbenchCommandLoop')) as unknown as LoopModule;
    session = loop.freshWorkbenchSession();
  }
  return loop;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = SHELL_ORIGINS.has(origin) ? origin : `http://127.0.0.1:${SHELL_PORT}`;
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type, x-aukora-csrf',
    vary: 'origin',
  };
}

function json(req: Request, value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) },
  });
}

// Auto-detecting one-shot translation for the Translate organ. Given the two
// languages of a live conversation, it detects which one the utterance is in and
// translates it into the OTHER — so two people just talk and it flows both ways
// with no manual direction switch. Deliberately the "quick" mind's fast-silicon
// route (llama on groq/cerebras) — a live conversation needs this to feel instant.
async function translateAuto(text: string, langA: string, langB: string): Promise<{ src: string; translation: string }> {
  const cfg = await import('../core/src/fusionConfig');
  const key = cfg.resolveApiKey()?.key;
  if (!key) throw new Error('no API key configured');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'x-title': 'Aukora Translate',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct',
      provider: { order: ['groq', 'cerebras', 'sambanova'], allow_fallbacks: true },
      max_tokens: 320,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `You are a fast live interpreter between exactly two languages: "${langA}" and "${langB}". Detect which of these two the message is in, then translate it into the OTHER one. Output EXACTLY: the detected source language name, then " ||| ", then ONLY the translation, and nothing else. Example: "${langA} ||| <the translation, written in ${langB}>". Preserve tone and register (casual stays casual). Write the translation in the target language's native script — no notes, no quotes, no romanization, no original text repeated.`,
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const out = data?.choices?.[0]?.message?.content;
  if (typeof out !== 'string' || !out.trim()) throw new Error('empty translation');
  const raw = out.trim();
  const idx = raw.indexOf('|||');
  if (idx >= 0) {
    return { src: raw.slice(0, idx).trim().replace(/^(SRC|SOURCE)[=:]\s*/i, ''), translation: raw.slice(idx + 3).trim() };
  }
  return { src: '', translation: raw };
}

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 240, // `agent:` and `run fusion review` do real network rounds
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(req, { ok: true, door: 'workbench', advisoryNote: 'chat proposes; only the AUMLOK signature applies' });
    }

    // ── Settings: the contributor node's OpenRouter API key (machine-local; NOT the AUMLOK signing key) ──
    // GET reports PRESENCE only (never any key bytes). POST saves a machine-local key file (0600, outside the
    // repo, never committed/synced); DELETE clears it. This lets a fresh node talk to Auma without a terminal,
    // and grants no authority — it is only the model API key the runtime already spends.
    if (url.pathname === '/api/settings/openrouter') {
      const cfg = await import('../core/src/fusionConfig');
      const keyFile = cfg.openrouterKeyFilePath();
      if (req.method === 'GET') {
        const resolved = cfg.resolveApiKey();
        // presence + source label + length ONLY — deliberately no key bytes (not even a masked suffix)
        return json(req, { present: !!resolved, source: resolved?.source ?? null, length: resolved?.key?.length ?? 0, savedInApp: fs.existsSync(keyFile) });
      }
      // state-changing routes reuse the exact local-CSRF posture of the billed lanes
      const guard = checkLocalPostGuard(req.headers, { allowedOrigins: [...SHELL_ORIGINS], allowNoBrowserOrigin: true, requiredToken: LOCAL_POST_TOKEN || undefined });
      if (!guard.ok) return json(req, { error: `local post rejected: ${guard.reason}` }, guard.status);
      if (req.method === 'POST') {
        let raw = '';
        try { const b = await req.json(); if (typeof b?.key === 'string') raw = b.key.trim(); } catch { return json(req, { error: 'body must be JSON { key: string }' }, 400); }
        // shape sanity only (no network check): a single-line token of a sane length + charset. Never echoed.
        if (!/^[A-Za-z0-9._-]{20,400}$/.test(raw)) return json(req, { error: 'that does not look like an OpenRouter key (expected a single token, ~20–400 chars). Nothing was saved.' }, 400);
        try {
          fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
          fs.writeFileSync(keyFile, raw + '\n', { mode: 0o600 });
          try { fs.chmodSync(keyFile, 0o600); } catch { /* Windows has no POSIX perms — writeFileSync mode is enough */ }
        } catch (e) { return json(req, { error: `could not save the key locally: ${e instanceof Error ? e.message : String(e)}` }, 500); }
        const active = cfg.resolveApiKey();
        if (!active || active.key !== raw) {
          try { fs.rmSync(keyFile, { force: true }); } catch { /* preserve the original refusal */ }
          return json(req, { error: 'the key file was written but did not become the active local key; nothing was kept' }, 500);
        }
        return json(req, { ok: true, present: true, savedInApp: true, source: active.source }); // never returns the key
      }
      if (req.method === 'DELETE') {
        try { if (fs.existsSync(keyFile)) fs.rmSync(keyFile); } catch { /* best-effort */ }
        return json(req, { ok: true, present: !!cfg.resolveApiKey(), savedInApp: false });
      }
      return json(req, { error: 'method not allowed' }, 405);
    }
    if (req.method === 'GET' && url.pathname === '/api/models') {
      // The voice switcher's menu: curated roster, live-enriched (vision +
      // $/MTok) from OpenRouter's catalog. Advisory metadata, read-only.
      // fusionCouncil: the RESOLVED requested council's names, so the deliberation
      // animation shows the real roster instead of a client-side guess.
      // fusionCouncilDetail: the same roster WITH slugs + source (default vs
      // AUKORA_FUSION_MODELS) + configured non-voting observers — honest metadata for
      // any surface that wants more than names. The reading itself additionally
      // reconciles requested seats against provider-SERVED identities per turn.
      return json(req, { default: VOICE_MODEL, models: await liveRoster(), fusionCouncil: fusionCouncilNames(), fusionCouncilDetail: fusionCouncilDetail() });
    }
    if (req.method === 'POST' && url.pathname === '/api/presence/stream') {
      // Same local-CSRF posture as /api/chat: this route spends the owner's key.
      const guard = checkLocalPostGuard(req.headers, {
        allowedOrigins: [...SHELL_ORIGINS],
        allowNoBrowserOrigin: true,
        requiredToken: LOCAL_POST_TOKEN || undefined,
      });
      if (!guard.ok) return json(req, { error: `local post rejected: ${guard.reason}` }, guard.status);
      let text = '';
      let reqModel = PRESENCE_MODEL;
      let reqMind = DEFAULT_MIND;
      try {
        const body = await req.json();
        if (typeof body?.text === 'string') text = body.text.slice(0, 4000);
        if (body?.reset === true) resetPresence();
        // HER MIND depth: 'deep' | 'balanced' | 'quick' → a curated model + route.
        // Constrained to the three minds (no arbitrary model strings on a billed lane).
        if (typeof body?.mind === 'string' && PRESENCE_MINDS[body.mind]) { reqMind = body.mind; reqModel = resolvePresenceModel(body.mind); }
        // legacy explicit model, still roster-constrained
        else if (typeof body?.model === 'string' && VOICE_ROSTER.some((m) => m.id === body.model)) reqModel = body.model;
      } catch {
        return json(req, { error: 'bad request: body must be JSON { text: string, mind?, reset? }' }, 400);
      }
      if (!text.trim()) return json(req, { error: 'text required' }, 400);
      // The kill switch works here too: a lockdown typed into the live channel is
      // decided deterministically (no model call), engages the real lockdown, and
      // streams a plain confirmation — parity with /api/chat (issue #55).
      if (isLockdownCommand(text)) {
        const now = new Date().toISOString();
        engageLockdown(capabilityModePath(), now);
        recordCapabilityEvent(flightRecorderDir(), { kind: 'mode_change', detail: 'owner lockdown → advisory-only (via presence)', meta: { since: now } }, now);
        const enc = new TextEncoder();
        const s = new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('data: ' + JSON.stringify({ t: 'tok', v: 'Lockdown engaged. Write tools are paused — I am advisory-only until you lift it in your terminal.' }) + '\n\n'));
            c.enqueue(enc.encode('data: ' + JSON.stringify({ t: 'done', reason: 'lockdown' }) + '\n\n'));
            c.close();
          },
        });
        return new Response(s, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...corsHeaders(req) } });
      }
      // ONE brain, every door: a HEARD spoken turn routes into the SAME governed shadow-capture
      // as typed chat. The lane fires the hook only under the ring's own discard law (a sub-2.5s
      // abort was never heard); we synthesize the exact voice-shaped entry pair
      // extractVoiceReplyText already validates, so every capture gate + content law is reused
      // verbatim. void = fire-and-forget: a capture refusal can never touch the live stream.
      const captureHeardTurn = (replyText: string) => {
        void captureCompletedTurn({
          ownerText: text,
          entries: [
            { kind: 'info', text: replyText },
            { kind: 'tool_result', tool: 'voice', text: `presence lane · mind=${reqMind}` },
          ],
          model: reqModel,
          origin: 'presence', // one mind, many doors — this row names its door (heard, not typed)
        });
      };
      const stream = await presenceStream(text, reqModel, req.signal, resolvePresenceProvider(reqMind), captureHeardTurn);
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          ...corsHeaders(req),
        },
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/translate') {
      // A stateless utility lane for the Translate organ: takes one utterance,
      // returns one translation. Same local-CSRF posture as the other billed
      // routes (spends the owner's key), but deliberately NOT part of the
      // governed workbench loop or Kira memory — a live conversation between
      // two people isn't a chat with Auma, and shouldn't be captured as one.
      const guard = checkLocalPostGuard(req.headers, {
        allowedOrigins: [...SHELL_ORIGINS],
        allowNoBrowserOrigin: true,
        requiredToken: LOCAL_POST_TOKEN || undefined,
      });
      if (!guard.ok) return json(req, { error: `local post rejected: ${guard.reason}` }, guard.status);
      let text = '';
      let langA = '';
      let langB = '';
      try {
        const body = await req.json();
        if (typeof body?.text === 'string') text = body.text.slice(0, 2000);
        if (typeof body?.langA === 'string') langA = body.langA.slice(0, 40);
        if (typeof body?.langB === 'string') langB = body.langB.slice(0, 40);
        // back-compat: an old { text, targetLang } client still one-way translates
        if (!langA && !langB && typeof body?.targetLang === 'string') { langA = 'the source language'; langB = body.targetLang.slice(0, 40); }
      } catch {
        return json(req, { error: 'bad request: body must be JSON { text, langA, langB }' }, 400);
      }
      if (!text.trim() || !langA.trim() || !langB.trim()) return json(req, { error: 'text, langA and langB required' }, 400);
      try {
        const { src, translation } = await translateAuto(text, langA, langB);
        return json(req, { src, translation });
      } catch (e) {
        return json(req, { error: 'translation failed: ' + (e instanceof Error ? e.message : String(e)) }, 502);
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      // Local-CSRF guard: CORS headers only gate response READING — a hostile
      // page on any origin could still fire blind POSTs at localhost and drive
      // the loop. Origin/Referer must be local; absent browser headers are
      // allowed for curl/local tools. If AUKORA_LOCAL_POST_TOKEN is set, the
      // matching x-aukora-csrf header is also required.
      const guard = checkLocalPostGuard(req.headers, {
        allowedOrigins: [...SHELL_ORIGINS],
        allowNoBrowserOrigin: true,
        requiredToken: LOCAL_POST_TOKEN || undefined,
      });
      if (!guard.ok) {
        return json(req, { entries: [{ kind: 'error', text: `local post rejected: ${guard.reason}` }] }, guard.status);
      }
      // Typed turn envelope (issue #53): owner_text is the owner's typed text ONLY; attachments arrive
      // in their own channel. Grammar and the lockdown intercept see owner_text — never attachment
      // content — so a file containing `--- file:` grammar or a forged frame can't inject. Legacy
      // { input } maps to owner_text (curl contract preserved; attachments empty).
      let ownerText = '';
      let reqModel = VOICE_MODEL;
      let images: string[] = [];
      let attachments: VoiceAttachment[] = [];
      try {
        const body = await req.json();
        if (typeof body?.owner_text === 'string') ownerText = body.owner_text;
        else if (typeof body?.input === 'string') ownerText = body.input; // legacy
        // Model must be in the curated roster — anything else falls back to
        // the default (no arbitrary model-string injection into billed calls).
        if (typeof body?.model === 'string' && VOICE_ROSTER.some((m) => m.id === body.model)) {
          reqModel = body.model;
        }
        if (Array.isArray(body?.images)) {
          images = body.images
            .filter((s: unknown): s is string => typeof s === 'string' && s.startsWith('data:image/') && s.length <= VOICE_MAX_IMAGE_CHARS)
            .slice(0, VOICE_MAX_IMAGES);
        }
        attachments = sanitizeAttachments(body?.attachments);
      } catch {
        return json(req, { entries: [{ kind: 'error', text: 'bad request: body must be JSON { owner_text: string, attachments?, images?, model? }' }] });
      }
      // Owner lockdown (issue #55): parsed HERE — after body-parse, BEFORE ensureLoop/grammar/network.
      // If this fell through to the grammar it would reach voiceReply — a billed model call
      // "interpreting" the kill switch. The door decides it deterministically, no model, no core import.
      // Operates on owner_text, so a lockdown in a file can't trigger it and a lockdown typed by the
      // owner still works on the new envelope shape exactly as on the legacy shape.
      if (isLockdownCommand(ownerText)) {
        const now = new Date().toISOString();
        engageLockdown(capabilityModePath(), now);
        // The flight recorder's first customer (issue #54): a mode-change is a capability event. This
        // is a safety DEMOTION, so a failed log never blocks the lockdown — it logs best-effort.
        recordCapabilityEvent(flightRecorderDir(), { kind: 'mode_change', detail: 'owner lockdown → advisory-only', meta: { since: now } }, now);
        return json(req, { entries: lockdownConfirmationEntries(now) });
      }
      try {
        const l = await ensureLoop();
        // Grammar sees owner_text ONLY — attachment content never reaches the workbench command parser.
        const run = commandQueue.then(() => l.runWorkbenchCommand(ownerText, session));
        commandQueue = run.then(() => undefined, () => undefined);
        let entries = await run;
        if (isUnrecognized(entries) && reqModel === FUSION_COUNCIL_ID) {
          // Fusion Council selected: the question goes to the glyph council, not a
          // single voice model. Grammar commands above are untouched (a typed
          // `run fusion review` still reviews the current proposal). The lane never
          // throws — every failure comes back as an honest entry. Text-only: the
          // council deliberates over owner_text; attachments/images are not sent.
          const reading = await fusionReading(ownerText);
          const notes: unknown[] = [];
          if (images.length || attachments.length) {
            notes.push({ kind: 'info', text: 'note: the Fusion Council reads your typed text only — attachments and images were not sent to the council.' });
          }
          return json(req, { entries: [...notes, ...reading] });
        }
        // A completed VOICE turn (voiceReply returned entries) is the one shape shadow-capture may
        // see — workbench/grammar turns keep their existing Kira-only capture, deliberately.
        let voicedTurn: unknown[] | null = null;
        if (isUnrecognized(entries)) {
          try {
            const voiced = await voiceReply(ownerText, reqModel, images, attachments);
            if (voiced) {
              entries = voiced as unknown[]; // conversation, not an error — drop the parse-error entry
              voicedTurn = entries;
            } else {
              entries = [entries[0], ...(await kiraFallback(ownerText))] as unknown[];
            }
          } catch (e) {
            const dropped = resetVoiceHistoryForRecovery();
            try {
              const recovered = await voiceReply(ownerText, reqModel, images, attachments);
              if (recovered) {
                entries = [
                  {
                    kind: 'tool_result',
                    tool: 'voice',
                    text: `voice recovered after resetting volatile history (${dropped} prior turn(s) dropped); first failure: ${String(e).slice(0, 160)}`,
                  },
                  ...recovered,
                ] as unknown[];
                voicedTurn = recovered as unknown[];
              } else {
                entries = [entries[0], ...(await kiraFallback(ownerText))] as unknown[];
              }
            } catch {
              try {
                entries = [entries[0], ...(await kiraFallback(ownerText))] as unknown[];
              } catch {
                /* recall unavailable — the loop's own error entry stands */
              }
            }
          }
        }
        // Shadow-capture AFTER the response entries are final, fire-and-forget: env-gated (default
        // OFF), lockdown-refused, every refusal surfaced by the module itself — never awaited, so
        // the HTTP response is never delayed or altered by capture in any way.
        if (voicedTurn) void captureCompletedTurn({ ownerText, entries: voicedTurn, model: reqModel, origin: 'chat' });
        return json(req, { entries });
      } catch (e) {
        return json(req, {
          entries: [{ kind: 'error', text: `the governed loop failed to load or run: ${String(e)}` }],
        });
      }
    }
    return new Response('not found', { status: 404, headers: corsHeaders(req) });
  },
});

console.log(`aukora spatial chat door — governed workbench loop at http://127.0.0.1:${PORT} (advisory: signature required for any live apply)`);
