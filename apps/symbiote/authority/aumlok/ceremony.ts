// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.70c/71 — THE AUMLOK CEREMONY (dev-grade phrase layer). Sets/replaces the AUMLOK approval hash and verifies it to
 * unlock a session. PRIVACY: the phrase is NEVER written to the keyfile and NEVER sent over HTTP — only its sha256 hash is
 * stored. A GENERATED phrase is DISPLAYED ONCE in the terminal so you can memorize it (it is not persisted). Entry is LOCAL
 * (the CLI hashes in-process; the phrase never crosses the network). The real authority root is the ML-DSA-65 ceremony
 * (Step 4); this is the documented dev shim until that mounts. Subcommands: generate · set · status · verify.
 *
 * 24Z.71 hardening (Codex): UNIFORM anchor selection (no best-of-N — that collapsed the anchor entropy and over-reported);
 * HONEST MIN-ENTROPY (the guaranteed floor for ANY generated phrase, not a per-draw or inflated figure); the CLI runs ONLY
 * as a main module (importing this file has NO side effects). Normalization (matches the historical unlock): lowercase →
 * trim → collapse whitespace → sha256 hex.
 */
import { createHash, randomInt } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { dirname } from 'path';
import { pathToFileURL } from 'url';
import { ANCHORS, POOL, USABLE_ANCHORS } from './wordlist';
import { aumlokKeyfilePath, aumlokSessionPath, aumlokSignerSocketPath, legacyAumlokKeyfilePath } from '../symbiotePaths';

// Fixed 2026-07-02 (issue #24 follow-up): this file (the ceremony — the session/keyfile WRITER) used
// to default to ~/.aukora/ directly, independent of opencodeAskBridge.ts (the READER), which Round 4
// moved to ~/.aukora-symbiote/. That split meant an owner unlock wrote a session the gate never read
// — the flow failed closed, but was silently dead. Both files now import the SAME resolver.
const KEYFILE = aumlokKeyfilePath();
const SESSION = aumlokSessionPath();
// Dev unlock window. Default 48h (unlock ~every other day); override with AUKORA_AUMLOK_TTL_MIN (e.g. 30 for a tighter window).
// NOTE: this only governs LOW-RISK write-capable tools — secrets / the gate's own code / high-risk are denied regardless.
const SESSION_MINUTES = Math.max(1, Math.min(Number(process.env.AUKORA_AUMLOK_TTL_MIN) || 2880, 10080)); // clamp 1 min … 7 days
const REFUSE_BELOW_BITS = 30; // a phrase weaker than this is refused (own-phrase) unless --force
const WARN_BELOW_BITS = 45;   // warn between the refuse-floor and this

const ANCHOR_SET = USABLE_ANCHORS.length ? USABLE_ANCHORS : ANCHORS;

function normalize(phrase: string): string { return phrase.toLowerCase().trim().replace(/\s+/g, ' '); }
function hashPhrase(phrase: string): string { return createHash('sha256').update(normalize(phrase)).digest('hex'); }
function nowIso(): string { try { return new Date().toISOString(); } catch { return '—'; } }

interface KeyFile { approvalKeyHash?: string; note?: string; createdFor?: string; mode?: string; entropyBitsEstimate?: number; setAt?: string; v?: string }
function readKey(): KeyFile { try { return JSON.parse(readFileSync(KEYFILE, 'utf-8')); } catch { return {}; } }
/** True iff the keyfile is still the shipped placeholder (note says "replace this hash") or has no hash. */
export function isPlaceholder(k: KeyFile = readKey()): boolean { return !k.approvalKeyHash || /replace this hash|placeholder/i.test(k.note || ''); }

// Issue #24 follow-up: if a real key was already minted under the OLD ~/.aukora/ default (before
// this fix), silently generating a fresh one here would orphan real authority material without ever
// telling the owner. Authority key material is never auto-moved — refuse loudly with the exact fix
// instead, matching the same discipline as Round 1's refuseIfOrphanedLegacyBrain.
function refuseIfOrphanedLegacyKey(): void {
  if (existsSync(KEYFILE)) return; // a real key already exists at the current path — nothing orphaned
  const legacy = legacyAumlokKeyfilePath();
  if (!existsSync(legacy)) return; // no legacy key either — this really is a fresh install
  process.stderr.write(
    `REFUSING TO GENERATE A NEW KEY:\n` +
    `  ${KEYFILE} does not exist, but a key was already minted at the old default path\n` +
    `  ${legacy}.\n` +
    `  Move it yourself, then re-run this command:\n` +
    `    mv ${legacy} ${KEYFILE}\n`,
  );
  process.exit(1);
}

function writeKey(hash: string, mode: 'generated' | 'own', bits: number): void {
  refuseIfOrphanedLegacyKey();
  mkdirSync(dirname(KEYFILE), { recursive: true });
  // No `note` field — the placeholder marker is GONE after a real set; no phrase is stored, only the hash.
  writeFileSync(KEYFILE, JSON.stringify({ approvalKeyHash: hash, createdFor: 'Peter', mode, entropyBitsEstimate: Math.round(bits), setAt: nowIso(), v: 'aumlok-ceremony-v1' }, null, 2));
  chmodSync(KEYFILE, 0o600); // owner-only: the keyfile holds the approval-phrase hash (24Z.71 deep-check)
}

// ── entropy (honest) ─────────────────────────────────────────────────────────
function anchorPoolBits(anchor: string): number { return [...anchor].reduce((s, ch) => s + Math.log2((POOL[ch] || []).length || 1), 0); }
/** GENERATOR MIN-ENTROPY = log2(#anchors) + MIN over anchors of Σlog2(pool). This is the guessing resistance GUARANTEED for
 *  ANY generated phrase (the most-likely output is the smallest-pool anchor) — the honest, non-inflated security figure. */
export function generatorMinEntropy(): number {
  const minAnchor = Math.min(...ANCHOR_SET.map(anchorPoolBits));
  return Math.log2(ANCHOR_SET.length) + minAnchor;
}
/** CONSERVATIVE estimate for an OWN phrase vs a modest-vocabulary attacker. NOT a guarantee — surfaced as an estimate.
 *  ~10 bits/word from a ~1000-word vocabulary, with penalties: repeats add ~0, short words capped low, and the acrostic
 *  structural correlation discounts the anchor (if it is the acronym of the rest, it carries ~no independent bits). */
export function ownBitsEstimate(phrase: string): { bits: number; words: number; notes: string[] } {
  const words = normalize(phrase).split(' ').filter(Boolean);
  const notes: string[] = [];
  const seen = new Set<string>();
  let bits = 0;
  for (const w of words) {
    if (seen.has(w)) { notes.push(`repeated word "${w}" adds ~0`); continue; }
    seen.add(w);
    bits += w.length < 4 ? 4 : Math.log2(1000);
  }
  if (words.length >= 2 && words[0].length === words.length - 1 && words[0] === words.slice(1).map((x) => x[0]).join('')) {
    bits -= Math.log2(1000); notes.push('anchor is the acronym of the rest → discounted (acrostic correlation)');
  }
  if (words.length < 7) notes.push(`only ${words.length} words (7 expected) — weaker`);
  return { bits: Math.max(0, bits), words: words.length, notes };
}
function band(bits: number): string { return bits < 22 ? 'VERY WEAK' : bits < 33 ? 'WEAK' : bits < 48 ? 'MODEST' : bits < 64 ? 'DECENT' : 'STRONG'; }
const HONEST = 'min-entropy vs a modest-vocabulary attacker — NOT "unguessable" (not claimed). The cryptographic root is the ML-DSA-65 ceremony (Step 4).';

// ── generation ────────────────────────────────────────────────────────────────
/** UNIFORM random acrostic — every anchor equally likely (NO best-of-N). Returns the phrase + the generator min-entropy
 *  (the guaranteed floor for ANY generated phrase — honest, not a per-draw figure). */
export function generate(): { phrase: string; bits: number } {
  const anchor = ANCHOR_SET[randomInt(ANCHOR_SET.length)];
  const rest = [...anchor].map((ch) => { const pool = POOL[ch] || [ch]; return pool[randomInt(pool.length)]; });
  return { phrase: [anchor, ...rest].join(' '), bits: generatorMinEntropy() };
}

function setOwn(phrase: string, force: boolean): number {
  const est = ownBitsEstimate(phrase);
  log(`  estimated entropy: ~${est.bits.toFixed(1)} bits (${band(est.bits)})`);
  for (const n of est.notes) log(`    · ${n}`);
  log(`  ${HONEST}`);
  if (est.bits < REFUSE_BELOW_BITS && !force) { log(`  REFUSED — below the ${REFUSE_BELOW_BITS}-bit floor. Choose a stronger phrase or run \`generate\` (or pass --force if you accept the risk).`); process.exit(1); }
  if (est.bits < REFUSE_BELOW_BITS && force) log(`  ⚠⚠ FORCED — binding a phrase at ~${est.bits.toFixed(1)} bits, BELOW the ${REFUSE_BELOW_BITS}-bit floor, at your explicit risk (--force).`);
  else if (est.bits < WARN_BELOW_BITS) log(`  ⚠ WARNING — weak phrase (below ${WARN_BELOW_BITS} bits). Recommended: \`generate\` a strong one.`);
  writeKey(hashPhrase(phrase), 'own', est.bits);
  return est.bits;
}

function log(s = ''): void { process.stdout.write(s + '\n'); }
function rule(): void { log('  ' + '─'.repeat(58)); }
function readStdin(): string { try { return readFileSync(0, 'utf-8'); } catch { return ''; } }

// ── CLI (runs ONLY as a main module — importing this file has NO side effects) ──
async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');
  switch (cmd) {
    case 'generate': {
      const { phrase, bits } = generate();
      const anchor = phrase.split(' ')[0];
      log(); rule();
      log('  🔮  THE AUMLOK CEREMONY  —  forging your bond'); rule();
      log('  You are binding yourself as her authority, inside her own IDE.');
      log('  These seven words are your incantation. They are shown ONCE and never written:');
      log();
      log(`        ✦  ${phrase}  ✦`);
      log();
      log(`  the anchor "${anchor}" — its six letters open the next six words.`);
      log(`  min-entropy: ~${bits.toFixed(1)} bits (${band(bits)}, ≥ the ${REFUSE_BELOW_BITS}-bit floor). ${HONEST}`);
      writeKey(hashPhrase(phrase), 'generated', bits);
      log();
      log('  ✦ the placeholder dissolves — the bond is forged. ✦  (only the sha256 was written; the phrase was not.)');
      log(`  wake her with:  open-aukora-ide.sh unlock`);
      rule(); break;
    }
    case 'set': {
      const phrase = normalize(readStdin());
      if (!phrase) { log('  no phrase on stdin (use the shell ceremony so it is masked + never echoed).'); process.exit(1); }
      log(); rule(); log('  🔮  THE AUMLOK CEREMONY  —  your own words'); rule();
      const bits = setOwn(phrase, force);
      log(`  ✦ the placeholder dissolves — the bond is forged (${band(bits)}). ✦  (only the sha256 was written.)`);
      rule(); break;
    }
    case 'status': {
      const k = readKey();
      const ph = isPlaceholder(k);
      log('🔑 AUMLOK ceremony — status');
      log(`  authority root : ${ph ? '⚠ PLACEHOLDER (shipped default — cast the ceremony to set YOUR phrase)' : 'configured (Peter-bound)'}`);
      if (!ph) log(`  mode           : ${k.mode || '?'} · entropy ~${k.entropyBitsEstimate ?? '?'} bits · set ${k.setAt || '?'}`);
      log(`  keyfile        : ${KEYFILE} (hash only — never the phrase)`);
      log(`  note           : dev-grade sha256 shim; the cryptographic root is the ML-DSA-65 ceremony (Step 4).`);
      process.exit(ph ? 2 : 0);
    }
    case 'verify': {
      const phrase = normalize(readStdin());
      const k = readKey();
      if (!k.approvalKeyHash) { log('  no AUMLOK hash set — cast the ceremony (generate/set) first.'); process.exit(1); }
      if (hashPhrase(phrase) === k.approvalKeyHash) {
        mkdirSync(dirname(SESSION), { recursive: true });
        writeFileSync(SESSION, JSON.stringify({ unlocked: true, expiresAt: Date.now() + SESSION_MINUTES * 60_000 }, null, 2));
        chmodSync(SESSION, 0o600); // owner-only: the session gates write-capable tool access (24Z.71 deep-check)
        const dur = SESSION_MINUTES >= 60 ? `${(SESSION_MINUTES / 60).toFixed(SESSION_MINUTES % 60 ? 1 : 0)}h` : `${SESSION_MINUTES} min`;
        log(`  ✦ she wakes — AUMLOK unlocked for ${dur}. ✦  (write-capable tools may pass the gate — low-risk only.)`);
        // 24Z.77 (residual D) — mint the daemon-co-signed unlock EPOCH. The signer authorizes MEMORY writes off this SIGNED
        // epoch (Ed25519), NOT the UID-writable session boolean, so a forged {"unlocked":true} can't authorize a write.
        // Best-effort: if the daemon isn't running, file-edits still unlock; memory writes fail-closed until it is.
        const sock = aumlokSignerSocketPath();
        const epochRes: any = await new Promise((resolve) => {
          let buf = ''; const t = setTimeout(() => resolve(null), 2500);
          try {
            // @ts-ignore — Bun.connect unix socket
            Bun.connect({ unix: sock, socket: {
              open(s: any) { s.write(JSON.stringify({ op: 'unlock', phrase, ttlMin: SESSION_MINUTES }) + '\n'); },
              data(s: any, d: any) { buf += d.toString('utf8'); if (buf.includes('\n')) { clearTimeout(t); let r: any = null; try { r = JSON.parse(buf.split('\n')[0]); } catch {} resolve(r); try { s.end(); } catch {} } },
              error() { clearTimeout(t); resolve(null); },
            } }).catch(() => { clearTimeout(t); resolve(null); });
          } catch { clearTimeout(t); resolve(null); }
        });
        if (epochRes && epochRes.ok) log('  ✦ signer epoch minted — memory writes are authorized this session. ✦');
        else log('  (signer daemon not reachable — memory writes fail-closed until `open-aukora-ide.sh serve` is running, then unlock again.)');
        process.exit(0);
      }
      log('  the words did not match — she stays sleeping (session locked).'); process.exit(1);
    }
    default:
      log('AUMLOK ceremony — usage: ceremony.ts <generate|set|status|verify>');
      log('  generate  → forge a strong acrostic, set its hash (recommended)');
      log('  set       → bind your own phrase (from stdin; strength-checked)');
      log('  status    → is the authority root configured or still the placeholder?');
      log('  verify    → hash a phrase (from stdin) + unlock a session if it matches');
  }
}

// run the CLI ONLY when this file is executed directly (compiles under CommonJS; false when imported).
const RUN_AS_CLI = !!process.argv[1] && /(^|[\/\\])ceremony\.[cm]?ts$|ceremony\.js$/.test(process.argv[1]);
if (RUN_AS_CLI) main().catch((e) => { console.error(String((e as Error)?.message ?? e)); process.exit(1); });
