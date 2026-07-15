// Aukora Spatial — GRATICUBE · SIGNAL ARRAY: the gratitude story game, deep-space edition.
//
// Sam's game (https://www.graticube.game), reimagined full sci-fi for Aukora
// (round 3, owner-directed). The tech below is unchanged — the 247 story
// cards, the shuffle-bag selector, the chakra carriers, the Harp Bloom, the
// filters, the AURA tie-in — but the body is new: the two dice became the
// RESONANCE DIAL, a pair of counter-rotating rings over a living starfield.
// The inner hexadic ring carries TIME (never · past · future · always ·
// some time · now); the outer dodecadic ring carries the EMOTION SPECTRUM
// (love → guilt). Pull the dial and release: the rings spin against each
// other, decay, and lock at the top marker. The pair tunes the array, and a
// story prompt arrives as a decoded TRANSMISSION, carried by one of the
// eight archetypes. You answer out loud, in the room. The screen only
// carries the signal.
//
// Still an organ, not an embed:
//   · transparent over the trinity gradient; colors from var(--text)/hues
//   · container queries reflow everything across the 1/3 · 2/3 · full lane
//     (dial alone when narrow; dial port + transmission bay when wide)
//   · the live card publishes to the proprioception focus channel
//   · Auma can join two ways: "play too" (she answers as a player) or "go
//     deeper" (she facilitates YOUR share) — both through aukora:ask
//   · every transmission carries a SIGNAL GLYPH: the system's own cymatic
//     renderer (coherence-glyph.js) seeded by the turn's signature. Decorative
//     portraiture only — coherence is NOT measured or wired here; the owner's
//     coherence system (docs/COHERENCE_GLYPH.md) will claim that when it lands.
//     Deliberately, a turn awards NO aura (round-2 tie-in withdrawn by owner).
//   · the array remembers: a signal log + the carrier constellation (all
//     eight lit calls the Gift Round; each star opens its carrier's dossier)

import { GRATICUBE_CARDS, GRATICUBE_CHARACTERS, GRATICUBE_DECKS, GRATICUBE_DICE } from '/app/graticube-data.js';
import { filterCards, optionCounts, makeSelector, FILTER_GROUPS } from '/app/graticube-core.js';
import { publishFocus } from '/app/focus.js';
import { createGlyph } from '/app/coherence-glyph.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const A = '/assets/graticube';

// ---------------------------------------------------------------------------
// The Resonance Dial — two counter-rotating sector rings, locked by physics.
// A 1-D angular-velocity integrator per ring (the same tumble-and-settle law
// the 3D dice used, one axis now): flick sets ω, exponential damping bleeds
// it off, and the ring eases onto the nearest sector center at the marker.
// ---------------------------------------------------------------------------
const C = 210;                      // dial viewBox center (420 × 420)
const polar = (r, aDeg) => {
  const a = (aDeg - 90) * Math.PI / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};
function sectorPath(r1, r2, a0, a1) {
  const [x0o, y0o] = polar(r2, a0), [x1o, y1o] = polar(r2, a1);
  const [x1i, y1i] = polar(r1, a1), [x0i, y0i] = polar(r1, a0);
  return `M${x0o},${y0o} A${r2},${r2} 0 0 1 ${x1o},${y1o} L${x1i},${y1i} A${r1},${r1} 0 0 0 ${x0i},${y0i} Z`;
}

function makeRing(svgRoot, { labels, r1, r2, cls }) {
  const N = labels.length;
  const step = 360 / N;
  const g = sv('g', { class: `gtc-ring ${cls}` });
  const sectors = [];
  labels.forEach((word, k) => {
    const a0 = k * step - step / 2, a1 = k * step + step / 2;
    const p = sv('path', { d: sectorPath(r1, r2, a0, a1), class: 'gtc-sector' });
    g.append(p);
    sectors.push(p);
    const lg = sv('g', { transform: `rotate(${k * step} ${C} ${C})` });
    const t = sv('text', { x: C, y: C - (r1 + r2) / 2, class: 'gtc-ring-word', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    t.textContent = word;
    lg.append(t);
    g.append(lg);
  });
  svgRoot.append(g);

  let theta = Math.random() * 360;
  let omega = 0;
  const paint = () => g.setAttribute('transform', `rotate(${theta} ${C} ${C})`);
  paint();

  return {
    labels, step,
    launch(w) { omega = w; },
    step_(dt, damping) {
      if (Math.abs(omega) > 1e-3) { theta = (theta + omega * dt) % 360; omega *= Math.exp(-damping * dt); }
      paint();
      return Math.abs(omega);
    },
    lockTarget() {
      const k = ((Math.round(-theta / step) % N) + N) % N;
      const base = -k * step;
      const target = base + 360 * Math.round((theta - base) / 360);
      return { k, from: theta, target };
    },
    glide(from, target, t) { theta = from + (target - from) * t; paint(); },
    setLit(k) { sectors.forEach((p, i) => p.classList.toggle('lit', i === k)); },
  };
}

// ---------------------------------------------------------------------------
// Starfield — a slow canvas drift that goes to warp while the dial spins.
// ---------------------------------------------------------------------------
function makeStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  let stars = [];
  let warp = 0;                 // 0 = drift · 1 = full warp
  let wantWarp = 0;
  let running = false;
  let raf = 0;
  const seed = () => {
    const { width: w, height: h } = canvas;
    stars = Array.from({ length: Math.min(140, Math.round(w * h / 9000)) }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      z: 0.3 + Math.random() * 0.7,
    }));
  };
  const size = () => {
    const r = canvas.parentElement.getBoundingClientRect();
    if (!r.width) return;
    canvas.width = r.width; canvas.height = r.height;
    seed();
  };
  const meteors = [];
  const frame = () => {
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    warp += (wantWarp - warp) * 0.06;
    const cx = w / 2, cy = h / 2;
    // a quiet meteor now and then — the deep field is alive even at rest
    if (warp < 0.1 && meteors.length < 2 && Math.random() < 0.0022) {
      const a = Math.PI * (0.15 + Math.random() * 0.25);
      meteors.push({ x: Math.random() * w * 0.8, y: -6, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, life: 1 });
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx; m.y += m.vy; m.life -= 0.016;
      if (m.life <= 0 || m.x > w + 40 || m.y > h + 40) { meteors.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(255,230,240,${0.5 * m.life})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 4.5, m.y - m.vy * 4.5);
      ctx.stroke();
    }
    for (const s of stars) {
      const dx = (s.x - cx), dy = (s.y - cy);
      const v = 0.06 * s.z + warp * 7 * s.z;
      const L = Math.hypot(dx, dy) || 1;
      s.x += (dx / L) * v; s.y += (dy / L) * v + 0.04;
      if (s.x < -8 || s.x > w + 8 || s.y < -8 || s.y > h + 8) {
        s.x = cx + (Math.random() - 0.5) * w * 0.5; s.y = cy + (Math.random() - 0.5) * h * 0.5;
      }
      const a = 0.25 + s.z * 0.5;
      if (warp > 0.12) {
        ctx.strokeStyle = `rgba(196,180,255,${a})`;
        ctx.lineWidth = s.z;
        ctx.beginPath(); ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - (dx / L) * warp * 11 * s.z, s.y - (dy / L) * warp * 11 * s.z);
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(224,220,255,${a})`;
        ctx.fillRect(s.x, s.y, s.z * 1.6, s.z * 1.6);
      }
    }
    if (running) raf = requestAnimationFrame(frame);
  };
  return {
    start() { if (running) return; running = true; size(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    resize: size,
    setWarp(v) { wantWarp = v; },
  };
}

// ---------------------------------------------------------------------------
// Harp Bloom — the gratitude sound, synthesized. No file, just physics.
// ---------------------------------------------------------------------------
let actx = null;
function harpBloom() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const now = actx.currentTime;
    const master = actx.createGain(); master.gain.value = 0.2; master.connect(actx.destination);
    const delay = actx.createDelay(); delay.delayTime.value = 0.26;
    const fb = actx.createGain(); fb.gain.value = 0.24;
    const wet = actx.createGain(); wet.gain.value = 0.14;
    delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(actx.destination);
    [523.25, 659.25, 783.99, 987.77, 1174.66].forEach((hz, i) => {
      const t0 = now + i * 0.085;
      const g = actx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.85 / (1 + i * 0.12), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
      const o1 = actx.createOscillator(); o1.type = 'sine'; o1.frequency.value = hz;
      const o2 = actx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = hz * 2.001;
      const g2 = actx.createGain(); g2.gain.value = 0.18;
      o1.connect(g); o2.connect(g2); g2.connect(g);
      g.connect(master); g.connect(delay);
      o1.start(t0); o2.start(t0); o1.stop(t0 + 2); o2.stop(t0 + 2);
    });
  } catch { /* sound is a gift, never a crash */ }
}

// ---------------------------------------------------------------------------

const SOUND_KEY = 'aukora-graticube-sound-v1';
const FILTER_KEY = 'aukora-graticube-filters-v1';
const JOURNAL_KEY = 'aukora-graticube-journal-v1';
const MET_KEY = 'aukora-graticube-met-v1';
const loadJSON = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };
const cardById = (id) => GRATICUBE_CARDS.find((c) => c.id === id) || null;

export function mountGraticube(root) {
  injectStyle();
  const app = el('div', 'gtc-app');
  root.append(app);

  // ---- state ----
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let soundOn = loadJSON(SOUND_KEY, true);
  const filters = {};
  const savedF = loadJSON(FILTER_KEY, {});
  for (const g of FILTER_GROUPS) filters[g.key] = new Set(savedF[g.key] || []);
  const selector = makeSelector(filterCards(GRATICUBE_CARDS, filters));
  let spinning = false;
  let card = null;
  let lastWords = null;
  let turnRolled = false;
  let decodeTimer = 0;
  let sigGlyph = null;          // the live cymatic figure on the open transmission
  let journal = loadJSON(JOURNAL_KEY, []);
  let met = new Set(loadJSON(MET_KEY, []));

  // ---- header ----
  const head = el('div', 'gtc-head');
  const brand = el('div', 'gtc-brand');
  const logo = el('img', 'gtc-brand-logo'); logo.src = `${A}/logo-rainbow.png`; logo.alt = '';
  const btxt = el('div', 'gtc-brand-txt');
  btxt.append(el('b', null, 'GRATICUBE'), el('span', null, 'signal array · tune the deep, share what’s true'));
  brand.append(logo, btxt);
  const poolChip = el('button', 'gtc-chip');
  poolChip.type = 'button'; poolChip.title = 'Signal tuning (story filters)';
  poolChip.addEventListener('click', () => openFilters());
  head.append(brand, poolChip);
  app.append(head);

  // ---- main: dial port | transmission bay, reflowing with the lane ----
  const main = el('div', 'gtc-main');
  app.append(main);

  const port = el('div', 'gtc-port');
  const stack = el('div', 'gtc-stack');
  const field = el('canvas', 'gtc-field');
  const dialBox = el('div', 'gtc-dialbox');
  const dialWrap = el('div', 'gtc-dialwrap');
  const svgRoot = sv('svg', { viewBox: '0 0 420 420', class: 'gtc-dial', role: 'img', 'aria-label': 'The resonance dial — two rings of time and emotion' });
  // marker notch at the reading position (12 o'clock)
  svgRoot.append(sv('path', { d: `M${C - 9},6 L${C + 9},6 L${C},24 Z`, class: 'gtc-marker' }));
  const ring12 = makeRing(svgRoot, { labels: GRATICUBE_DICE.space, r1: 152, r2: 198, cls: 'gtc-ring-space' });
  const ring6 = makeRing(svgRoot, { labels: GRATICUBE_DICE.time, r1: 100, r2: 144, cls: 'gtc-ring-time' });
  svgRoot.append(sv('circle', { cx: C, cy: C, r: 92, class: 'gtc-core-rim' }));
  dialWrap.append(svgRoot);
  const core = el('div', 'gtc-core');
  const coreGlyph = el('div', 'gtc-core-glyph', '◈');
  const coreTime = el('div', 'gtc-core-time');
  const coreSpace = el('div', 'gtc-core-space');
  const coreState = el('div', 'gtc-core-state', 'pull & release');
  core.append(coreGlyph, coreTime, coreSpace, coreState);
  dialWrap.append(core);
  dialBox.append(dialWrap);
  const wordsRow = el('div', 'gtc-words');
  const hint = el('div', 'gtc-hint', 'pull the dial & release — or tap it — to tune the array');
  port.append(field, stack, dialBox, wordsRow, hint);
  main.append(port);

  const bay = el('div', 'gtc-bay');
  const cardHost = el('div', 'gtc-card-host');
  const restRow = el('div', 'gtc-rest');
  const circleWrap = el('div', 'gtc-circle-wrap');
  const journalWrap = el('div', 'gtc-journal-wrap');
  bay.append(cardHost, restRow, circleWrap, journalWrap);
  bay.append(el('div', 'gtc-foot', 'played in a room together — the array only carries the signal'));
  main.append(bay);

  const bloomHost = el('div', 'gtc-bloom-host');
  const modalHost = el('div', 'gtc-modal-host');
  const announcer = el('div', 'gtc-sr');
  announcer.setAttribute('aria-live', 'polite');
  app.append(bloomHost, modalHost, announcer);

  // ---- starfield lifecycle (runs while the organ is on screen) ----
  const stars = makeStarfield(field);
  stars.start();
  const ro = new ResizeObserver(() => stars.resize());
  ro.observe(port);

  // ---- focus (proprioception): the chat lane can see the array ----
  function focus(summary) {
    publishFocus({ app: 'graticube', kind: 'organ', label: 'Graticube (the gratitude story game — signal array)', summary });
  }

  function updatePoolChip() {
    const n = selector.poolSize();
    poolChip.textContent = `${n} signal${n === 1 ? '' : 's'} in range`;
    poolChip.classList.toggle('empty', n === 0);
    const narrowed = FILTER_GROUPS.some((g) => filters[g.key].size > 0);
    poolChip.classList.toggle('narrowed', narrowed);
    if (wandBtn) wandBtn.classList.toggle('filtering', narrowed);
  }

  // ---- carrier constellation: eight archetype stars, lit as they visit ----
  const CHAKRA_NAMES = ['Root', 'Sacral', 'Solar Plexus', 'Heart', 'Throat', 'Third Eye', 'Crown', 'Meta'];
  function chakraGradient(n) {
    for (const ch of Object.values(GRATICUBE_CHARACTERS)) if (ch.chakra === n) return ch.gradient;
    return 'none';
  }
  function renderCircle() {
    circleWrap.innerHTML = '';
    circleWrap.append(el('div', 'gtc-k', 'carrier constellation'));
    const row = el('div', 'gtc-circle');
    for (let n = 1; n <= 8; n++) {
      const dot = el('button', 'gtc-cstar' + (met.has(n) ? ' met' : ''), '✦');
      dot.type = 'button';
      if (met.has(n)) { dot.style.backgroundImage = chakraGradient(n); }
      const names = Object.values(GRATICUBE_CHARACTERS).filter((c) => c.chakra === n).map((c) => c.name);
      dot.title = `${CHAKRA_NAMES[n - 1]} — ${names.join(' / ')}${met.has(n) ? '' : ' · not yet heard'} · open dossier`;
      dot.setAttribute('aria-label', dot.title);
      dot.addEventListener('click', () => openCarrier(n));
      row.append(dot);
    }
    circleWrap.append(row);
    const full = met.size === 8;
    const sub = el('div', 'gtc-ksub', full
      ? 'all eight carriers heard — a Gift Round is calling'
      : `${met.size} of 8 carriers have reached this table`);
    if (full) { sub.classList.add('gtc-full'); sub.style.cursor = 'pointer'; sub.addEventListener('click', openGift); }
    circleWrap.append(sub);
  }

  // ---- signal log: recent turns, this device only ----
  function renderJournal() {
    journalWrap.innerHTML = '';
    if (!journal.length) return;
    journalWrap.append(el('div', 'gtc-k', 'signal log · on this device'));
    const row = el('div', 'gtc-jrow');
    journal.slice(0, 10).forEach((e) => {
      const c = cardById(e.id); if (!c) return;
      const ch = GRATICUBE_CHARACTERS[c.character_key];
      const chip = el('button', 'gtc-jchip'); chip.type = 'button';
      chip.append(el('b', null, `${e.time} · ${e.space}`), el('span', null, ch.name));
      chip.title = c.prompt;
      chip.addEventListener('click', () => { if (!spinning && !card) { lastWords = { time: e.time, space: e.space }; presentCard(c, false); } });
      row.append(chip);
    });
    journalWrap.append(row);
  }

  function renderRest() {
    restRow.innerHTML = '';
    if (card) { restRow.style.display = 'none'; return; }
    restRow.style.display = '';
    restRow.append(el('div', 'gtc-rest-glyph', '⟟'));
    restRow.append(el('div', 'gtc-rest-line', 'the array is listening'));
    restRow.append(el('div', 'gtc-rest-sub', 'a spin tunes the array — the signal that answers is for whoever pulled'));
    restRow.append(el('div', 'gtc-rest-tip', 'table mode: grow the canvas with the corner buttons (or [ and ])'));
  }

  // ---- spinning the dial ----
  let raf = 0;
  function spin(vx) {
    if (spinning || card) return;                   // locked while a transmission is open
    spinning = true;
    port.classList.add('spinning');
    stars.setWarp(1);
    hint.classList.add('hide');
    wordsRow.classList.remove('show');
    ring6.setLit(-1); ring12.setLit(-1);
    coreTime.textContent = ''; coreSpace.textContent = '';
    coreGlyph.textContent = '◈';
    coreState.textContent = 'tuning…';
    const power = Math.min(2.4, 0.8 + Math.abs(vx) * 1.1);
    const dir = vx >= 0 ? 1 : -1;
    ring12.launch(dir * (330 + Math.random() * 320) * power);
    ring6.launch(-dir * (260 + Math.random() * 260) * power);
    focus('The resonance dial is spinning…');

    const t0 = performance.now();
    const minMs = reduced ? 300 : 850;
    let locking = null;          // { L6, L12 } lock targets once the spin decays
    let glide = 0;
    let last = t0;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!locking) {
        const s1 = ring12.step_(dt, reduced ? 5 : 1.5);
        const s2 = ring6.step_(dt, reduced ? 5 : 1.5);
        if (now - t0 > minMs && Math.max(s1, s2) < 28) {
          locking = { L6: ring6.lockTarget(), L12: ring12.lockTarget() };
          glide = 0;
        }
      } else {
        glide = Math.min(1, glide + dt / 0.5);
        const e = 1 - Math.pow(1 - glide, 3);
        ring6.glide(locking.L6.from, locking.L6.target, e);
        ring12.glide(locking.L12.from, locking.L12.target, e);
        if (glide >= 1) { locked(locking.L6.k, locking.L12.k); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function locked(k6, k12) {
    const time = ring6.labels[k6];
    const space = ring12.labels[k12];
    lastWords = { time, space };
    ring6.setLit(k6); ring12.setLit(k12);
    stars.setWarp(0);
    coreGlyph.textContent = '';
    coreTime.textContent = time;
    coreSpace.textContent = space;
    coreState.textContent = 'decoding transmission…';
    core.classList.add('decoding');
    wordsRow.innerHTML = '';
    wordsRow.append(el('span', 'gtc-pill', `TIME · ${time}`), el('span', 'gtc-pill', `FREQ · ${space}`));
    wordsRow.classList.add('show');
    announcer.textContent = `Dial locked. Time: ${time}. Emotion: ${space}.`;
    focus(`Dial locked: TIME "${time}" · EMOTION "${space}". Decoding the transmission…`);
    setTimeout(() => {
      spinning = false;
      port.classList.remove('spinning');
      core.classList.remove('decoding');
      coreState.textContent = 'channel open';
      const c = selector.next();
      if (c) presentCard(c, true);
      else presentEmpty();
    }, reduced ? 350 : 1500);
  }

  // ---- input: pull/flick, tap, keyboard ----
  let drag = null;
  dialBox.addEventListener('pointerdown', (e) => {
    if (spinning || card) return;
    drag = { x: e.clientX, t: performance.now() };
    try { dialBox.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  });
  dialBox.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const dt = Math.max(16, performance.now() - drag.t);
    const vx = (e.clientX - drag.x) / dt;
    drag = null;
    spin(Math.abs(vx) < 0.05 ? (Math.random() - 0.5) * 1.6 : vx);
  });
  dialBox.addEventListener('pointercancel', () => { drag = null; });
  dialBox.tabIndex = 0;
  dialBox.setAttribute('role', 'button');
  dialBox.setAttribute('aria-label', 'Spin the resonance dial');
  dialBox.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); spin((Math.random() - 0.5) * 1.6); }
  });

  // ---- the transmission ----
  function typeInto(node, text) {
    clearInterval(decodeTimer);
    if (reduced) { node.textContent = text; return; }
    node.textContent = '';
    let i = 0;
    const per = Math.max(1, Math.ceil(text.length / 46));
    decodeTimer = setInterval(() => {
      i = Math.min(text.length, i + per);
      node.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(decodeTimer);
    }, 16);
  }

  function presentCard(c, fromRoll) {
    const ch = GRATICUBE_CHARACTERS[c.character_key];
    turnRolled = fromRoll;
    if (fromRoll) {
      journal.unshift({ id: c.id, time: lastWords?.time, space: lastWords?.space, ts: Date.now() });
      journal = journal.slice(0, 24);
      saveJSON(JOURNAL_KEY, journal);
      if (!met.has(ch.chakra)) { met.add(ch.chakra); saveJSON(MET_KEY, [...met]); }
    }
    cardHost.innerHTML = '';
    const box = el('div', 'gtc-card');
    box.style.setProperty('--gtc-grad', ch.gradient);
    const bg = el('div', 'gtc-card-chakra');
    bg.style.backgroundImage = `url(${A}/chakra-${ch.chakra}.png)`;
    box.append(bg, el('div', 'gtc-card-band'));

    const tele = el('div', 'gtc-card-tele');
    tele.append(
      el('span', 'gtc-tele-tag', '⟟ incoming transmission'),
      el('span', 'gtc-tele-id', `sig ${c.id}`),
    );
    box.append(tele);
    // the signal glyph — the system's own cymatic renderer, seeded by THIS
    // turn's signature. A portrait, not a meter: clarity is a fixed pleasant
    // constant until the owner's coherence system decides what it means.
    const glyphCanvas = el('canvas', 'gtc-sigglyph');
    glyphCanvas.title = 'this turn’s signal glyph — its signature drawn as a standing wave';
    box.append(glyphCanvas);
    if (lastWords) {
      const pills = el('div', 'gtc-card-pills');
      pills.append(el('span', 'gtc-pill', `TIME · ${lastWords.time}`), el('span', 'gtc-pill', `FREQ · ${lastWords.space}`));
      box.append(pills);
    }
    const promptEl = el('div', 'gtc-card-prompt');
    box.append(promptEl);
    box.append(el('div', 'gtc-card-char', `Character: ${ch.name}`));
    box.append(el('div', 'gtc-card-sub', ch.sub));

    const chips = el('div', 'gtc-card-chips');
    const lbl = (key, v) => (FILTER_GROUPS.find((g) => g.key === key)?.labels || {})[v] || v;
    [lbl('depth', c.depth), lbl('complexity', c.complexity), c.audience, c.context, c.energy, GRATICUBE_DECKS[c.source_decks[0]]?.label]
      .filter(Boolean).forEach((v) => chips.append(el('span', 'gtc-chipmini', v)));
    box.append(chips);

    const row = el('div', 'gtc-card-actions');
    const next = el('button', 'gtc-next'); next.type = 'button'; next.textContent = 'Next turn';
    next.addEventListener('click', closeCard);
    const ask = el('button', 'gtc-ask'); ask.type = 'button'; ask.textContent = 'ask Auma to play too';
    ask.title = 'Auma answers this prompt in the chat lane, like a player at the table';
    ask.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('aukora:ask', {
        detail: {
          text: `Auma — we're playing Graticube and it's your turn. The dial locked TIME: "${lastWords?.time || '—'}" and EMOTION: "${lastWords?.space || '—'}". Your prompt (as ${ch.name} — ${ch.sub}):\n\n"${c.prompt}"\n\nAnswer as yourself, honestly and briefly, like a player in the room. Then hand the turn back.`,
        },
      }));
    });
    // the deeper door: Auma facilitates YOUR share instead of taking a turn —
    // she holds the space, reflects what she heard, and asks one follow-up.
    const deeper = el('button', 'gtc-ask'); deeper.type = 'button'; deeper.textContent = 'go deeper with Auma';
    deeper.title = 'Auma facilitates your share — she listens, reflects, and asks one gentle follow-up';
    deeper.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('aukora:ask', {
        detail: {
          text: `Auma — I'm playing Graticube and I want to go deeper on my turn. The dial locked TIME: "${lastWords?.time || '—'}" and EMOTION: "${lastWords?.space || '—'}". My prompt, carried by ${ch.name} (${ch.sub}):\n\n"${c.prompt}"\n\nBe my facilitator, not a player. First, invite me to share my answer — out loud to the room or here in words. When I share, listen closely: reflect back what you actually heard in my own words, notice where the time word "${lastWords?.time || ''}" or the feeling "${lastWords?.space || ''}" lives inside it, and then ask me ONE gentle follow-up question. Keep it warm and brief — this game is for real connection, not analysis.`,
        },
      }));
    });
    row.append(next, ask, deeper);
    box.append(row);

    cardHost.append(box);
    card = box;
    if (sigGlyph) { sigGlyph.destroy(); sigGlyph = null; }
    try {
      sigGlyph = createGlyph(glyphCanvas, {
        signature: `${c.id}|${lastWords?.time || ''}|${lastWords?.space || ''}`,
        coherence: 0.62,   // a fixed, pleasant clarity — NOT a measurement (see header note)
        modes: 5,
      });
    } catch { /* the glyph is a gift, never a crash */ }
    renderRest(); renderCircle(); renderJournal();
    requestAnimationFrame(() => box.classList.add('in'));
    typeInto(promptEl, c.prompt);
    box.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    announcer.textContent = `Your prompt, as ${ch.name}: ${c.prompt}`;
    focus(`Transmission open — TIME "${lastWords?.time}", EMOTION "${lastWords?.space}". Character: ${ch.name} (${ch.sub}) Prompt: "${c.prompt}" [${c.depth} ${c.complexity} ${c.audience} ${c.context} ${c.energy}]`);
  }

  function presentEmpty() {
    cardHost.innerHTML = '';
    const empty = el('div', 'gtc-card gtc-card-empty');
    empty.append(
      el('div', 'gtc-card-prompt', 'No signals in range for this tuning.'),
      el('div', 'gtc-empty-sub', 'Open signal tuning and loosen a band — every group left empty means “all.”'),
    );
    const fix = el('button', 'gtc-next'); fix.type = 'button'; fix.textContent = 'Open tuning';
    fix.addEventListener('click', () => { closeCard(); openFilters(); });
    empty.append(fix);
    cardHost.append(empty);
    card = empty;
    turnRolled = false;
    renderRest();
    requestAnimationFrame(() => empty.classList.add('in'));
  }

  function closeCard() {
    if (!card) return;
    clearInterval(decodeTimer);
    if (sigGlyph) { sigGlyph.destroy(); sigGlyph = null; }
    const b = card; card = null;
    b.classList.remove('in');
    setTimeout(() => b.remove(), 280);
    hint.classList.remove('hide');
    coreState.textContent = 'pull & release';
    coreGlyph.textContent = '◈';
    coreTime.textContent = ''; coreSpace.textContent = '';
    renderRest();
    // OWNER-DIRECTED (2026-07-07): a completed turn awards NOTHING. The
    // round-2 AURA tie-in is withdrawn — this game will register through the
    // coherence system the owner is still shaping, not the aura tally. Until
    // that lands, a turn's only record is the signal log.
    turnRolled = false;
    focus('Between turns — the array is listening.');
  }

  // ---- resonance (gratitude) ----
  function gratitude() {
    if (soundOn) harpBloom();
    if (sigGlyph) sigGlyph.pulseNow();   // the turn's glyph rings with the room
    if (card) { card.classList.add('glow'); setTimeout(() => card && card.classList.remove('glow'), 1600); }
    const n = reduced ? 6 : 16;
    const tones = ['#e35d75', '#ff8fa3', '#9d8cff', '#7fd4c1'];
    for (let i = 0; i < n; i++) {
      const h = el('div', 'gtc-heart');
      h.textContent = i % 3 === 2 ? '✦' : '❤';
      const tone = tones[i % tones.length];
      h.style.color = tone;
      h.style.textShadow = `0 0 16px ${tone}cc, 0 0 34px ${tone}66`;
      h.style.left = 5 + Math.random() * 90 + '%';
      h.style.top = 8 + Math.random() * 82 + '%';
      h.style.fontSize = 20 + Math.random() * 42 + 'px';
      h.style.animationDelay = Math.random() * 0.45 + 's';
      h.style.setProperty('--drift', (Math.random() * 2 - 1) * 60 + 'px');
      bloomHost.append(h);
      setTimeout(() => h.remove(), 2600);
    }
    const ty = el('div', 'gtc-thankyou', 'thank you');
    bloomHost.append(ty);
    requestAnimationFrame(() => ty.classList.add('in'));
    setTimeout(() => { ty.classList.remove('in'); setTimeout(() => ty.remove(), 500); }, 1700);
  }

  // ---- modals (Sam's game text verbatim; sci-fi chrome) ----
  function modal(cls, build) {
    modalHost.innerHTML = '';
    const back = el('div', 'gtc-back');
    const box = el('div', 'gtc-modal ' + cls);
    const x = el('button', 'gtc-x'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    x.addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    box.append(x);
    build(box, close);
    back.append(box);
    modalHost.append(back);
    return close;
  }

  function openHowTo() {
    modal('gtc-m-howto', (box) => {
      const img = el('img', 'gtc-howto-logo'); img.src = `${A}/gc-logo.png`; img.alt = 'Graticube';
      box.append(img, el('h3', null, 'How to Play'));
      const ol = el('ol', 'gtc-howto-list');
      [
        'Spin the time & emotion rings and see what locks in! (We’ll come back to them later.)',
        'A prompt will appear. Consider your question/prompt…what comes to mind? (yes, that thought)',
        'Share what is true for you. (Consider how the character may play a role.)',
        'Other players may choose to ask a question or share a gratitude during your share. You can too.',
        'Before you finish your turn, come back to look at the locked rings. Did they make their way into your story? How might they relate to what you shared?',
      ].forEach((s) => ol.append(el('li', null, s)));
      box.append(ol);
      const foot = el('div', 'gtc-howto-foot');
      const a1 = el('a', null, 'Graticube'); a1.href = 'https://www.graticube.game'; a1.target = '_blank'; a1.rel = 'noopener';
      const a2 = el('a', null, 'Contact'); a2.href = 'mailto:us@graticube.game';
      foot.append(a1, document.createTextNode(' © 2020-2026 | '), a2);
      box.append(foot);
    });
  }

  function openCuriosity() {
    modal('gtc-m-curiosity', (box) => {
      box.append(el('h3', null, 'Are you open to my curiosity?'));
      ['Would you be willing to share more?',
       'Is there any advice for yourself or action you might take?',
       'Can I tell you what I felt or noticed?',
       'Can I ask you an open question?'].forEach((s) => box.append(el('p', 'gtc-curiosity-line', s)));
    });
  }

  // one carrier, both of its faces — the dossier behind each constellation star
  function openCarrier(n) {
    const faces = Object.entries(GRATICUBE_CHARACTERS).filter(([, ch]) => ch.chakra === n);
    if (!faces.length) return;
    modal('gtc-m-carrier', (box) => {
      const sigil = el('img', 'gtc-carrier-sigil'); sigil.src = `${A}/chakra-${n}.png`; sigil.alt = '';
      box.append(sigil);
      box.append(el('h3', null, `${CHAKRA_NAMES[n - 1]} carrier`));
      box.append(el('p', 'gtc-carrier-note', met.has(n)
        ? 'this carrier has reached your table'
        : 'not yet heard on this table — its card will come'));
      for (const [, ch] of faces) {
        const face = el('div', 'gtc-carrier-face');
        face.style.setProperty('--gtc-grad', ch.gradient);
        face.append(el('div', 'gtc-carrier-band'));
        face.append(el('b', null, ch.name));
        face.append(el('span', null, ch.sub));
        const fw = ch.framework === 'both' ? 'both frameworks' : `${ch.framework} framework`;
        face.append(el('i', null, fw));
        box.append(face);
      }
      box.append(el('p', 'gtc-carrier-gift', 'in the Gift Round, players choose the carrier that best matches how they played'));
    });
  }

  function openGift() {
    modal('gtc-m-gift', (box) => {
      box.append(el('h3', null, 'The Gift Round'));
      box.append(el('p', 'gtc-gift-text',
        'Start with the first player. Each person (including the first player) will pick a character that best represents how they played. Share what you chose and why, then go to the next player. Repeat until complete.'));
      const img = el('img', 'gtc-gift-img'); img.src = `${A}/character-reference.jpg`; img.alt = 'The Graticube characters';
      box.append(img);
    });
  }

  function openFilters() {
    modal('gtc-m-filters', (box, close) => {
      box.append(el('h3', null, 'Signal Tuning'));
      box.append(el('p', 'gtc-filter-legend', 'Depth = emotional challenge. Complexity = reading/parsing difficulty. A band left empty means “all.”'));
      const liveChip = el('div', 'gtc-chip gtc-filter-live');
      const body = el('div', 'gtc-filter-body');

      const render = () => {
        body.innerHTML = '';
        const counts = optionCounts(GRATICUBE_CARDS, filters);
        for (const g of FILTER_GROUPS) {
          const grp = el('div', 'gtc-fgroup');
          grp.append(el('div', 'gtc-fgroup-k', g.label));
          const row = el('div', 'gtc-fgroup-row');
          for (const v of g.values) {
            const n = counts[g.key][v];
            const on = filters[g.key].has(v);
            const b = el('button', 'gtc-fchip' + (on ? ' on' : ''));
            b.type = 'button';
            const label = g.key === 'deck' ? (GRATICUBE_DECKS[v]?.label || v) : ((g.labels || {})[v] || v);
            b.textContent = `${label} (${n})`;
            if (n === 0 && !on) b.disabled = true;
            b.addEventListener('click', () => {
              on ? filters[g.key].delete(v) : filters[g.key].add(v);
              apply(); render();
            });
            row.append(b);
          }
          grp.append(row);
          body.append(grp);
        }
        const total = filterCards(GRATICUBE_CARDS, filters).length;
        liveChip.textContent = `${total} signal${total === 1 ? '' : 's'} in range`;
        liveChip.classList.toggle('empty', total === 0);
      };
      const apply = () => {
        selector.setPool(filterCards(GRATICUBE_CARDS, filters));
        const out = {}; for (const g of FILTER_GROUPS) out[g.key] = [...filters[g.key]];
        saveJSON(FILTER_KEY, out);
        updatePoolChip();
      };

      const foot = el('div', 'gtc-filter-foot');
      const clear = el('button', 'gtc-fclear'); clear.type = 'button'; clear.textContent = 'Clear all';
      clear.addEventListener('click', () => { for (const g of FILTER_GROUPS) filters[g.key].clear(); apply(); render(); });
      const done = el('button', 'gtc-next'); done.type = 'button'; done.textContent = 'Done';
      done.addEventListener('click', close);
      foot.append(clear, liveChip, done);

      box.append(body, foot);
      render();
    });
  }

  // ---- the tool rail (icon-first, per the brief) ----
  const svg = (paths, vb = '0 0 16 16') =>
    `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const ICONS = {
    help: svg('<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.1a1.9 1.9 0 1 1 2.7 1.8c-.7.3-.9.8-.9 1.5"/><circle cx="8" cy="11.6" r="0.5" fill="currentColor"/>'),
    heart: svg('<path d="M8 13.4 3.1 8.6a3 3 0 0 1 0-4.2 2.9 2.9 0 0 1 4.2 0l.7.7.7-.7a2.9 2.9 0 0 1 4.2 0 3 3 0 0 1 0 4.2Z"/>'),
    bell: svg('<path d="M8 2.2a3.8 3.8 0 0 1 3.8 3.8c0 3 .9 4 .9 4H3.3s.9-1 .9-4A3.8 3.8 0 0 1 8 2.2Z"/><path d="M6.7 12.6a1.4 1.4 0 0 0 2.6 0"/>'),
    bellOff: svg('<path d="M8 2.2a3.8 3.8 0 0 1 3.8 3.8c0 3 .9 4 .9 4H3.3s.9-1 .9-4A3.8 3.8 0 0 1 8 2.2Z"/><path d="M6.7 12.6a1.4 1.4 0 0 0 2.6 0"/><path d="M2.5 2.5l11 11"/>'),
    comment: svg('<path d="M2.5 3.5h11v7h-6l-3 3v-3h-2Z"/>'),
    gift: svg('<rect x="2.5" y="6" width="11" height="7.5" rx="0.8"/><path d="M8 6v7.5M2.5 9h11"/><path d="M8 6C8 6 5.5 6 4.8 4.9 4.2 4 4.9 2.7 6 2.8 7.6 3 8 6 8 6Zm0 0s2.5 0 3.2-1.1c.6-.9-.1-2.2-1.2-2.1C8.4 3 8 6 8 6Z"/>'),
    wand: svg('<path d="M12.8 3.2 4 12"/><path d="m11 2 .5 1.5L13 4l-1.5.5L11 6l-.5-1.5L9 4l1.5-.5Z"/><path d="M4.2 8.4l.3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3Z"/><path d="M13 9.5l.3.8.8.3-.8.3-.3.8-.3-.8-.8-.3.8-.3Z"/>'),
  };
  const soundBtn = el('button', 'gtc-tool');
  const setSoundIcon = () => {
    soundBtn.innerHTML = soundOn ? ICONS.bell : ICONS.bellOff;
    soundBtn.title = soundOn ? 'Resonance sound: on' : 'Resonance sound: off';
    soundBtn.setAttribute('aria-label', soundBtn.title);
    soundBtn.classList.toggle('off', !soundOn);
  };
  setSoundIcon();
  soundBtn.type = 'button';
  soundBtn.addEventListener('click', () => { soundOn = !soundOn; saveJSON(SOUND_KEY, soundOn); setSoundIcon(); if (soundOn) harpBloom(); });

  const tool = (icon, title, fn, cls) => {
    const b = el('button', 'gtc-tool' + (cls ? ' ' + cls : ''));
    b.type = 'button'; b.innerHTML = icon; b.title = title; b.setAttribute('aria-label', title);
    b.addEventListener('click', fn);
    return b;
  };
  const wandBtn = tool(ICONS.wand, 'Signal Tuning (story filters)', openFilters);
  stack.append(
    tool(ICONS.help, 'How to Play', openHowTo),
    tool(ICONS.heart, 'Send resonance — hearts for the storyteller', gratitude, 'gtc-tool-heart'),
    soundBtn,
    tool(ICONS.comment, 'Are you open to my curiosity?', openCuriosity),
    tool(ICONS.gift, 'The Gift Round', openGift),
    wandBtn,
  );

  updatePoolChip();
  renderRest();
  renderCircle();
  renderJournal();
  focus('In Graticube (signal array) — the dial is idle, no transmission open.');
}

// ---------------------------------------------------------------------------
// style — deep-space glass over the trinity gradient. Container queries
// reflow the organ across the 1/3 · 2/3 · full lane; the dial is SVG, so it
// scales without a seam at any width.
// ---------------------------------------------------------------------------
let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .gtc-app { --gtc-o: 231, 138, 155; container-type:inline-size; position:absolute; inset:0;
    display:flex; flex-direction:column; overflow:hidden; color:var(--text); }

  .gtc-head { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 4px; flex:none; }
  .gtc-brand { display:flex; align-items:center; gap:11px; }
  .gtc-brand-logo { width:30px; height:30px; border-radius:8px; }
  .gtc-brand-txt { display:flex; flex-direction:column; }
  .gtc-brand-txt b { font-size:15px; letter-spacing:0.16em; }
  .gtc-brand-txt span { font-size:11.5px; color:rgba(244,246,255,0.5); }
  .gtc-chip { font:inherit; font-size:11.5px; color:rgba(var(--hue-r),0.95); background:rgba(var(--hue-r),0.10);
    border:1px solid rgba(var(--hue-r),0.35); padding:3px 11px; border-radius:99px; white-space:nowrap; }
  button.gtc-chip { cursor:pointer; transition:all .18s; }
  button.gtc-chip:hover { background:rgba(var(--hue-r),0.2); }
  .gtc-chip.empty { color:#ffb3a7; border-color:#b6553f88; background:#b6553f22; }
  .gtc-chip.narrowed { border-style:dashed; }
  .gtc-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }

  .gtc-main { flex:1; min-height:0; display:grid; grid-template-columns:1fr; grid-template-rows:auto 1fr;
    overflow-y:auto; overflow-x:hidden; }
  @container (min-width:860px) {
    .gtc-main { grid-template-columns:11fr 9fr; grid-template-rows:1fr; overflow:hidden; } }

  .gtc-port { position:relative; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:12px; min-height:0; padding:12px 16px 18px 64px; }
  .gtc-field { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; opacity:0.8; }
  .gtc-stack { position:absolute; left:14px; top:50%; transform:translateY(-50%); z-index:3;
    display:flex; flex-direction:column; gap:8px; }
  .gtc-tool { position:relative; width:38px; height:38px; border-radius:12px; border:1px solid rgba(255,255,255,0.13);
    background:rgba(17,21,32,0.55); color:rgba(244,246,255,0.75); cursor:pointer;
    display:grid; place-items:center; transition:all .18s; backdrop-filter:blur(3px); }
  .gtc-tool.filtering::after { content:''; position:absolute; top:-3px; right:-3px; width:9px; height:9px;
    border-radius:50%; background:rgba(var(--hue-r),1); box-shadow:0 0 8px rgba(var(--hue-r),0.8); }
  .gtc-tool svg { width:19px; height:19px; }
  .gtc-tool:hover { background:rgba(255,255,255,0.12); color:#fff; transform:translateY(-1px); }
  .gtc-tool-heart { color:rgba(var(--gtc-o),0.95); border-color:rgba(var(--gtc-o),0.35); }
  .gtc-tool-heart:hover { background:rgba(var(--gtc-o),0.14); color:#ff9fb0; }
  .gtc-tool.off { opacity:0.55; }

  .gtc-dialbox { position:relative; z-index:1; cursor:grab; touch-action:none; user-select:none;
    -webkit-user-select:none; outline:none; border-radius:50%;
    width:min(78cqw, 380px); aspect-ratio:1; }
  @container (min-width:520px)  { .gtc-dialbox { width:min(62cqw, 440px); } }
  @container (min-width:860px)  { .gtc-dialbox { width:min(46cqw, 520px); } }
  @container (min-width:1150px) { .gtc-dialbox { width:min(42cqw, 620px); } }
  .gtc-dialbox:focus-visible { box-shadow:0 0 0 2px rgba(var(--hue-r),0.7); }
  .gtc-dialbox:active { cursor:grabbing; }
  .gtc-dialwrap { position:relative; width:100%; height:100%; }
  .gtc-dial { width:100%; height:100%; display:block; filter:drop-shadow(0 0 26px rgba(var(--hue-r),0.14)); }
  .gtc-marker { fill:rgba(var(--gtc-o),0.95); filter:drop-shadow(0 0 6px rgba(var(--gtc-o),0.8)); }
  .gtc-sector { fill:rgba(255,255,255,0.028); stroke:rgba(196,170,255,0.22); stroke-width:1; transition:fill .3s; }
  .gtc-ring-time .gtc-sector { stroke:rgba(150,180,255,0.26); }
  .gtc-sector.lit { fill:rgba(var(--gtc-o),0.22); stroke:rgba(var(--gtc-o),0.9); stroke-width:1.6;
    filter:drop-shadow(0 0 9px rgba(var(--gtc-o),0.6)); }
  .gtc-ring-word { font-size:13px; font-weight:600; letter-spacing:0.05em; fill:rgba(244,246,255,0.72);
    pointer-events:none; }
  .gtc-ring-time .gtc-ring-word { font-size:14px; fill:rgba(190,208,255,0.8); }
  .gtc-ring { transition:none; }
  .gtc-core-rim { fill:rgba(13,16,26,0.72); stroke:rgba(var(--hue-r),0.4); stroke-width:1.2; }
  .gtc-core { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:40%;
    display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
    text-align:center; pointer-events:none; }
  .gtc-core-glyph { font-size:26px; color:rgba(var(--hue-r),0.8); animation:gtc-pulse 4s ease-in-out infinite; }
  .gtc-core-time { font-size:clamp(14px, 4.4cqw, 22px); font-weight:700; color:rgba(190,208,255,0.95); }
  .gtc-core-space { font-size:clamp(15px, 4.8cqw, 24px); font-weight:700; color:rgba(var(--gtc-o),0.98);
    letter-spacing:0.03em; }
  .gtc-core-state { font-size:10px; letter-spacing:0.16em; text-transform:uppercase;
    color:rgba(244,246,255,0.42); margin-top:5px; font-family:ui-monospace, SFMono-Regular, monospace; }
  .gtc-core.decoding .gtc-core-state { color:rgba(var(--gtc-o),0.9); animation:gtc-pulse 0.9s ease-in-out infinite; }
  @keyframes gtc-pulse { 0%,100% { opacity:0.45; } 50% { opacity:1; } }
  .gtc-port.spinning .gtc-core-glyph { animation-duration:0.8s; }

  .gtc-words { display:flex; gap:8px; align-items:center; min-height:28px; opacity:0; transform:translateY(4px);
    transition:all .4s ease; z-index:1; }
  .gtc-words.show { opacity:1; transform:none; }
  .gtc-pill { background:rgba(132,95,138,0.9); color:#fff; font-size:11.5px; font-weight:600; padding:4px 12px;
    border-radius:99px; letter-spacing:0.07em; box-shadow:0 0 14px #845f8a66;
    font-family:ui-monospace, SFMono-Regular, monospace; }
  .gtc-hint { font-size:12px; color:rgba(244,246,255,0.45); transition:opacity .3s; z-index:1; }
  .gtc-hint.hide { opacity:0; }

  .gtc-bay { min-height:0; display:flex; flex-direction:column; gap:18px; padding:8px 22px 24px; }
  @container (min-width:860px) { .gtc-bay { overflow-y:auto; padding-top:16px;
    border-left:1px solid rgba(255,255,255,0.07); } }
  .gtc-k { font-size:10.5px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase;
    color:rgba(var(--hue-r),0.85); }
  .gtc-ksub { font-size:11.5px; color:rgba(244,246,255,0.45); margin-top:6px; }
  .gtc-ksub.gtc-full { color:rgba(var(--gtc-o),0.95); }

  .gtc-rest { display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center;
    padding:26px 12px 10px; }
  .gtc-rest-glyph { font-size:24px; color:rgba(var(--hue-r),0.55); animation:gtc-pulse 4s ease-in-out infinite; }
  .gtc-rest-line { font-size:14px; font-weight:600; color:rgba(244,246,255,0.75); letter-spacing:0.04em; }
  .gtc-rest-sub { font-size:12px; color:rgba(244,246,255,0.42); max-width:310px; }
  .gtc-rest-tip { font-size:10.5px; color:rgba(var(--hue-r),0.6); margin-top:10px; letter-spacing:0.05em;
    font-family:ui-monospace, SFMono-Regular, monospace; }
  @container (min-width:860px) { .gtc-rest-tip { display:none; } }

  .gtc-sigglyph { position:absolute; top:34px; right:16px; width:62px; height:62px; border-radius:50%;
    border:1px solid rgba(var(--hue-r),0.25); background:rgba(0,0,0,0.25); }
  @container (max-width:519px) { .gtc-sigglyph { width:50px; height:50px; top:38px; right:12px; } }

  .gtc-m-carrier { text-align:center; }
  .gtc-carrier-sigil { width:120px; height:120px; object-fit:contain; display:block; margin:2px auto 8px;
    filter:drop-shadow(0 0 18px rgba(var(--gtc-o),0.35)); }
  .gtc-carrier-note { font-size:11px; letter-spacing:0.12em; text-transform:uppercase;
    color:rgba(var(--gtc-o),0.85); margin:0 0 14px; font-family:ui-monospace, SFMono-Regular, monospace; }
  .gtc-carrier-face { position:relative; text-align:left; border:1px solid rgba(255,255,255,0.12);
    border-radius:12px; padding:12px 14px 12px 18px; margin:8px 0; overflow:hidden;
    display:flex; flex-direction:column; gap:2px; background:rgba(255,255,255,0.03); }
  .gtc-carrier-band { position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--gtc-grad); }
  .gtc-carrier-face b { font-size:14px; color:#fff; }
  .gtc-carrier-face span { font-size:12.5px; color:rgba(244,246,255,0.65); }
  .gtc-carrier-face i { font-size:10.5px; color:rgba(244,246,255,0.4); font-style:normal;
    letter-spacing:0.08em; text-transform:uppercase; margin-top:3px; }
  .gtc-carrier-gift { font-size:12px; color:rgba(244,246,255,0.5); margin:12px 0 0; }

  .gtc-card-host { width:100%; max-width:600px; margin:0 auto; }
  .gtc-card { position:relative; border-radius:16px; overflow:hidden;
    background:rgba(15,18,30,0.82); color:rgba(244,246,255,0.9);
    border:1px solid rgba(var(--hue-r),0.28); backdrop-filter:blur(6px);
    padding:16px 20px 16px; box-shadow:0 0 40px rgba(var(--hue-r),0.10), 0 18px 50px #00000066;
    opacity:0; transform: translateY(14px) scale(0.98); transition: all .32s cubic-bezier(.2,.9,.3,1.2); }
  .gtc-card.in { opacity:1; transform:none; }
  .gtc-card.glow { box-shadow:0 0 0 2px rgba(var(--gtc-o),0.7), 0 0 60px rgba(var(--gtc-o),0.3), 0 18px 50px #00000066; }
  .gtc-card-band { position:absolute; top:0; left:0; right:0; height:3px; background:var(--gtc-grad, #845f8a);
    filter:saturate(1.4) brightness(1.35); }
  .gtc-card-chakra { position:absolute; inset:0; background-size:56%; background-repeat:no-repeat;
    background-position: right -10% center; opacity:0.13; pointer-events:none; filter:saturate(1.2); }
  .gtc-card-tele { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;
    font-family:ui-monospace, SFMono-Regular, monospace; position:relative; }
  .gtc-tele-tag { font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:rgba(var(--gtc-o),0.9); }
  .gtc-tele-id { font-size:10px; letter-spacing:0.08em; color:rgba(244,246,255,0.35); }
  .gtc-card-pills { display:flex; gap:8px; margin-bottom:12px; position:relative; }
  .gtc-card-prompt { font-size:19px; line-height:1.45; font-weight:600; color:#fff; position:relative;
    min-height:1.45em; text-shadow:0 0 24px rgba(var(--hue-r),0.25); }
  .gtc-card-char { margin-top:14px; font-size:13px; font-weight:700; color:rgba(var(--gtc-o),0.95); position:relative; }
  .gtc-card-sub { font-size:12.5px; color:rgba(244,200,190,0.75); margin-top:2px; position:relative; }
  .gtc-card-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; position:relative; }
  .gtc-chipmini { font-size:10px; color:rgba(244,246,255,0.55); background:rgba(255,255,255,0.05);
    border:1px solid rgba(255,255,255,0.12); padding:2px 8px; border-radius:99px;
    font-family:ui-monospace, SFMono-Regular, monospace; letter-spacing:0.04em; }
  .gtc-card-actions { display:flex; gap:12px; align-items:center; margin-top:16px; position:relative; }
  .gtc-next { background:rgba(var(--hue-r),0.16); color:rgba(var(--hue-r),0.98);
    border:1px solid rgba(var(--hue-r),0.5); font-size:13px; font-weight:600;
    padding:9px 22px; border-radius:12px; cursor:pointer; transition:all .18s; letter-spacing:0.04em; }
  .gtc-next:hover { background:rgba(var(--hue-r),0.28); transform:translateY(-1px);
    box-shadow:0 0 18px rgba(var(--hue-r),0.3); }
  .gtc-ask { background:none; border:0; color:rgba(244,246,255,0.5); font-size:12px; cursor:pointer;
    text-decoration:underline dotted; }
  .gtc-ask:hover { color:rgba(244,246,255,0.85); }
  .gtc-card-empty { text-align:center; }
  .gtc-empty-sub { font-size:13px; color:rgba(244,246,255,0.5); margin:8px 0 14px; }

  .gtc-circle { display:flex; gap:10px; margin-top:8px; }
  .gtc-cstar { width:22px; height:22px; display:grid; place-items:center; font-size:15px;
    color:rgba(255,255,255,0.16); transition:all .3s; background:none; border:0; padding:0; cursor:pointer; }
  .gtc-cstar:hover { transform:scale(1.25); color:rgba(255,255,255,0.4); }
  .gtc-cstar.met { color:transparent; background-clip:text; -webkit-background-clip:text;
    filter:drop-shadow(0 0 7px rgba(var(--gtc-o),0.45)); }

  .gtc-jrow { display:flex; flex-wrap:wrap; gap:7px; margin-top:8px; }
  .gtc-jchip { display:flex; flex-direction:column; align-items:flex-start; gap:1px; text-align:left;
    font:inherit; background:rgba(255,255,255,0.045); border:1px solid rgba(255,255,255,0.11);
    border-radius:11px; padding:6px 11px; cursor:pointer; transition:all .18s; }
  .gtc-jchip:hover { background:rgba(255,255,255,0.09); border-color:rgba(var(--hue-r),0.4); }
  .gtc-jchip b { font-size:11px; color:rgba(244,246,255,0.85); font-weight:600;
    font-family:ui-monospace, SFMono-Regular, monospace; }
  .gtc-jchip span { font-size:10.5px; color:rgba(244,246,255,0.45); }

  .gtc-foot { font-size:11px; color:rgba(244,246,255,0.35); margin-top:auto; padding-top:14px; }

  .gtc-bloom-host { position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:5; }
  .gtc-heart { position:absolute; opacity:0; animation:gtcHeart 2.2s ease-out forwards; }
  @keyframes gtcHeart {
    0% { opacity:0; transform:translate(0,10px) scale(0.4); }
    18% { opacity:0.95; transform:translate(calc(var(--drift) * 0.3), -14px) scale(1.06); }
    100% { opacity:0; transform:translate(var(--drift), -120px) scale(0.9); } }
  .gtc-thankyou { position:absolute; left:50%; top:44%; transform:translate(-50%,-50%) scale(0.92);
    font-size:34px; font-weight:700; color:#ffe9ee; letter-spacing:0.08em; opacity:0;
    text-shadow:0 0 40px #e35d75ee, 0 0 80px #9d8cff88; transition:all .5s ease; }
  .gtc-thankyou.in { opacity:1; transform:translate(-50%,-50%) scale(1); }

  .gtc-modal-host { position:absolute; inset:0; pointer-events:none; z-index:10; }
  .gtc-back { position:absolute; inset:0; background:#05040acc; backdrop-filter:blur(4px);
    display:flex; align-items:center; justify-content:center; pointer-events:auto; padding:16px; }
  .gtc-modal { position:relative; width:100%; max-width:500px; max-height:90%; overflow-y:auto;
    background:rgba(15,18,30,0.96); color:rgba(244,246,255,0.88);
    border:1px solid rgba(var(--hue-r),0.3); border-radius:16px; padding:22px 24px;
    box-shadow:0 0 60px rgba(var(--hue-r),0.15), 0 24px 80px #000000cc; }
  .gtc-modal h3 { margin:0 0 12px; font-size:17px; color:#fff; letter-spacing:0.04em; }
  .gtc-x { position:absolute; top:10px; right:12px; width:30px; height:30px; border:1px solid rgba(255,255,255,0.14);
    border-radius:9px; background:rgba(255,255,255,0.05); color:rgba(244,246,255,0.8); font-size:17px; cursor:pointer; }
  .gtc-x:hover { background:rgba(255,255,255,0.14); }
  .gtc-curiosity-line { font-size:15px; line-height:1.5; margin:10px 0; color:rgba(190,215,255,0.85); }
  .gtc-m-gift .gtc-gift-text { font-size:14px; line-height:1.55; color:rgba(244,246,255,0.75); }
  .gtc-gift-img { width:100%; border-radius:12px; margin-top:12px; }
  .gtc-howto-logo { width:100%; max-width:280px; display:block; margin:4px auto 12px; border-radius:10px; }
  .gtc-howto-list { padding-left:20px; margin:0; }
  .gtc-howto-list li { font-size:13.5px; line-height:1.5; margin:8px 0; color:rgba(244,246,255,0.75); }
  .gtc-howto-foot { margin-top:26px; text-align:center; font-size:12px; color:rgba(244,246,255,0.4); }
  .gtc-howto-foot a { color:#8fb4e8; text-decoration:none; }
  .gtc-howto-foot a:hover, .gtc-howto-foot a:focus { color:#b3aef5; }

  .gtc-filter-legend { font-size:12px; color:rgba(244,246,255,0.45); margin:0 0 10px; }
  .gtc-fgroup { margin-bottom:12px; }
  .gtc-fgroup-k { font-size:10.5px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase;
    color:rgba(var(--hue-r),0.85); margin-bottom:6px; }
  .gtc-fgroup-row { display:flex; flex-wrap:wrap; gap:6px; }
  .gtc-fchip { font-size:12px; padding:5px 11px; border-radius:99px; cursor:pointer;
    border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.05);
    color:rgba(244,246,255,0.75); transition:all .15s; }
  .gtc-fchip:hover:not(:disabled) { border-color:rgba(var(--hue-r),0.6); }
  .gtc-fchip.on { background:rgba(var(--hue-r),0.22); border-color:rgba(var(--hue-r),0.75);
    color:#fff; box-shadow:0 0 10px rgba(var(--hue-r),0.25); }
  .gtc-fchip:disabled { opacity:0.32; cursor:default; }
  .gtc-filter-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:14px; }
  .gtc-fclear { background:none; border:0; color:rgba(244,246,255,0.5); font-size:12.5px; cursor:pointer;
    text-decoration:underline; }

  @media (max-width: 520px) {
    .gtc-stack { left:8px; }
    .gtc-tool { width:34px; height:34px; }
    .gtc-card-prompt { font-size:17px; }
    .gtc-brand-txt span { display:none; }
    .gtc-port { padding-left:56px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gtc-card { transition-duration:0.01s; }
    .gtc-heart { animation-duration:1.2s; }
    .gtc-core-glyph, .gtc-rest-glyph { animation:none; opacity:0.7; }
  }`;
  document.head.append(s);
}
