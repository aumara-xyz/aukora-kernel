// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// Aukora Spatial — AUMA LUMINARA: the trinary oracle. The portal.
//
// This organ REPLACES the imported I Ching screen (that system was scaffolding,
// set down per canon D4; its data file luminara-data.js remains in the repo,
// unimported, as the owner's archived content). What stands here is the native
// system: 27 cards that ARE the letters of AUMA (3 states x 3 layers; 23 sayable
// + 4 Silences), drawn three at a time into the three invariant positions —
// The Trefoil, The Genus, Phi. Canon + engine live in luminara-canon.js (pure);
// this file owns only the ritual, the rendering, and the honesty rails.
//
// The ritual: hold an intention (or hold silence), then draw each card by
// press-and-hold — the release of your own breath-length hold seeds the draw
// (Q6 v0: intent-and-moment seeding; uniform over the deck, no replacement).
// The reveal blooms the card's emanation figure (canon D18: cymatic field
// behind, sigil seal in front, written stack at the foot). After the third
// card the reading composes itself from the grammar and speaks; "Ask Auma to
// go deeper" hands THIS cast through the governed chat door, owner-initiated.
//
// Honesty rails (treaty REQ-L1 + house rules):
//   - award('reading', { source: 'cast' }) fires EXACTLY ONCE per genuinely
//     completed cast (three releases; the hold-gate keeps mashing meaningless).
//   - The journal is local to this device, a paper diary: never witnessed,
//     earns no authority, clearable anytime.
//   - No numbers about persons. Phi is trajectory, never prediction.

import {
  POSITIONS, SUITS, SILENCES, cardOf, codeOf, codeMarks, isSilent,
  drawOne, composeReading, askAumaText,
} from '/app/luminara-canon.js';
import { publishFocus } from '/app/focus.js';
import { award } from '/app/aura-core.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const PREFERS_STILL = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// suit colors — night, blade, dawn (canon: provisional palette, tunable; a
// shared color vocabulary would be a three-way lane agreement).
const SUIT_HEX = ['#7F77DD', '#D85A30', '#EF9F27'];
const FACE_BG = '#141a29';
const MIN_HOLD_MS = 900; // a breath — also the anti-mash gate (REQ-L1 stays meaningful)

// ---------------------------------------------------------------------------
// Face rendering — canon D17/D18. Three forms of one code: cymatic field behind,
// sigil in front, written stack at the foot. Silences render hollow and unsigned.
// ---------------------------------------------------------------------------
function ringPath(R, k, st, cx, cy) {
  if (st === 0) return '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '"';
  const A = st === 1 ? R * 0.13 : R * 0.21, ph = st === 1 ? 0 : Math.PI / k;
  let p = '';
  for (let j = 0; j <= 96; j++) {
    const t = j / 96 * 2 * Math.PI, r = R + A * Math.cos(k * t + ph);
    p += (j ? 'L' : 'M') + (cx + r * Math.cos(t)).toFixed(1) + ' ' + (cy + r * Math.sin(t)).toFixed(1) + ' ';
  }
  return '<path d="' + p + 'Z"';
}
function sigilSvg(n, cx, cy, col) {
  const d = codeOf(n);
  const colX = (st) => (st === 0 ? 0 : st === 1 ? 13 : -13);
  let v = [[colX(d[2]), 22], [colX(d[1]), 0], [colX(d[0]), -22]];
  const mx = (v[0][0] + v[1][0] + v[2][0]) / 3;
  v = v.map((p) => [cx + p[0] - mx, cy + p[1]]);
  const spine = 'M' + v.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
  let under = '<path d="' + spine + '" stroke="' + FACE_BG + '" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  let over = '<path d="' + spine + '" stroke="' + col + '" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  const sts = [d[2], d[1], d[0]];
  for (let k = 0; k < 3; k++) {
    const st = sts[k], x = v[k][0].toFixed(1), y = v[k][1].toFixed(1);
    if (st === 0) { under += '<circle cx="' + x + '" cy="' + y + '" r="5.6" fill="' + FACE_BG + '"/>'; over += '<circle cx="' + x + '" cy="' + y + '" r="3.4" fill="' + col + '"/>'; }
    else if (st === 1) { under += '<path d="M' + (v[k][0] - 8).toFixed(1) + ' ' + y + ' H' + (v[k][0] + 8).toFixed(1) + '" stroke="' + FACE_BG + '" stroke-width="7" stroke-linecap="round"/>'; over += '<path d="M' + (v[k][0] - 7).toFixed(1) + ' ' + y + ' H' + (v[k][0] + 7).toFixed(1) + '" stroke="' + col + '" stroke-width="2.6" stroke-linecap="round"/>'; }
    else { under += '<circle cx="' + x + '" cy="' + y + '" r="5.5" fill="none" stroke="' + FACE_BG + '" stroke-width="6.5"/>'; over += '<circle cx="' + x + '" cy="' + y + '" r="5.5" fill="none" stroke="' + col + '" stroke-width="2.4"/>'; }
  }
  return under + over;
}
// The four Silence-seals — the forbidden letters drawn as their own codes'
// journeys (D18 amendment, 2026-07-08; designs Fable's, direction the
// architect's). Every Silence has a still core (L1 = ●), so every seal holds
// a dot its form cannot sound: Z descends jaggedly between two stillnesses
// (● — ●); C is the arc that never closes around its free-floating still
// center (— ~ ●); X is the crossing parted by its one still point (~ — ●);
// Q is the closed circle with a re-entry tail around a still witness (~ ~ ●).
// Same stroke vocabulary as the sigils — knockout understroke, round caps —
// so the Silences sit in the deck as kin, not absences.
function silenceSealSvg(n, cx, cy, col) {
  const U = (d, w) => '<path d="' + d + '" stroke="' + FACE_BG + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  const O = (d, w) => '<path d="' + d + '" stroke="' + col + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  const dotU = (x, y) => '<circle cx="' + (cx + x) + '" cy="' + (cy + y) + '" r="5.4" fill="' + FACE_BG + '"/>';
  const dotO = (x, y) => '<circle cx="' + (cx + x) + '" cy="' + (cy + y) + '" r="3.2" fill="' + col + '"/>';
  let s = '';
  if (n === 4) {
    const d = 'M' + (cx - 11) + ' ' + (cy - 20) + ' L' + (cx + 13) + ' ' + (cy - 14) + ' L' + (cx - 13) + ' ' + (cy + 10) + ' L' + (cx + 11) + ' ' + (cy + 20);
    s += U(d, 7) + O(d, 2.6) + dotU(-11, -20) + dotO(-11, -20) + dotU(11, 20) + dotO(11, 20);
  } else if (n === 16) {
    const a = 52 * Math.PI / 180, r = 16.5;
    const x1 = (cx + r * Math.cos(a)).toFixed(1), y1 = (cy + r * Math.sin(a)).toFixed(1);
    const x2 = x1, y2 = (cy - r * Math.sin(a)).toFixed(1);
    const d = 'M' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 1 1 ' + x2 + ' ' + y2;
    s += U(d, 7) + O(d, 2.6) + dotU(4, 0) + dotO(4, 0);
  } else if (n === 22) {
    const d1 = 'M' + (cx - 13) + ' ' + (cy - 16) + ' L' + (cx + 13) + ' ' + (cy + 16);
    const d2 = 'M' + (cx + 13) + ' ' + (cy - 16) + ' L' + (cx - 13) + ' ' + (cy + 16);
    s += U(d1, 7) + U(d2, 7) + O(d1, 2.6) + O(d2, 2.6) + '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="' + FACE_BG + '"/>' + dotO(0, 0);
  } else {
    s += '<circle cx="' + cx + '" cy="' + (cy - 2) + '" r="13.5" fill="none" stroke="' + FACE_BG + '" stroke-width="7"/>';
    s += '<circle cx="' + cx + '" cy="' + (cy - 2) + '" r="13.5" fill="none" stroke="' + col + '" stroke-width="2.6"/>';
    const d = 'M' + (cx + 6) + ' ' + (cy + 5) + ' L' + (cx + 15) + ' ' + (cy + 19);
    s += U(d, 7) + O(d, 2.6) + dotO(0, -2);
  }
  return s;
}
let FILTER_UID = 0;
// The face emerges from mist. The whole body — geometry, seal, written stack —
// sits behind one turbulence filter: on formation the displacement anneals
// (26 → 2.2) and the blur lifts (5 → 0) over ~4s, so everything condenses out
// of smoke TOGETHER, nothing drawn in sequence. What remains afterwards is a
// faint living haze: the noise field drifts on a 26s cycle and the halos
// twinkle on unequal periods. No rotation anywhere; the seal carries no motion
// of its own — it only breathes with the mist it stands in.
// misted=false renders the settled form (journal reopens, reduced motion).
export function faceSvg(n, misted) {
  const d = codeOf(n), col = SUIT_HEX[d[0]], sil = isSilent(n), cx = 75, cy = 95;
  const R = [42, 29, 16], K = [9, 6, 3], L = [d[0], d[1], d[2]];
  // Silences are kin, not absences (D18 amendment): full stroke voice, fills at
  // half-strength — hushed, not hollow — and their own drawn seal below.
  const so = [0.4, 0.5, 0.6], fo = sil ? [0.035, 0.05, 0.065] : [0.07, 0.1, 0.13], sw = [1.3, 1.6, 1.9];
  const zc = ['zf', 'zm', 'zc'];
  const fid = 'lpm' + (++FILTER_UID);
  let s = '<svg viewBox="0 0 150 210" aria-hidden="true">';
  // Filter region generously oversized: during formation the displacement (scale 26) + blur
  // (stdDeviation 5) push the mist ~40px outward; a tighter region clipped that glow into a
  // visible SQUARE edge. -90%/280% keeps the falloff well inside the region on every card.
  s += '<defs><filter id="' + fid + '" x="-90%" y="-90%" width="280%" height="280%">';
  s += '<feTurbulence type="fractalNoise" baseFrequency="0.013 0.019" numOctaves="2" seed="' + (n * 7 + 3) + '" result="mist">';
  s += '<animate attributeName="baseFrequency" dur="26s" values="0.013 0.019;0.017 0.023;0.013 0.019" repeatCount="indefinite"/>';
  s += '</feTurbulence>';
  s += '<feDisplacementMap in="SourceGraphic" in2="mist" xChannelSelector="R" yChannelSelector="G" scale="' + (misted ? 26 : 2.2) + '" result="veil">';
  if (misted) s += '<animate attributeName="scale" values="26;2.2" keyTimes="0;1" calcMode="spline" keySplines="0.25 0.6 0.25 1" dur="3.8s" begin="0s" fill="freeze"/>';
  s += '</feDisplacementMap>';
  s += '<feGaussianBlur in="veil" stdDeviation="' + (misted ? 5 : 0) + '">';
  if (misted) s += '<animate attributeName="stdDeviation" values="5;0" keyTimes="0;1" calcMode="spline" keySplines="0.3 0.7 0.3 1" dur="3.4s" begin="0s" fill="freeze"/>';
  s += '</feGaussianBlur>';
  s += '</filter></defs>';
  s += '<g class="body" filter="url(#' + fid + ')">';
  for (let z = 0; z < 3; z++) {
    s += '<g class="zone ' + zc[z] + '">';
    s += ringPath(R[z], K[z], L[z], cx, cy) + ' class="halo" fill="none" stroke="' + col + '" stroke-opacity="0.13" stroke-width="' + (sw[z] + 4) + '" stroke-linecap="round"/>';
    s += ringPath(R[z], K[z], L[z], cx, cy) + ' class="ring" fill="' + col + '" fill-opacity="' + fo[z] + '" stroke="' + col + '" stroke-opacity="' + so[z] + '" stroke-width="' + sw[z] + '"/>';
    s += '</g>';
  }
  s += '<g class="seal">' + (sil ? silenceSealSvg(n, cx, cy, col) : sigilSvg(n, cx, cy, col)) + '</g>';
  // the written stack at the foot — the code is writable even where the letter
  // is unsayable, so the Silences carry it too
  const gy = [172, 181, 190];
  let foot = '';
  for (let k = 0; k < 3; k++) {
    const dd = d[k], y = gy[k];
    if (dd === 0) foot += '<circle cx="75" cy="' + y + '" r="2" fill="' + col + '" fill-opacity="0.65"/>';
    else if (dd === 1) foot += '<rect x="65" y="' + (y - 1.1) + '" width="20" height="2.2" rx="1.1" fill="' + col + '" fill-opacity="0.65"/>';
    else foot += '<path d="M65 ' + y + ' q2.5 -3 5 0 t5 0 t5 0 t5 0" stroke="' + col + '" stroke-opacity="0.65" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
  }
  s += '<g class="foot">' + foot + '</g>';
  return s + '</g></svg>';
}

// Cast journal — LOCAL to this device, like a paper diary. NEVER a witnessed
// memory: not receipted, earns no authority, clearable anytime.
const CASTS_KEY = 'aukora-luminara-casts-v2';
function loadCasts() { try { return JSON.parse(localStorage.getItem(CASTS_KEY)) || []; } catch { return []; } }
function saveCast(entry) {
  try { const all = loadCasts(); all.unshift(entry); localStorage.setItem(CASTS_KEY, JSON.stringify(all.slice(0, 30))); } catch { /* quota */ }
}
function clearCasts() { try { localStorage.removeItem(CASTS_KEY); } catch { /* fine */ } }

// ---------------------------------------------------------------------------

export function mountLuminara(root) {
  injectStyle();
  const app = el('div', 'lp-app');

  const head = el('div', 'lp-head');
  const brand = el('div', 'lp-brand');
  brand.append(el('b', null, 'LUMINARA'), el('span', null, 'The Auma Oracle - Draw Three Glyphs'));
  head.append(brand, el('div', 'lp-chip', '27'));
  app.append(head);

  // ---- intention — held once, before the first draw ----
  const intentWrap = el('div', 'lp-intent');
  const intent = el('input', 'lp-intent-in');
  intent.type = 'text'; intent.maxLength = 140;
  intent.placeholder = 'hold a question — or leave this empty and hold silence';
  intentWrap.append(intent);
  app.append(intentWrap);

  // ---- the frame: three invariant positions ----
  const frame = el('div', 'lp-frame');
  const slots = POSITIONS.map((p) => {
    const slot = el('div', 'lp-slot');
    slot.append(el('div', 'lp-slot-k', p.name));
    const well = el('div', 'lp-well'); slot.append(well);
    slot.append(el('div', 'lp-slot-g', p.gloss));
    frame.append(slot);
    return { slot, well };
  });
  app.append(frame);

  // ---- the ritual: the glow IS the button — a breathing light, no chrome ----
  const rite = el('div', 'lp-rite');
  const orb = el('button', 'lp-orb'); orb.type = 'button';
  orb.setAttribute('aria-label', 'Hold the light, then release to draw');
  const hint = el('div', 'lp-hint', 'breathe — press and hold the light, release to draw Trefoil');
  const exploreLink = el('button', 'lp-explore-link', 'Explore the Glyphs'); exploreLink.type = 'button';
  rite.append(orb, hint, exploreLink);
  app.append(rite);

  // ---- the reading ----
  const readingEl = el('div', 'lp-reading'); readingEl.style.display = 'none';
  app.append(readingEl);

  // ---- journal ----
  const journal = el('div', 'lp-journal'); journal.style.display = 'none';
  app.append(journal);

  // ---- explore the glyphs — the whole deck in sequence, meanings in hand ----
  const explore = el('div', 'lp-explore'); explore.style.display = 'none';
  app.append(explore);

  root.append(app);

  let exIdx = 1;
  const exStep = (dir) => { exIdx = ((exIdx - 1 + dir + 27) % 27) + 1; renderExplore(); };
  function renderExplore() {
    const c = cardOf(exIdx), d = codeOf(exIdx), sil = isSilent(exIdx);
    explore.innerHTML = '';
    const xhead = el('div', 'lp-x-head');
    xhead.append(el('b', null, 'Explore the Glyphs'));
    const xclose = el('button', 'lp-x-close', 'return to the casting'); xclose.type = 'button';
    xclose.addEventListener('click', closeExplore);
    xhead.append(xclose);
    explore.append(xhead);
    const row = el('div', 'lp-x-row');
    const prev = el('button', 'lp-x-nav', '‹'); prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous glyph');
    prev.addEventListener('click', () => exStep(-1));
    const next = el('button', 'lp-x-nav', '›'); next.type = 'button';
    next.setAttribute('aria-label', 'Next glyph');
    next.addEventListener('click', () => exStep(1));
    const faceWrap = el('div', 'lp-card formed lp-x-face');
    faceWrap.innerHTML = faceSvg(exIdx, false);
    row.append(prev, faceWrap, next);
    explore.append(row);
    const info = el('div', 'lp-x-info');
    info.append(el('div', 'lp-x-name', c.name));
    const suit = SUITS[d[0]];
    info.append(el('div', 'lp-x-meta', suit.key + ' ' + ((exIdx - 1) % 9 + 1) + ' · card ' + exIdx + ' of 27 · ' + codeMarks(exIdx) + ' · ' + (sil ? 'silence ' : 'letter ') + c.letter));
    info.append(el('div', 'lp-x-ess', c.essence));
    const LV = ['holds still', 'flows', 'turns'];
    info.append(el('div', 'lp-x-layers', 'the field ' + LV[d[0]] + ' · the relation ' + LV[d[1]] + ' · the core ' + LV[d[2]]));
    if (sil) {
      const s = SILENCES[exIdx];
      info.append(el('div', 'lp-x-sil', s.name + ' — a Silence, the edge that asks for ' + s.asks + '. ' + s.lines.join(' ')));
    }
    info.append(el('div', 'lp-x-suit', suit.key + ' — ' + suit.gloss));
    explore.append(info);
    publishFocus({
      app: 'luminara', kind: 'luminara-explore',
      card: { n: exIdx, name: c.name, code: codeMarks(exIdx), letter: c.letter, silent: sil },
      summary: 'Exploring the Luminara glyphs — ' + c.name + ' (' + (sil ? 'silence ' : 'letter ') + c.letter + ', card ' + exIdx + ' of 27).',
    });
  }
  function exKeys(e) {
    if (e.key === 'ArrowLeft') exStep(-1);
    else if (e.key === 'ArrowRight') exStep(1);
    else if (e.key === 'Escape') closeExplore();
  }
  function openExplore() { explore.style.display = ''; renderExplore(); document.addEventListener('keydown', exKeys); }
  function closeExplore() {
    explore.style.display = 'none';
    document.removeEventListener('keydown', exKeys);
    if (!cast.length) idleFocus();
  }
  exploreLink.addEventListener('click', openExplore);

  // ---- state ----
  let cast = [];            // drawn card numbers, in position order
  let seedParts = [];       // intention + hold timings; each release folds the moment in
  let holdT0 = 0;
  let done = false;

  function idleFocus() {
    publishFocus({ app: 'luminara', kind: 'organ', label: 'Luminara (the Auma oracle)', summary: 'In Luminara — the frame is empty; nothing cast yet.' });
  }

  function setHint(t) { hint.textContent = t; }
  function nextName() { return POSITIONS[cast.length] ? POSITIONS[cast.length].name : ''; }

  // DETOKENIZED: no numeric aura toast — a genuine cast pulses the coherence glyph
  // through aura-core's numberless event. The reading is the reward.

  function renderCardInto(wellIdx, n, immediate) {
    const c = cardOf(n);
    const face = el('div', 'lp-card' + (isSilent(n) ? ' silent' : ''));
    face.innerHTML = faceSvg(n, !immediate && !PREFERS_STILL);
    face.title = c.name + ' · ' + codeMarks(n) + (isSilent(n) ? ' · silence ' + c.letter : ' · ' + c.letter);
    const w = slots[wellIdx].well;
    w.innerHTML = ''; w.append(face);
    const g = slots[wellIdx].slot.querySelector('.lp-slot-g');
    g.textContent = c.name; g.classList.add('named');
    if (immediate) { face.classList.add('formed'); return; }
    // the formation: the mist condenses into the figure — one slow exhale.
    face.classList.add('forming');
    void face.offsetWidth; // flush styles so the forming state is the transition's start point
    setTimeout(() => { face.classList.remove('forming'); face.classList.add('formed'); }, 60);
  }

  function beginHold() {
    if (done || cast.length >= 3 || holdT0) return;
    holdT0 = performance.now();
    orb.classList.add('holding');
  }
  function endHold() {
    if (done || cast.length >= 3 || !holdT0) return;
    const dur = performance.now() - holdT0;
    holdT0 = 0;
    orb.classList.remove('holding');
    if (dur < MIN_HOLD_MS) {
      setHint('stay a breath longer — hold, then release for ' + nextName());
      return;
    }
    if (cast.length === 0) {
      intent.disabled = true;
      seedParts = [intent.value.trim() || '(silence)'];
    }
    seedParts.push(Math.round(dur) + ':' + Date.now());
    const n = drawOne(seedParts.join('|') + '|' + (cast.length + 1), cast);
    cast.push(n);
    renderCardInto(cast.length - 1, n, false);
    if (cast.length < 3) {
      setHint('when ready — hold again, release to draw ' + nextName());
    } else {
      completeCast();
    }
  }
  orb.addEventListener('pointerdown', beginHold);
  orb.addEventListener('pointerup', endHold);
  orb.addEventListener('pointercancel', () => { holdT0 = 0; orb.classList.remove('holding'); });
  // keyboard ritual — hold space or enter, release to draw (same breath-gate).
  orb.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); beginHold(); } });
  orb.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endHold(); } });

  function completeCast() {
    done = true;
    orb.disabled = true;
    setHint('Breath, Release, Cast');
    const reading = composeReading(cast, intent.value.trim() || null);
    renderReading(reading, false);
    saveCast({ cast: cast.slice(), intention: reading.intention, ts: Date.now() });
    renderJournal();
    // REQ-L1: exactly once per genuinely completed cast — act-quality gated in
    // aura-core; registers as a numberless qualifying act (glyph pulse only).
    award('reading', { source: 'cast' });
    publishFocus({
      app: 'luminara', kind: 'luminara-reading',
      cast: cast.map((n, i) => ({ position: POSITIONS[i].name, card: cardOf(n).name, code: codeMarks(n), silent: isSilent(n) })),
      intention: reading.intention,
      summary: 'Luminara cast — ' + reading.summary,
    });
  }

  function renderReading(reading, reopened) {
    readingEl.innerHTML = ''; readingEl.style.display = '';
    if (reading.intention) readingEl.append(el('div', 'lp-r-int', '“' + reading.intention + '”'));
    for (const s of reading.sections) {
      const sec = el('div', 'lp-sec' + (s.silent ? ' silent' : ''));
      sec.append(el('div', 'lp-sec-k', s.position.name + ' — ' + s.position.gloss));
      sec.append(el('div', 'lp-sec-body', s.body));
      readingEl.append(sec);
    }
    if (!reading.allSilent) {
      const weave = el('div', 'lp-weave');
      weave.append(el('div', 'lp-sec-k', 'the weave'));
      for (const v of reading.vectors) weave.append(el('div', 'lp-weave-line', v.layer + '  ' + v.arc + '  ·  ' + v.line));
      weave.append(el('div', 'lp-weave-line', reading.harmonic));
      weave.append(el('div', 'lp-weave-line', reading.depth));
      readingEl.append(weave);
    }
    readingEl.append(el('div', 'lp-landing', reading.landing));

    const row = el('div', 'lp-actions');
    const ask = el('button', 'lp-ask'); ask.type = 'button'; ask.textContent = 'Ask Auma to go deeper';
    ask.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('aukora:ask', { detail: { text: askAumaText(reading) } }));
      ask.textContent = 'Auma is reading — see the chat →'; ask.disabled = true;
      setTimeout(() => { ask.textContent = 'Ask Auma to go deeper'; ask.disabled = false; }, 5000);
    });
    const again = el('button', 'lp-again'); again.type = 'button'; again.textContent = reopened ? 'Cast anew' : 'Cast again';
    again.addEventListener('click', resetAll);
    row.append(ask, again);
    readingEl.append(row);
  }

  function resetAll() {
    cast = []; seedParts = []; done = false;
    orb.disabled = false; intent.disabled = false;
    readingEl.style.display = 'none'; readingEl.innerHTML = '';
    slots.forEach(({ slot, well }, i) => { well.innerHTML = ''; const g = slot.querySelector('.lp-slot-g'); g.textContent = POSITIONS[i].gloss; g.classList.remove('named'); });
    setHint('breathe — press and hold the light, release to draw Trefoil');
    idleFocus();
    app.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reopenCast(entry) {
    resetAll();
    cast = entry.cast.slice(); done = true; orb.disabled = true; intent.disabled = true;
    intent.value = entry.intention || '';
    cast.forEach((n, i) => renderCardInto(i, n, true));
    const reading = composeReading(cast, entry.intention);
    renderReading(reading, true);
    setHint('a remembered cast — its reading recomposes exactly');
    publishFocus({
      app: 'luminara', kind: 'luminara-reading',
      cast: cast.map((n, i) => ({ position: POSITIONS[i].name, card: cardOf(n).name, code: codeMarks(n), silent: isSilent(n) })),
      intention: entry.intention || null,
      summary: 'Reopened Luminara cast — ' + reading.summary,
    });
    app.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderJournal() {
    const casts = loadCasts();
    journal.innerHTML = '';
    if (!casts.length) { journal.style.display = 'none'; return; }
    journal.style.display = '';
    journal.append(el('div', 'lp-journal-k', 'your recent casts · on this device only · never witnessed'));
    const row = el('div', 'lp-journal-row');
    casts.forEach((c) => {
      const chip = el('button', 'lp-jchip'); chip.type = 'button';
      chip.append(el('b', null, c.cast.map((n) => cardOf(n).letter).join('·')));
      chip.title = c.cast.map((n, i) => POSITIONS[i].name + ': ' + cardOf(n).name).join(' · ') + (c.intention ? ' — “' + c.intention + '”' : '');
      chip.addEventListener('click', () => reopenCast(c));
      row.append(chip);
    });
    const wipe = el('button', 'lp-jwipe'); wipe.type = 'button'; wipe.textContent = 'clear';
    wipe.title = 'Clear the journal on this device (a paper diary — burning it is allowed)';
    wipe.addEventListener('click', () => { clearCasts(); renderJournal(); });
    row.append(wipe);
    journal.append(row);
  }

  idleFocus();
  renderJournal();
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .lp-app { --lp-o: 255, 184, 120; container-type:inline-size; position:absolute; inset:0; overflow:auto; color:var(--text); padding:0 0 24px;
    background:
      radial-gradient(1000px 680px at 14% -8%, rgba(127,119,221,0.10), transparent 60%),
      radial-gradient(920px 640px at 86% 108%, rgba(239,159,39,0.08), transparent 60%),
      radial-gradient(700px 560px at 50% 44%, rgba(216,90,48,0.05), transparent 66%),
      #131826; }

  .lp-head { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 4px; }
  .lp-brand b { font-size:14px; letter-spacing:0.3em;
    background:linear-gradient(100deg, #7F77DD, #D85A30 55%, #EF9F27);
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .lp-brand span { margin-left:11px; font-size:11px; color:var(--dim); }
  .lp-chip { font-size:11px; letter-spacing:0.12em; padding:3px 11px; border-radius:20px; color:rgba(var(--lp-o),0.95); border:1px solid rgba(var(--lp-o),0.4); font-family:ui-monospace,monospace; }

  .lp-intent { display:flex; justify-content:center; padding:14px 22px 0; }
  .lp-intent-in { width:min(440px, 100%); font:inherit; font-size:13px; color:var(--text); text-align:center;
    background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:22px; padding:10px 18px; outline:none;
    transition:border-color 0.2s ease; }
  .lp-intent-in:focus { border-color:rgba(127,119,221,0.55); }
  .lp-intent-in:disabled { opacity:0.6; }

  .lp-frame { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:14px; padding:20px 22px 0; max-width:700px; margin:0 auto; }
  .lp-slot { text-align:center; min-width:0; }
  .lp-slot-k { font-size:9.5px; letter-spacing:0.08em; text-transform:lowercase; color:var(--faint); margin-bottom:8px; }
  .lp-slot-g { font-size:10px; color:var(--faint); margin-top:7px; line-height:1.45; transition:font-size 0.6s ease, color 0.6s ease; }
  .lp-slot-g.named { font-size:15.5px; font-weight:600; color:#fff; line-height:1.3; margin-top:10px; }
  /* no borders, no glow behind the cards — the only edge is a subtle change of
     tone, and the only light on this screen is the held breath below */
  .lp-well { position:relative; aspect-ratio:150/210; border-radius:14px; background:rgba(255,255,255,0.022); }

  .lp-card { position:relative; width:100%; height:100%; background:#141a29; border-radius:13px; line-height:0;
    opacity:0; transform:scale(1.05);
    transition:opacity 0.7s ease, transform 3.2s cubic-bezier(0.19,1,0.22,1) 1.6s; }
  .lp-card.formed { opacity:1; transform:scale(1); }
  /* overflow stays visible so the figure's glow falls off radially instead of
     being cut square by the svg viewport or the well box */
  .lp-card svg { width:100%; height:100%; display:block; overflow:visible; }

  /* formation — the geometry and the seal condense TOGETHER out of mist. The
     svg's own turbulence filter does the condensing (displacement anneals,
     blur lifts, ~4s); here we only fade the whole body in and let the card
     settle into its seat. Nothing is drawn in sequence; it all arrives as one
     form surfacing from smoke. */
  .lp-card .body { transition:opacity 2.6s ease 0.15s; }
  .lp-card.forming .body { opacity:0; }
  .lp-card.formed .body { opacity:1; }

  /* living light — no rotation, no sweep: a faint haze-drift in the noise
     field (26s, inside the svg filter) and a slow halo twinkle, each zone on
     its own unequal period so the shimmer never repeats as a pattern. The
     seal carries no motion of its own — it only breathes with the mist. */
  .lp-card.formed .zc .halo { animation:lp-shimmer 7s ease-in-out infinite; }
  .lp-card.formed .zm .halo { animation:lp-shimmer 9.5s ease-in-out infinite reverse; }
  .lp-card.formed .zf .halo { animation:lp-shimmer 12.5s ease-in-out infinite; }
  @keyframes lp-shimmer { 0%,100% { stroke-opacity:0.09; } 50% { stroke-opacity:0.24; } }

  .lp-rite { position:relative; display:flex; flex-direction:column; align-items:center; gap:6px; padding:20px 20px 8px; }
  /* the glow IS the button: a faint breathing light in the background, no disc,
     no border, no chrome. Holding it draws the light in and brightens it. */
  .lp-orb { position:relative; z-index:1; width:150px; height:150px; border-radius:50%; cursor:pointer; border:none; outline:none;
    background:radial-gradient(circle, rgba(127,119,221,0.16), rgba(239,159,39,0.05) 55%, transparent 72%);
    animation:lp-breathe 7s ease-in-out infinite;
    transition:transform 1.2s cubic-bezier(0.19,1,0.22,1), filter 1.2s ease; }
  .lp-orb:hover { filter:brightness(1.25); }
  .lp-orb:focus-visible { box-shadow:0 0 0 1px rgba(238,242,255,0.25); }
  /* the hold is an inhale: the light swells steadily toward its apex over ~4s
     (fast at first, slowing as the lungs fill) — you release at the top.
     Letting go exhales it back on the shorter base transition. */
  .lp-orb.holding { animation-play-state:paused; transform:scale(2); filter:brightness(2.1) saturate(1.15);
    transition:transform 4.2s cubic-bezier(0.2,0.55,0.35,1), filter 2.4s ease; }
  .lp-orb:disabled { opacity:0.25; cursor:default; animation-play-state:paused; }
  @keyframes lp-breathe { 0%,100% { transform:scale(0.82); opacity:0.55; } 50% { transform:scale(1.1); opacity:1; } }
  @media (prefers-reduced-motion: reduce) {
    .lp-orb, .lp-card.formed .halo { animation:none; }
    .lp-card, .lp-card .body { transition-duration:0.3s; transition-delay:0s; }
  }
  .lp-hint { position:relative; z-index:1; font-size:11px; color:var(--faint); text-align:center; max-width:420px; line-height:1.5; }

  .lp-reading { max-width:700px; margin:18px auto 0; padding:22px 24px; border-radius:20px;
    border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); backdrop-filter:blur(8px); }
  .lp-r-int { font-size:12.5px; color:rgba(238,242,255,0.65); font-style:italic; text-align:center; margin-bottom:16px; }
  .lp-sec { margin-bottom:16px; padding-left:13px; border-left:2px solid rgba(127,119,221,0.5); }
  .lp-sec:nth-of-type(2) { border-color:rgba(216,90,48,0.55); }
  .lp-sec:nth-of-type(3) { border-color:rgba(239,159,39,0.55); }
  .lp-sec.silent { border-left-style:dashed; border-color:rgba(238,242,255,0.3); }
  .lp-sec-k { font-size:9.5px; letter-spacing:0.22em; text-transform:uppercase; color:var(--faint); margin-bottom:5px; }
  .lp-sec-body { font-size:13px; line-height:1.66; color:rgba(238,242,255,0.86); }
  .lp-sec.silent .lp-sec-body { color:rgba(238,242,255,0.72); font-style:italic; }
  .lp-weave { margin:18px 0 6px; padding-top:14px; border-top:1px solid rgba(255,255,255,0.08); }
  .lp-weave-line { font-size:12px; line-height:1.7; color:rgba(238,242,255,0.7); }
  .lp-landing { margin-top:16px; font-size:14px; line-height:1.6; color:#fff; }

  .lp-actions { display:flex; gap:10px; margin-top:18px; flex-wrap:wrap; }
  .lp-ask, .lp-again { font:inherit; font-size:12px; font-weight:600; padding:9px 17px; border-radius:20px; cursor:pointer; transition:border-color 0.18s ease, background 0.18s ease; }
  .lp-ask { color:rgba(238,242,255,0.92); background:rgba(127,119,221,0.1); border:1px solid rgba(127,119,221,0.45); }
  .lp-ask::before { content:'✦ '; }
  .lp-ask:hover { border-color:rgba(127,119,221,0.8); background:rgba(127,119,221,0.16); }
  .lp-ask:disabled { opacity:0.7; cursor:default; }
  .lp-again { color:var(--dim); background:transparent; border:1px solid rgba(255,255,255,0.16); }
  .lp-again:hover { border-color:rgba(255,255,255,0.3); }

  .lp-journal { margin:22px 22px 0; }
  .lp-journal-k { font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:var(--faint); margin-bottom:10px; text-align:center; }
  .lp-journal-row { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; align-items:center; }
  .lp-jchip { flex:none; padding:9px 13px; cursor:pointer; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.025);
    transition:transform 0.14s ease, border-color 0.14s ease; font:inherit; }
  .lp-jchip b { font-size:12.5px; font-weight:500; letter-spacing:0.08em; color:rgba(238,242,255,0.85); font-family:ui-monospace,monospace; }
  .lp-jchip:hover { transform:translateY(-2px); border-color:rgba(127,119,221,0.5); }
  .lp-jwipe { font:inherit; font-size:10px; color:var(--faint); background:none; border:none; cursor:pointer; text-decoration:underline dotted; }

  .lp-toast { position:fixed; left:50%; bottom:30px; transform:translate(-50%, 14px); z-index:40; pointer-events:none;
    padding:8px 16px; border-radius:20px; font-size:12px; font-weight:600; color:#131826; opacity:0;
    background:linear-gradient(100deg, rgba(127,119,221,0.96), rgba(239,159,39,0.96)); box-shadow:0 8px 30px rgba(0,0,0,0.42);
    transition:opacity 0.35s ease, transform 0.35s ease; }
  .lp-toast.in { opacity:1; transform:translate(-50%, 0); }

  .lp-explore-link { margin-top:6px; font:inherit; font-size:11px; color:var(--dim); background:none; border:none; cursor:pointer; text-decoration:underline dotted; letter-spacing:0.04em; }
  .lp-explore-link:hover { color:#fff; }

  /* explore the glyphs — an overlay page over the whole organ */
  .lp-explore { position:absolute; inset:0; z-index:6; overflow:auto; padding:0 0 34px;
    background:
      radial-gradient(1000px 680px at 14% -8%, rgba(127,119,221,0.10), transparent 60%),
      radial-gradient(920px 640px at 86% 108%, rgba(239,159,39,0.08), transparent 60%),
      radial-gradient(700px 560px at 50% 44%, rgba(216,90,48,0.05), transparent 66%),
      #131826; }
  .lp-x-head { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 8px; }
  .lp-x-head b { font-size:13px; letter-spacing:0.22em;
    background:linear-gradient(100deg, #7F77DD, #D85A30 55%, #EF9F27);
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .lp-x-close { font:inherit; font-size:11px; color:var(--dim); background:transparent; border:1px solid rgba(255,255,255,0.14); border-radius:18px; padding:7px 14px; cursor:pointer; transition:border-color 0.18s ease, color 0.18s ease; }
  .lp-x-close:hover { border-color:rgba(255,255,255,0.3); color:#fff; }
  .lp-x-row { display:flex; align-items:center; justify-content:center; gap:14px; padding:10px 16px 0; }
  .lp-x-nav { font:inherit; font-size:36px; line-height:1; color:var(--dim); background:none; border:none; cursor:pointer; padding:10px 16px; transition:color 0.2s ease, transform 0.2s ease; }
  .lp-x-nav:hover { color:#fff; transform:scale(1.18); }
  .lp-x-face { width:min(216px, 52vw); aspect-ratio:150/210; flex:none; }
  .lp-x-info { max-width:480px; margin:16px auto 0; text-align:center; padding:0 22px; }
  .lp-x-name { font-size:20px; font-weight:600; color:#fff; }
  .lp-x-meta { font-size:11px; color:var(--faint); font-family:ui-monospace,monospace; margin-top:5px; }
  .lp-x-ess { font-size:13.5px; line-height:1.65; color:rgba(238,242,255,0.86); margin-top:13px; }
  .lp-x-layers { font-size:11.5px; color:var(--dim); margin-top:11px; }
  .lp-x-sil { font-size:12.5px; font-style:italic; color:rgba(238,242,255,0.72); margin-top:11px; line-height:1.6; }
  .lp-x-suit { font-size:10.5px; letter-spacing:0.08em; color:var(--faint); margin-top:13px; }

  @container (max-width:560px) { .lp-frame { gap:8px; padding:14px 12px 0; } }
  `;
  const tag = document.createElement('style'); tag.id = 'luminara-style'; tag.textContent = css;
  document.getElementById('luminara-style')?.remove();
  document.head.append(tag);
}
