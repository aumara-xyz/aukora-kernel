// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// The bind-ceremony VISUAL surface (grammar-correction round, 2026-07-10). The kernel, routes, CORS,
// and custody are pinned elsewhere (aumlokBindCeremony / aumlokCanonicalCeremony); THIS suite pins the
// presentation contract from the owner's reference: no raw black surface, a framed-compact layout
// whose height follows content, and the acrostic's ORIGINAL phrase composition — the six-letter
// anchor as a VERTICAL neutral spine (six stacked single-character tiles, read downward), six themed
// words horizontal beside it in three pair-labelled hue bands (root/unite/rise). Serialization stays
// [anchor-from-the-column, word1..word6] with only NONEMPTY tokens joining, so legacy five/six-word
// standing phrases still prove (the whole letter column left empty — the deliberate blank-anchor
// path) while new phrases remain seven words. Plus: rail values never stored, prefilled, or logged.
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import {
  freshBindStore, mintBindCandidate, beginPhraseRotation, completeCeremony, bindPosture, normalizePhrase,
  type BindStore,
} from '../src/aumlokBindCeremony';
import { generateKeypair } from '../src/aumlokSigner';

const door = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-bind-serve.ts'), 'utf-8');
const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'app', 'aumlok.js'), 'utf-8');
const onboarding = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'app', 'onboarding.js'), 'utf-8');

/** Exactly what the page's rail does: the anchor concatenates from the six letter cells (read down),
 *  then [anchor, word1..word6] keeps nonempty tokens and joins with single spaces. */
function railSerialize(anchorChars: string[], words: string[]): string {
  const anchor = anchorChars.map((c) => c.trim()).join('');
  return [anchor, ...words.map((w) => w.trim())].filter(Boolean).join(' ');
}
const EMPTY_COLUMN = ['', '', '', '', '', ''];

const T0 = Date.parse('2026-07-10T12:00:00.000Z');
let home: string;
let store: BindStore;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-bind-visual-'));
  store = freshBindStore();
});

function fpPath(): string { return path.join(home, 'aumlok', 'phrase-fingerprint.json'); }
/** A legacy v1 fingerprint exactly as the old writers persisted it (salted sha256, dash-normalized). */
// #361 Cycle A: a fresh ceremony bind is hybrid v2 now, and v2 nodes refuse phrase rotation until the
// lifecycle brick — so the legacy-rotation rows below stand up v1 KEY MATERIAL directly (the shape the
// old writer left), never a fresh ceremony bind.
function legacyKeyMaterial(): void {
  const dir = path.join(home, 'aumlok');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKeyHex, publicKeyHex } = generateKeypair();
  fs.writeFileSync(path.join(dir, 'authority-ed25519.key'), privateKeyHex, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'authority-ed25519.pub'), publicKeyHex);
}
function writeLegacyV1(phrase: string): void {
  const saltHex = randomBytes(16).toString('hex');
  const sha256Hex = createHash('sha256').update(saltHex + '|' + phrase, 'utf-8').digest('hex');
  fs.mkdirSync(path.join(home, 'aumlok'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(fpPath(), JSON.stringify({ schema: 'aumlok-phrase-fingerprint-v1', saltHex, sha256Hex, updatedAt: new Date(T0).toISOString(), rotations: 0 }, null, 2) + '\n', { mode: 0o600 });
}

describe('no raw black — Trinity tokens only', () => {
  it('the door page carries no #000 and no rgba(0,0,0,…) surface; inputs use the glass fill', () => {
    expect(door).not.toContain('#000');
    expect(door).not.toContain('rgba(0,0,0');
    expect(door).not.toContain('rgba(0, 0, 0');
    expect(door).toContain('--input-fill:rgba(255,255,255,0.06)');
    expect(door).toContain('background:var(--input-fill)');
  });

  it('framed mode zeroes the standalone min-height and tightens the wrap — no dead vertical field', () => {
    expect(door).toContain('body.framed{background:transparent;min-height:0;display:block}');
    expect(door).toContain('body.framed .wrap{padding:');
  });

  it('the page reports a content-free measured height so the shell frame fits the ceremony', () => {
    expect(door).toContain('aumlok-bind-size');
    expect(door).toContain('ResizeObserver');
    // the report is height only — nothing phrase-shaped rides along
    const postLine = door.slice(door.indexOf('function postSize'), door.indexOf('if(window.ResizeObserver'));
    expect(postLine).toContain('height:Math.ceil(document.body.scrollHeight)');
    expect(postLine).not.toContain('phrase');
    expect(postLine).not.toContain('value');
  });
});

describe('the acrostic phrase composition', () => {
  it('the anchor is a six-letter VERTICAL neutral spine — stacked single-character tiles, never a seventh word row', () => {
    expect(door).toContain('ch.maxLength=1'); // one letter per tile
    expect(door).toContain('"rail-ch"'); // the stacked letter cells
    expect(door).toContain('anchor letter '); // read-down aria on every cell
    expect(door).toContain('chars.map((x)=>x.value.trim()).join("")'); // the column CONCATENATES into word zero
    expect(door).not.toContain('placeholder=(i===0?"anchor"'); // the old horizontal anchor row is gone
    expect(door).toContain('"cur-rail"');
    expect(door).toContain('"typed-rail"');
    expect(door).toContain('"reveal-rail"');
  });

  it('six horizontal words in three hue bands — the section label once per PAIR (root green, unite blue, rise purple)', () => {
    expect(door).toContain('[["l","root"],["c","unite"],["r","rise"]]');
    expect(door).toContain('"rail-band h-"');
    expect(door).toContain('"rail-lab"');
    // the label renders once per band, not once per row: exactly one label append site
    expect(door.match(/rail-lab/g)!.length).toBeLessThanOrEqual(3); // css class + create + no per-row repeats
  });

  it('nonempty-only serialization of [anchor, words...] — the seam that keeps legacy five/six-word phrases alive', () => {
    expect(door).toContain('.filter(Boolean).join(" ")');
    expect(door).toContain('[a].concat(words.map((x)=>x.value.trim()))'); // anchor first, then the six words
  });

  it('the type-back rail still refuses paste — typing is the ceremony', () => {
    expect(door).toContain('pasting proves nothing');
  });

  it('rail values never persist: cleared on every step change, no storage APIs, reveal renders via textContent', () => {
    expect(door).toContain('clearRails()');
    // show() is the ONLY step-switcher and it clears both rails every time
    const showFn = door.slice(door.indexOf('function show(id)'), door.indexOf('function msg(sel'));
    expect(showFn).toContain('clearRails()');
    expect(door).not.toContain('localStorage');
    expect(door).not.toContain('sessionStorage');
    expect(door).not.toContain('document.cookie');
    // the revealed words land as textContent, never markup
    const revealFn = door.slice(door.indexOf('function renderReveal'), door.indexOf('async function boot'));
    expect(revealFn).toContain('word.textContent=tokens[i]');
    expect(revealFn).not.toContain('innerHTML');
  });
});

describe('rail serialization against the REAL kernel (not just string pins)', () => {
  it('a candidate typed letter-by-letter down the spine plus its six words binds — rail join === kernel canonical form', () => {
    const m = mintBindCandidate(store, home, T0);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.tokens[0]).toHaveLength(6); // the anchor fills the six-tile column exactly
    const typed = railSerialize(m.tokens[0].split(''), m.tokens.slice(1)); // the column + the six words
    expect(normalizePhrase(typed)).toBe(m.phrase);
    const done = completeCeremony(store, home, typed, m.nonce, T0 + 1000);
    expect(done.ok).toBe(true);
    expect(bindPosture(home)).toBe('sovereign');
  });

  it('a legacy SIX-word phrase with the whole letter column left EMPTY still proves for rotation', () => {
    legacyKeyMaterial();
    const legacySix = 'harbor-hazel-amber-raven-birch-ochre';
    writeLegacyV1(legacySix);
    const begin = beginPhraseRotation(store, home, railSerialize(EMPTY_COLUMN, legacySix.split('-')), T0 + 10_000);
    expect(begin.ok).toBe(true);
  });

  it('a legacy FIVE-word phrase — empty column, trailing word slot empty — still proves for rotation', () => {
    legacyKeyMaterial();
    const legacyFive = 'amber-bond-cedar-dance-elm';
    writeLegacyV1(legacyFive);
    const begin = beginPhraseRotation(store, home, railSerialize(EMPTY_COLUMN, [...legacyFive.split('-'), '']), T0 + 10_000);
    expect(begin.ok).toBe(true);
  });

  it('a skipped WORD cannot bind a seven-word candidate — new phrases remain all seven tokens', () => {
    const m = mintBindCandidate(store, home, T0);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const words = m.tokens.slice(1);
    words[2] = ''; // drop one themed word
    const done = completeCeremony(store, home, railSerialize(m.tokens[0].split(''), words), m.nonce, T0 + 1000);
    expect(done.ok).toBe(false);
    expect(bindPosture(home)).toBe('unbound');
  });

  it('LEGACY-V1 MODE: six-word entry proves; prepending the DERIVED anchor refuses (why the spine must be display-only)', () => {
    legacyKeyMaterial();
    const legacySix = 'harbor-hazel-amber-raven-birch-ochre';
    writeLegacyV1(legacySix);
    const words = legacySix.split('-');
    // Peter's live failure first, pinned forever: the visible initials joined on as a seventh
    // token MISMATCH a six-word v1 fingerprint — the exact trap the display-only spine removes
    const derivedAnchor = words.map((w) => w[0]).join('');
    expect(beginPhraseRotation(store, home, railSerialize(derivedAnchor.split(''), words), T0 + 10_000).ok).toBe(false);
    // then the repaired UI's serialization: WORDS ONLY — exactly what derived-anchor mode emits —
    // and one honest mistake must not have locked the owner out
    const wordsOnly = words.map((w) => w.trim()).filter(Boolean).join(' ');
    expect(beginPhraseRotation(store, home, wordsOnly, T0 + 20_000).ok).toBe(true);
  });

  it('a MISSING LETTER in the spine cannot bind — the anchor is typed, letter by letter, or not at all', () => {
    const m = mintBindCandidate(store, home, T0);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const chars = m.tokens[0].split('');
    chars[3] = ''; // one empty tile in the column → a five-letter non-anchor
    const done = completeCeremony(store, home, railSerialize(chars, m.tokens.slice(1)), m.nonce, T0 + 1000);
    expect(done.ok).toBe(false);
    expect(bindPosture(home)).toBe('unbound');
  });
});

describe('legacy-v1 migration UX (structural) — format without leakage, spine as display', () => {
  it('the door exposes only the phrase FORMAT enum to its own UI — never hashes, salts, or counts', () => {
    expect(door).toContain('phraseFormat');
    expect(door).toContain("'legacy-v1'");
    expect(door).toContain("'seven-word-v2'");
    expect(door).toContain("'unrecognized'");
    // the format function reads the schema STRING only and fails soft
    const fmtFn = door.slice(door.indexOf('function phraseFormat'), door.indexOf('function enabled'));
    expect(fmtFn).toContain("raw.schema === 'aumlok-phrase-fingerprint-v1'");
    expect(fmtFn).not.toContain('saltHex');
    expect(fmtFn).not.toContain('hashHex');
    expect(fmtFn).not.toContain('sha256Hex');
    // and the status payload never grew a secret-shaped field
    const statusLine = door.slice(door.indexOf("p === '/api/bind/status'"), door.indexOf("p === '/api/bind/phrase'"));
    for (const banned of ['saltHex', 'hashHex', 'sha256Hex', 'fingerprint', 'phraseText', 'wordCount']) {
      expect(statusLine).not.toContain(banned);
    }
  });

  it('legacy mode: the spine is a NON-EDITABLE derived display and the serialization is words only', () => {
    expect(door).toContain('"rail-ch derived"');
    expect(door).toContain('aria-hidden'); // the derived tiles are decoration to assistive tech
    expect(door).toContain('if(derivedAnchor) return words.map((x)=>x.value.trim()).filter(Boolean).join(" ")');
    expect(door).toContain('prove with the words alone'); // the explicit legacy copy
    expect(door).toContain('st.phraseFormat==="legacy-v1"'); // UI mode follows the door, nothing else
  });
});

describe('the presentation pass (owner ruling, #288 final): trefoil-only, one gold, human caption', () => {
  it('the trefoil is the SOLE standing emblem — every step carries it, no generic circle anywhere', () => {
    for (const id of ['s-arrive', 's-rotate0', 's-reveal', 's-confirm', 's-bound']) {
      const start = door.indexOf(`id="${id}"`);
      const step = door.slice(start, door.indexOf('<p class="lead"', start));
      expect(step).toContain('class="trefoil');
    }
    expect(door).not.toContain('class="ring'); // the generic standing circle is gone from the markup
    expect(door).not.toContain('.ring{'); // and its rule is gone from the stylesheet
  });

  it('the amber completion halo stays a single deliberate mark; GOLD (the user/AURA) is its own warmer tone', () => {
    // The static completion halo keeps amber 255,180,110 — used ONCE, exactly where completion lives.
    expect(door.match(/255,180,110/g)!.length).toBe(1);
    const rule = door.slice(door.indexOf('#s-bound .emblem::after'), door.indexOf('pointer-events:none}', door.indexOf('#s-bound .emblem::after')) + 20);
    expect(rule).toContain('255,180,110'); // the success-step halo
    expect(rule).not.toContain('animation'); // static by construction
    // GOLD (owner: "the user is the gold") is a distinct warmer tone carrying the AURA fact, the
    // anchor hero, and the write-it-down slap — deliberate, not scattered noise.
    expect(door).toContain('details.fact.f-o{--fc:255,193,122}');
    expect(door.match(/255,193,122/g)!.length).toBeGreaterThanOrEqual(3); // f-o fact + anchor-hero + writedown
  });

  it('the standing caption speaks human — the named state, never the hexadecimal reference', () => {
    expect(door).toContain('cap.textContent="silver · genesis"');
    expect(door).not.toContain('cap.textContent=g.caption'); // the ref stays machinery, not ceremony text
  });

  it('the compact copy names word zero, the vertical initials, and the three pair meanings', () => {
    expect(door).toContain('word zero');
    expect(door).toContain('nature &amp; health');
    expect(door).toContain('people &amp; relationship');
    expect(door).toContain('purpose &amp; spirit');
  });

  it('band treatment is trinity-native: hued rest borders and the trinity focus ring, no foreign blue', () => {
    expect(door).toContain('border:1px solid rgba(var(--tc),0.2)'); // word inputs whisper their band hue at rest
    expect(door).toContain(':focus-visible{outline:2px solid rgba(var(--hue-c),0.7)');
    expect(door).not.toContain('rgba(125,211,252'); // the foreign light blue is gone
  });
});

describe('the identity loop (Peter finding, 2026-07-11): read-only view first, rotate only on command', () => {
  it('sovereign boot lands on the READ-ONLY bound view — never the proof form, never a focused input', () => {
    const bootFn = door.slice(door.indexOf('async function boot'), door.indexOf('$("#torotate")'));
    expect(bootFn).toContain('show("#s-view")');
    expect(bootFn).not.toContain('show("#s-rotate0")'); // the form is never the landing
    expect(bootFn).not.toContain('curRail.focus()'); // and nothing grabs the keyboard on arrival
    const view = door.slice(door.indexOf('id="s-view"'), door.indexOf('id="s-rotate0"'));
    expect(view).toContain('class="trefoil genesis'); // the standing emblem + genesis base
    expect(view).not.toContain('<input'); // a view, not a form
    expect(view).toContain('Rotate my phrase'); // the ONE explicit command
  });

  it('no GET route can mint: candidates exist only behind the POST proof', () => {
    const getRoutes = door.slice(door.indexOf("req.method === 'GET'"), door.indexOf("req.method === 'POST'"));
    expect(getRoutes).not.toContain('mintBindCandidate');
    expect(getRoutes).not.toContain('beginPhraseRotation');
  });

  it('the proof form opens ONLY from the explicit command, and PRE-PROOF cancel calls nothing', () => {
    expect(door).toContain('$("#torotate").onclick=()=>{ show("#s-rotate0")');
    // slice exactly the #rotcancel handler: before a proof nothing is minted, so its cancel must
    // talk to no endpoint. (The POST-proof cancel is different by design — it REVOKES a live
    // candidate via /api/bind/cancel; the lifecycle suite pins that one.)
    const start = door.indexOf('$("#rotcancel").onclick');
    const cancel = door.slice(start, door.indexOf('\n', start));
    expect(cancel).toContain('show("#s-view")');
    expect(cancel).not.toContain('api('); // pre-proof cancel talks to no endpoint — nothing was minted
  });

  it('the shell overview footprint is read-only and content-free: named state, honest absence, nothing else', () => {
    // sweep the CODE (from the fetch to the catch) — the comment above it may NAME the banned
    // material while promising never to read it
    const bridge = shell.slice(shell.indexOf("fetch(BIND_URL + '/api/bind/genesis')"), shell.indexOf('} catch { /* honest absence */ }'));
    expect(bridge).toContain("'/api/bind/genesis'");
    expect(bridge).toContain("'silver · genesis'"); // the named state, a literal — never computed
    expect(bridge).toContain("g.base.state === 'silver'");
    expect(bridge).toContain("'/assets/aumara-icon-96.png'"); // the shell's OWN trefoil asset
    for (const banned of ['fingerprint', 'salt', 'kdf', 'rootId', 'genesisRef', 'caption', 'packet']) {
      expect(bridge).not.toContain(banned); // no packet field beyond present/base.state is even read
    }
    expect(shell).toContain('/* honest absence */'); // failure renders nothing, errors nothing
  });
});

describe('the owner-led visual finish (2026-07-11): trefoil everywhere, shelf, trinity wordmark, balanced copy', () => {
  it('the onboarding emblem is the TREFOIL — the generic gradient orb and its orbiting ring are gone', () => {
    expect(onboarding).toContain("'/assets/aumara-icon.png'"); // the brand mark, the shell's own asset
    expect(onboarding).not.toContain('onb-orb-ring'); // the orbiting circle is dead, rule and element
    expect(onboarding).not.toContain('radial-gradient(circle at 38% 32%'); // the gradient-ball core is dead
    // reduced motion keeps the silver treatment rather than stripping to a raw full-color mark
    expect(onboarding).toContain('.onb-orb-core, .onb-orb.resolving .onb-orb-core { animation:none');
  });

  it('standalone is a FULL-STAGE composition (vertically centred, lighter substrate); framed dissolves the shelf', () => {
    // the body is a centred stage, not a card pinned to the top of a dark void (#242)
    const bodyRule = door.slice(door.indexOf(' body{margin:0'), door.indexOf('body.framed{'));
    expect(bodyRule).toContain('justify-content:center');
    expect(bodyRule).toContain('align-items:center');
    // lighter gray-blue substrate (not near-black): the base linear-gradient starts at #14..
    expect(bodyRule).toMatch(/linear-gradient\(160deg,#14/);
    // framed dissolves entirely — no nested shelf
    const framedRule = door.slice(door.indexOf('body.framed .wrap{'), door.indexOf('/* the wordmark'));
    expect(framedRule).toContain('background:transparent');
    expect(framedRule).toContain('border:0');
    // reduced-motion + silver genesis paths untouched by the restyle
    expect(door).toContain('@media (prefers-reduced-motion: reduce){.step.on{animation:none}.trefoil{animation:none}}');
  });

  it('the ephemeral ANCHOR is shown in its own gold hero (plus an off-screen aria line) and wiped with the reveal', () => {
    // word zero renders into the gold hero bar; the off-screen #anchor-line stays as an aria fallback.
    // Both are client-only, never posted/stored.
    expect(door).toContain('id="anchor-hero-w"');
    expect(door).toContain('id="anchor-line"');
    const rr = door.slice(door.indexOf('function renderReveal'), door.indexOf('async function boot'));
    expect(rr).toContain('hero.textContent=String(tokens[0]||"")'); // the visible anchor is the hero
    expect(rr).toContain('ANCHOR · '); // the aria fallback still names it
    // it leaves the page exactly when the words do (completion) and never rides a postMessage
    expect(door).toContain('const h=$("#anchor-hero-w"); if(h) h.textContent="";');
    const postLine = door.slice(door.indexOf('function postSize'), door.indexOf('if(window.ResizeObserver'));
    expect(postLine).not.toContain('anchor');
  });

  it('each Root/Unite/Rise band carries a real semantic hue treatment; the RUR label is HORIZONTAL and the anchor tiles are GOLD (owner round 4)', () => {
    const band = door.slice(door.indexOf('.rail-band{'), door.indexOf('.rail-band.h-l'));
    expect(band).toContain('border-left:3px solid rgba(var(--tc),0.6)'); // per-pair hue accent rail
    // the label is no longer vertical writing-mode — it reads horizontally, bigger
    const lab = door.slice(door.indexOf('.rail-lab{'), door.indexOf('.rail-pair{'));
    expect(lab).not.toContain('writing-mode:vertical-rl');
    expect(lab).toContain('font-size:12.5px;font-weight:750');
    // the anchor letter tiles are GOLD + uppercase (owner order 2026-07-12)
    const ch = door.slice(door.indexOf('.rail-ch{'), door.indexOf('input.rail-ch::placeholder'));
    expect(ch).toContain('--ac:255,193,122');
    expect(ch).toContain('text-transform:uppercase');
    expect(door.match(/255,180,110/g)!.length).toBe(1); // amber completion halo — a single deliberate mark (gold is 255,193,122)
  });

  it('the wordmark wears the trinity gradient — never dim generic text', () => {
    const h1Start = door.indexOf('h1{font-size');
    const h1 = door.slice(h1Start, door.indexOf('.tag{', h1Start));
    expect(h1).toContain('background-clip:text');
    expect(h1).toContain('rgba(var(--hue-l)');
    expect(h1).toContain('rgba(var(--hue-c)');
    expect(h1).toContain('rgba(var(--hue-r)');
  });

  it('copy is balanced with bounded measure — no orphan words dangling alone', () => {
    expect(door.match(/text-wrap:balance/g)!.length).toBeGreaterThanOrEqual(3); // tag, lead, quiet
    expect(door).toContain('max-width:46ch'); // the lead reads as a column, not a floor-wide line
  });
});

describe('the shell fits the ceremony frame to its content', () => {
  it('origin-checked, source-checked, hard-clamped height listener', () => {
    expect(shell).toContain('e.origin !== BIND_URL');
    expect(shell).toContain("'aumlok-bind-size'");
    expect(shell).toContain('Math.max(220, Math.min(780, Math.ceil(d.height)))');
    expect(shell).toContain('f.contentWindow !== e.source');
  });

  it('the fixed dead-space heights are gone from both ceremony frames', () => {
    expect(shell).not.toContain('height:62vh');
    expect(shell).not.toContain('height:620px');
    expect(shell).not.toContain('min-height:520px');
    expect(shell).not.toContain('min-height:460px');
  });
});

describe('untouched authority surface (structural)', () => {
  it('routes, kernel wiring, CSP frame-ancestors, and the status-only CORS are exactly as before', () => {
    for (const r of ["'/api/bind/status'", "'/api/bind/phrase'", "'/api/bind/rotate'", "'/api/bind/complete'"]) {
      expect(door).toContain(r);
    }
    expect(door).toContain("bindStatusCorsHeaders(req.headers.get('origin'), SPATIAL_ORIGINS)");
    expect(door).toContain("frame-ancestors 'self' ${SPATIAL_ORIGINS.join(' ')}");
    expect(door).toContain('beginPhraseRotation(store, SYMBIOTE_HOME, current, Date.now())');
    expect(door).toContain('completeCeremony(store, SYMBIOTE_HOME, typed, nonce, Date.now()');
    // the page still sends the same request bodies — no semantics drift behind the rail
    expect(door).toContain('{currentPhrase:curRail.value()}');
    expect(door).toContain('{phrase:typedRail.value(),nonce}');
  });
});
