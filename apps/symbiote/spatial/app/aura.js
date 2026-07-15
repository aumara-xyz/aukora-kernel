// Aukora Spatial — AURA organ: the living coherence and witness pattern.
//
// DETOKENIZED (AURA lane round 1, docs/mesh/handoff/AURA.md): AURA is not a
// token, score, balance, currency, or personhood number. It is an evolving,
// NONNUMERIC pattern — the cymatic coherence glyph is its primary and only
// user-facing representation, honestly labelled `local · unwitnessed` until
// receipted history, drand-anchored epochs, key continuity, and consented
// human witness events give it more to say. Internal math may shape the
// figure (clarity from breadth of real use — readAura()'s frozen legacy
// evidence), but no number it computes ever reaches user-facing text.
//
// Truth boundaries (each stated on the page itself): drand proves public-time
// freshness; a signature proves possession of a key; a receipt chain proves
// continuity of recorded history; a co-signed vouch proves two identities made
// an attestation. None of these — alone or together — proves biological
// humanity, honesty, or exclusive human control. AURA is evidence, never
// authority: it never unlocks, signs, approves, or applies anything.

import { readAura } from '/app/aura-core.js';
import { createGlyph } from '/app/coherence-glyph.js';
import { mountAuraBirth } from '/assets/aura-birth.js';
import { tuningState } from '/app/tuning.js';

// A stable per-device signature so the coherence glyph is reproducible — the
// same identity always rings the same figure (a voice, not a stamp). Local and
// provisional, like everything in this lane; the witnessed signature is the
// chain's coherence-topology and arrives with it.
function nodeSignature() {
  try {
    let id = localStorage.getItem('aukora-node-glyph-id');
    if (!id) { id = (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2))); localStorage.setItem('aukora-node-glyph-id', id); }
    return id;
  } catch { return 'aukora'; }
}

// Provisional coherence in [0,1] — a STAND-IN for the witnessed coherence-topology
// (docs/COHERENCE_GLYPH.md §6). Reads clarity from breadth of real use + streak
// liveness, never from the raw total. It tunes the figure's clarity, not its size.
function provisionalCoherence(a) {
  const sources = [a.fromLessons, a.fromMessages, a.fromReadings, a.fromStreak].filter((x) => x > 0).length;
  const diversity = sources / 4;                       // circulating through many acts, not one
  const streak = Math.min(1, (a.streak || 0) / 7);     // showing up, held open
  const alive = a.todayEarned > 0 ? 1 : 0;
  return Math.max(0.14, Math.min(0.95, 0.22 + 0.42 * diversity + 0.26 * streak + 0.1 * alive));
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// A collapsible section: the bar is the toggle, the body opens on click.
// Closed by default — the page reads as a clean list you expand as you like.
function section(hue, title, sub) {
  const wrap = el('div', `aura-sec hue-${hue}`);
  const bar = el('button', 'aura-sec-bar'); bar.type = 'button';
  const txt = el('div', 'aura-sec-bartext');
  txt.append(el('div', 'aura-sec-title', title));
  if (sub) txt.append(el('div', 'aura-sec-sub', sub));
  bar.append(txt, el('div', 'aura-sec-chev'));
  wrap.append(bar);
  const body = el('div', 'aura-sec-body');
  wrap.append(body);
  bar.addEventListener('click', () => wrap.classList.toggle('open'));
  return { wrap, body };
}

function rule(glyph, name, text) {
  const r = el('div', 'aura-rule');
  r.append(el('div', 'aura-rule-g', glyph));
  const t = el('div', 'aura-rule-t');
  t.append(el('b', null, name), el('span', null, text));
  r.append(t);
  return r;
}

export function mountAura(root) {
  injectStyle();
  const app = el('div', 'aura-app');
  const cssVars = getComputedStyle(document.documentElement);
  const hueR = cssVars.getPropertyValue('--hue-r').trim() || '196, 170, 255';
  const hueC = cssVars.getPropertyValue('--hue-c').trim() || '150, 180, 255';

  // ---- top bar (matches the Auma app header rhythm) ----
  const head = el('div', 'aura-head');
  const brand = el('div', 'aura-brand');
  brand.append(el('div', 'aura-name', 'AURA'), el('div', 'aura-tag', 'a living coherence pattern — evidence, never authority'));
  head.append(brand);
  app.append(head);

  const scroll = el('div', 'aura-scroll');
  app.append(scroll);

  // ---- the hero: the coherence glyph carries it, not a number ----
  // A cymatic figure resonating your coherence (docs/COHERENCE_GLYPH.md): gold
  // nodal lines where the standing wave holds, living light where it flows. The
  // shape is registered, not counted. The provisional tally is demoted below it,
  // small, honest about being a toy.
  const hero = el('div', 'aura-hero');
  const glyphCanvas = document.createElement('canvas'); glyphCanvas.className = 'aura-glyph';
  hero.append(glyphCanvas);
  // #357: the SAME shared genesis/chamber renderer as the ceremony, in stable base mode, seeded by
  // the same public genesis ref. When a bound node's genesis is present it becomes the hero (the
  // one identity, one renderer); on an unbound node the provisional coherence glyph stands.
  const birthCanvas = document.createElement('canvas'); birthCanvas.className = 'aura-glyph aura-birth-hero'; birthCanvas.style.display = 'none';
  hero.append(birthCanvas);
  (async () => {
    try {
      const g = await fetch('http://127.0.0.1:7095/api/bind/genesis', { signal: AbortSignal.timeout(1500) }).then((r) => r.json());
      const ref = (g && g.present && g.packet && typeof g.packet.genesisRef === 'string') ? g.packet.genesisRef : null;
      if (!ref) return; // unbound / door down → keep the provisional glyph
      glyphCanvas.style.display = 'none';
      birthCanvas.style.display = '';
      mountAuraBirth(birthCanvas, { seed: ref, mode: 'base' });
      // layer honesty (#358 review): name what this is — and what it is not — right on the hero
      heroIn.querySelector('.aura-glyph-sub').textContent =
        'your key is the identity — this figure is its deterministic visual echo: knot skeleton, cymatic face; it never signs and never proves a person';
    } catch { /* door unreachable → provisional glyph stands, honestly */ }
  })();
  const heroIn = el('div', 'aura-hero-in');
  heroIn.append(el('div', 'aura-glyph-title', 'your coherence'));
  heroIn.append(el('div', 'aura-glyph-sub', 'the shape resonating — read, not scored'));
  // The honest state of THIS glyph, always visible: it lives on this device and
  // no one has witnessed it. The label changes only when witnessed state exists.
  heroIn.append(el('div', 'aura-witness-label', 'local · unwitnessed'));
  // The Tuning's ladder — which solid you are, how many modes are audible
  const stageRow = el('div', 'aura-stage');
  heroIn.append(stageRow);

  // DETOKENIZED: no axes, no balances, no streak counter, no daily meter — the
  // figure IS the representation. Qualitative resonance line only.
  const deriv = el('div', 'aura-deriv');
  heroIn.append(deriv);
  // honesty invariant: state forgeability, not just un-witnessed-ness
  heroIn.append(el('div', 'aura-forge-note',
    'This figure is local to this device — anyone with the browser console can reshape what feeds it. It carries no witnessed meaning until receipted history and consented human witness arrive on the chain.'));
  // integrity notice — a broken seal re-derives the tally from lesson
  // evidence and says so here, plainly. Never hidden, never dramatized.
  const tamperNote = el('div', 'aura-tamper');
  heroIn.append(tamperNote);
  hero.append(heroIn);
  scroll.append(hero);

  // ---- The Tuning — the day's notes (a chord, not a scoreboard) ----
  const tuningCard = el('div', 'aura-tuning');
  const tuningHead = el('div', 'aura-tuning-head');
  tuningHead.append(el('div', 'aura-tuning-title', 'the tuning — today'));
  const tuningChord = el('div', 'aura-tuning-chord');
  tuningHead.append(tuningChord);
  const tuningNotes = el('div', 'aura-tuning-notes');
  const tuningNext = el('div', 'aura-tuning-next');
  tuningCard.append(tuningHead, tuningNotes, tuningNext);
  tuningCard.append(el('div', 'aura-tuning-fine', 'notes are struck, never scored — provisional, this device, like everything here'));
  scroll.append(tuningCard);

  // the glyph reads a provisional coherence; the number never drives it
  let curCoh = 0.3;
  const glyph = createGlyph(glyphCanvas, { signature: nodeSignature(), coherence: () => curCoh, modes: 2 });

  function paintTuning(a) {
    const t = tuningState(a);
    glyph.setModeCount(t.modes);
    stageRow.innerHTML = '';
    stageRow.append(el('span', 'aura-stage-solid', `${t.glyphChar} ${t.solid}`));
    stageRow.append(el('span', 'aura-stage-modes', t.modes >= t.modesMax ? 'every mode sounding' : t.modes > 2 ? 'more of you audible' : 'first modes sounding'));
    stageRow.append(el('span', 'aura-stage-line', t.line));
    tuningChord.textContent = t.day.chord ? 'the day rings ✦' : (t.day.struck > 0 ? 'notes struck — more to sound' : 'quiet so far');
    tuningChord.classList.toggle('rings', t.day.chord);
    tuningNotes.innerHTML = '';
    for (const n of t.day.notes) {
      const row = el('div', 'aura-note' + (n.done ? ' done' : ''));
      row.append(el('span', 'aura-note-mark', n.done ? '✓' : '·'));
      row.append(el('span', 'aura-note-label', n.label));
      row.append(el('span', 'aura-note-hint', n.hint));
      tuningNotes.append(row);
    }
    tuningNext.textContent = t.atLast
      ? t.next
      : `next solid — ${t.nextSolid}: ${t.next}`;
  }

  // Qualitative resonance line — WHICH kinds of acts feed the figure, never how many.
  function paintPattern() {
    const a = readAura(); // frozen legacy evidence, read internally only (never printed)
    curCoh = provisionalCoherence(a);
    paintTuning(a);
    const sources = [];
    if (a.fromLessons) sources.push('lessons');
    if (a.fromReadings) sources.push('readings');
    if (a.fromMessages) sources.push('talking with her');
    deriv.textContent = sources.length
      ? `the figure resonates from ${sources.join(', ')} — witnessed meaning arrives only with the chain`
      : 'finish a lesson, cast a reading, or talk with her — real acts shape the figure; witnessed meaning arrives only with the chain';
    // #357: the alarming legacy integrity banner is removed from the primary experience. Honest
    // provenance stays in the forge-note above; a re-derivation is not dramatized on the hero.
    tamperNote.style.display = 'none';
    tamperNote.textContent = '';
  }
  paintPattern();
  window.addEventListener('aura-changed', () => { glyph.pulseNow(); paintPattern(); });

  // ---- forged bonds pointer ----
  // DETOKENIZED: a bond is named, never counted — a vouch count is a number
  // about a person, and those don't render here.
  let hasBondDrafts = false;
  try { hasBondDrafts = ((JSON.parse(localStorage.getItem('aukora-forge-drafts')) ?? []).length > 0); } catch { hasBondDrafts = false; }
  const bonds = el('div', 'aura-bonds');
  const bt2 = el('div', 'aura-bonds-txt');
  bt2.append(el('div', 'aura-bonds-title', hasBondDrafts ? 'Drafts waiting in the Forge' : 'No bonds yet'));
  bt2.append(el('div', 'aura-bonds-sub', 'Forging lets two humans stand behind each other — forging is coming.'));
  const bondsBtn = el('button', 'aura-bonds-btn', 'The Forge →');
  bondsBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-organ', { detail: 'forge' })));
  bonds.append(bt2, bondsBtn);
  scroll.append(bonds);

  // ---- what AURA is now ----
  const a = section('r', 'What AURA is', 'a pattern, not a number');
  a.body.append(el('p', null,
    'AURA is the living resonance pattern of coherence between you and your experience of this place — the shape of showing up, over time. It is not a token, not a balance, not points, and not a percentage of anything. It cannot be bought, spent, transferred, or summed, because there is nothing to count: the figure above is the whole representation, and it is read the way a chord or a face is read.'));
  a.body.append(el('p', null,
    'Today the figure is local and unwitnessed — it says so right on it. It evolves from real acts on this device. As the witnessed layers arrive, the same figure will deepen from receipted history, public-time (drand) epochs, the continuity of your key, and consented human-to-human witness events — each of which changes what the pattern can honestly claim, and none of which turns it back into a number.'));
  scroll.append(a.wrap);

  // ---- truth boundaries ----
  const tb = section('l', 'Truth boundaries', 'what each layer proves — and what none of them prove');
  tb.body.append(rule('◷', 'drand', 'proves public-time freshness — that a mark was made after a public random beacon existed. Nothing more.'));
  tb.body.append(rule('⚿', 'a signature', 'proves possession of a key at signing time. Not who held it, and not that a human did.'));
  tb.body.append(rule('⛓', 'a receipt chain', 'proves continuity of recorded history — that this record grew link by link without silent rewrites.'));
  tb.body.append(rule('◈', 'a co-signed vouch', 'proves two identities made an attestation together, on purpose. It is testimony, not verification.'));
  tb.body.append(el('p', 'aura-fine',
    'None of these — alone or together — proves biological humanity, honesty, or exclusive human control of a key. AURA is built from exactly these materials, so AURA inherits their limits: it is evidence, never proof of a person, and never authority. It cannot unlock, sign, approve, or apply anything — only the owner\u2019s AUMLOK key does that.'));
  scroll.append(tb.wrap);

  // ---- how the figure evolves ----
  const b = section('c', 'How the figure evolves', 'witnessed layers, arriving in order');
  b.body.append(el('p', null,
    'The figure never jumps — it deepens, one honest layer at a time. Each layer below is a future state; the label under the glyph will change only when the layer is actually real on this node.'));
  const chain = el('div', 'aura-chain');
  const links = [
    ['local — where you are now', 'the figure resonates from real acts on this device'],
    ['receipted', 'its history commits to the governed receipt chain — continuity becomes checkable'],
    ['time-anchored', 'epochs stamp against the public drand beacon — freshness becomes checkable'],
    ['witnessed', 'another human consents to attest, co-signed — testimony joins the pattern'],
  ];
  links.forEach(([act, note], i) => {
    const link = el('div', 'aura-link');
    link.append(el('div', 'aura-link-hash', i === 0 ? '●' : '○'));
    link.append(el('div', 'aura-link-act', act));
    link.append(el('div', 'aura-link-note', note));
    chain.append(link);
    if (i < links.length - 1) chain.append(el('div', 'aura-link-join', '↓'));
  });
  b.body.append(chain);
  b.body.append(el('p', 'aura-fine',
    'Every future layer is testable evidence about keys, time, and records — never a claim about souls. The pattern grows more articulate, not more authoritative.'));
  scroll.append(b.wrap);

  // ---- the rules ----
  const c = section('r', 'The rules', 'what keeps it honest');
  c.body.append(rule('∅', 'Never a number', 'no balance, no score, no leaderboard, no percentage — the figure is the whole representation, and anything that renders it as a count is a bug.'));
  c.body.append(rule('⊕', 'Never bought', 'there is no purchase path and never will be — money cannot shape the pattern.'));
  c.body.append(rule('⚿', 'Never transferable', 'the pattern is the history of one identity; it cannot be gifted, sold, or moved.'));
  c.body.append(rule('Σ', 'Read, not set', 'the figure derives from recorded acts — there is no field to edit that IS your aura.'));
  c.body.append(rule('◎', 'Never proof of a person', 'no pattern, vouch, or beacon here proves a human — testimony and evidence, always named as such.'));
  c.body.append(rule('⊘', 'Never authority', 'AURA cannot sign, unlock, gate, or apply — only the AUMLOK key in the owner\u2019s hands does that. This rule outranks every other.'));
  scroll.append(c.wrap);

  // ---- the witness web ----
  const d = section('c', 'The witness web', 'consented testimony between humans — not verification');
  d.body.append(el('p', null,
    'One human can attest that they know another is real — deliberately, consented on both sides, co-signed by both keys. That attestation is testimony: strong, social, and honest about being fallible. A web of such testimony makes coordinated fakery expensive and visible, and that is all it claims. It does not verify anyone, and it never will — a signature cannot see who is holding the pen.'));
  d.body.append(buildWebDiagram(hueR, hueC));
  d.body.append(el('p', 'aura-fine',
    'The web stays private by construction: attestations live as salted commitments, disclosed only by their own participants. Witness must never cost the humans their privacy.'));
  scroll.append(d.wrap);

  // ---- where it stands ----
  const f = section('r', 'Where it stands today', 'honest status');
  f.body.append(el('p', null,
    'The figure on this page is local and unwitnessed — exactly as its label says. Nothing here is receipted, time-anchored, or witnessed yet; nothing here is enforced anywhere. A legacy numeric tally from the earlier design still exists in this browser\u2019s storage: it is preserved untouched, no longer shown, and no longer grows. Its deliberate migration or retirement is a future step, taken in the open.'));
  scroll.append(f.wrap);

  root.append(app);
}

// A small illustrative SVG of the vouching web — YOU at center, vouches as
// edges, two founding roots marked. Labelled as an illustration; renders no
// real data because there is none to render yet.
function buildWebDiagram(hueR, hueC) {
  const wrap = el('div', 'aura-web');
  const W = 460, H = 210;
  const nodes = [
    { x: 230, y: 105, r: 13, k: 'you' },
    { x: 118, y: 52, r: 8 }, { x: 88, y: 138, r: 8 }, { x: 176, y: 178, r: 7 },
    { x: 330, y: 44, r: 8 }, { x: 368, y: 128, r: 7 }, { x: 300, y: 180, r: 8 },
    { x: 30, y: 80, r: 10, k: 'root' }, { x: 430, y: 70, r: 10, k: 'root' },
  ];
  const edges = [[0, 1], [0, 2], [0, 4], [0, 6], [1, 7], [2, 7], [4, 8], [5, 8], [1, 2], [4, 5], [3, 2], [6, 5]];
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="illustration of the vouching web">`;
  for (const [ai, bi] of edges) {
    const a = nodes[ai], b = nodes[bi];
    svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(${hueC},0.35)" stroke-width="1.2" stroke-dasharray="3 5" class="aura-web-edge"/>`;
  }
  for (const n of nodes) {
    const col = n.k === 'you' ? `rgb(${hueR})` : n.k === 'root' ? 'rgb(255,214,140)' : `rgba(${hueC},0.9)`;
    svg += `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${col}" opacity="${n.k ? 0.95 : 0.7}" class="aura-web-node"/>`;
    if (n.k === 'you') svg += `<text x="${n.x}" y="${n.y + 28}" text-anchor="middle" fill="rgba(255,255,255,0.75)" font-size="10" letter-spacing="2">YOU</text>`;
    if (n.k === 'root') svg += `<text x="${n.x}" y="${n.y + 22}" text-anchor="middle" fill="rgba(255,214,140,0.8)" font-size="8" letter-spacing="1.5">ROOT</text>`;
  }
  svg += '</svg>';
  wrap.innerHTML = svg;
  wrap.append(el('div', 'aura-web-cap', 'testimony standing behind testimony — an illustration, not a claim'));
  return wrap;
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .aura-app { position:absolute; inset:0; display:flex; flex-direction:column;
    color:var(--text); font-size:14px; overflow:hidden; }
  .aura-head { flex:none; display:flex; align-items:center; padding:14px 20px 11px; border-bottom:1px solid rgba(255,255,255,0.06); }
  .aura-brand { display:flex; flex-direction:column; gap:1px; }
  .aura-name { font-size:16px; font-weight:750; letter-spacing:0.2em; width:max-content;
    background:linear-gradient(100deg, rgba(var(--hue-l),1), rgba(var(--hue-c),1) 50%, rgba(var(--hue-r),1));
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .aura-tag { font-size:11.5px; color:var(--dim); }

  .aura-scroll { flex:1; overflow-y:auto; padding:18px max(16px, calc((100% - 720px)/2)) 60px;
    scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.12) transparent; }

  /* hero — the coherence glyph carries it */
  .aura-hero { position:relative; text-align:center; padding:26px 16px 30px; margin-bottom:10px; overflow:hidden;
    border-radius:22px; border:1px solid rgba(var(--hue-r),0.24);
    background:radial-gradient(130% 150% at 50% 0%, rgba(var(--hue-r),0.13), rgba(var(--hue-r),0.02) 62%, transparent); }
  .aura-glyph { position:relative; display:block; width:min(300px, 74%); aspect-ratio:1/1; margin:0 auto 4px; pointer-events:none; }
  .aura-hero-in { position:relative; }
  .aura-glyph-title { font-size:13px; font-weight:650; letter-spacing:0.16em; text-transform:uppercase;
    background:linear-gradient(100deg, rgba(var(--hue-r),1), rgba(255,201,92,0.95)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .aura-glyph-sub { margin-top:4px; font-size:11px; color:var(--faint); letter-spacing:0.02em; }
  .aura-witness-label { display:inline-block; margin-top:9px; padding:3px 12px; border-radius:999px;
    font-size:10.5px; letter-spacing:0.18em; text-transform:uppercase; color:var(--dim);
    border:1px solid rgba(255,255,255,0.14); background:rgba(10,12,22,0.5); }
  .aura-stage { display:flex; align-items:baseline; justify-content:center; gap:10px; margin-top:12px; flex-wrap:wrap; }
  .aura-stage-solid { font-size:13px; font-weight:700; letter-spacing:0.08em; color:rgba(255,201,92,0.95);
    text-shadow:0 0 12px rgba(255,201,92,0.4); text-transform:uppercase; }
  .aura-stage-modes { font-size:11px; color:var(--dim); }
  .aura-stage-line { font-size:11px; color:var(--faint); font-style:italic; }

  /* The Tuning — the day's notes; a chord, never a scoreboard */
  .aura-tuning { margin:14px 0 2px; padding:13px 15px 11px; border-radius:13px;
    border:1px solid rgba(255,201,92,0.22); background:linear-gradient(100deg, rgba(255,201,92,0.06), rgba(var(--hue-r),0.04) 70%, transparent); }
  .aura-tuning-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
  .aura-tuning-title { font-size:10px; letter-spacing:0.24em; text-transform:uppercase; color:rgba(255,201,92,0.9); }
  .aura-tuning-chord { font-size:11px; color:var(--dim); }
  .aura-tuning-chord.rings { color:rgba(255,201,92,1); text-shadow:0 0 10px rgba(255,201,92,0.5); }
  .aura-tuning-notes { display:flex; flex-direction:column; gap:3px; }
  .aura-note { display:flex; align-items:baseline; gap:9px; padding:3px 2px; font-size:12.5px; color:var(--dim); }
  .aura-note.done { color:rgba(255,255,255,0.92); }
  .aura-note-mark { flex:none; width:14px; text-align:center; color:var(--faint); }
  .aura-note.done .aura-note-mark { color:rgba(255,201,92,1); }
  .aura-note-label { flex:none; }
  .aura-note-hint { font-size:10.5px; color:var(--faint); }
  .aura-tuning-next { margin-top:9px; font-size:11px; color:var(--dim); border-top:1px solid rgba(255,255,255,0.05); padding-top:8px; }
  .aura-tuning-fine { margin-top:6px; font-size:10px; color:var(--faint); font-style:italic; }

  .aura-deriv { max-width:440px; margin:14px auto 0; font-size:12.5px; line-height:1.55; color:var(--dim); }
  .aura-forge-note { max-width:440px; margin:14px auto 0; font-size:11.5px; line-height:1.55;
    color:var(--faint); font-style:italic; }
  .aura-tamper { max-width:440px; margin:10px auto 0; font-size:11.5px; line-height:1.5;
    color:rgba(255,150,140,0.95); padding:6px 12px; border-radius:10px;
    border:1px solid rgba(255,150,140,0.3); background:rgba(255,120,110,0.07); }

  .aura-bonds { margin:14px 0 2px; display:flex; align-items:center; gap:12px; padding:12px 15px;
    border-radius:13px; border:1px solid rgba(var(--hue-c),0.2); background:rgba(var(--hue-c),0.04); }
  .aura-bonds-txt { flex:1; }
  .aura-bonds-title { font-size:13.5px; font-weight:620; color:#fff; }
  .aura-bonds-sub { font-size:11.5px; color:var(--dim); margin-top:2px; line-height:1.45; }
  .aura-bonds-btn { flex:none; font:inherit; font-size:12.5px; padding:8px 14px; border-radius:9px; cursor:pointer;
    color:var(--text); border:1px solid rgba(var(--hue-r),0.4); background:rgba(var(--hue-r),0.12); transition:border-color 0.16s ease; }
  .aura-bonds-btn:hover { border-color:rgba(var(--hue-r),0.75); }

  .aura-sec { margin:11px 0; }
  .aura-sec.hue-l { --ac:var(--hue-l); } .aura-sec.hue-c { --ac:var(--hue-c); } .aura-sec.hue-r { --ac:var(--hue-r); }
  .aura-sec-bar { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left; cursor:pointer; font:inherit;
    padding:12px 15px; border-radius:13px; border:1px solid rgba(var(--ac),0.28);
    background:linear-gradient(100deg, rgba(var(--ac),0.15), rgba(var(--ac),0.04) 70%, transparent); transition:background 0.16s ease; }
  .aura-sec-bar:hover { background:linear-gradient(100deg, rgba(var(--ac),0.22), rgba(var(--ac),0.06) 70%, transparent); }
  .aura-sec.open .aura-sec-bar { border-radius:13px 13px 0 0; border-bottom-color:transparent; }
  .aura-sec-bartext { min-width:0; }
  .aura-sec-title { font-size:14px; font-weight:650; color:#fff; }
  .aura-sec-sub { font-size:11.5px; color:var(--dim); margin-top:2px; line-height:1.4; }
  .aura-sec-chev { flex:none; width:18px; height:18px; position:relative; }
  .aura-sec-chev::before { content:''; position:absolute; top:5px; left:5px; width:7px; height:7px;
    border-right:2px solid rgba(var(--ac),0.9); border-bottom:2px solid rgba(var(--ac),0.9); transform:rotate(45deg); transition:transform 0.25s ease, top 0.25s ease; }
  .aura-sec.open .aura-sec-chev::before { transform:rotate(-135deg); top:8px; }
  .aura-sec-body { max-height:0; overflow:hidden; opacity:0; padding:0 15px; background:rgba(var(--ac),0.03); border-radius:0 0 13px 13px;
    transition:max-height 0.32s ease, opacity 0.25s ease, padding 0.28s ease; }
  .aura-sec.open .aura-sec-body { max-height:1600px; opacity:1; padding:14px 15px 16px; border:1px solid rgba(var(--ac),0.16); border-top:none; }
  .aura-sec-body p { margin:0 0 10px; line-height:1.62; font-size:13.5px; color:rgba(255,255,255,0.86); }
  .aura-sec-body p:last-child { margin-bottom:0; }
  .aura-fine { font-size:12.5px !important; color:var(--dim) !important; }

  .aura-chain { display:flex; flex-direction:column; align-items:stretch; gap:0; margin:6px 0 14px; }
  .aura-link { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:10px;
    padding:9px 13px; border-radius:11px; border:1px solid rgba(var(--hue-l),0.24);
    background:rgba(var(--hue-l),0.06); }
  .aura-link-hash { font-family:ui-monospace,monospace; font-size:10.5px; color:rgba(var(--hue-l),0.9); letter-spacing:0.02em; }
  .aura-link-act { font-size:13px; color:#fff; }
  .aura-link-note { font-size:11px; color:var(--dim); white-space:nowrap; }
  .aura-link-join { text-align:center; color:rgba(var(--hue-l),0.5); font-size:13px; line-height:1.1; padding:2px 0; }

  .aura-rule { display:flex; gap:12px; align-items:flex-start; padding:9px 0;
    border-bottom:1px solid rgba(255,255,255,0.05); }
  .aura-rule:last-child { border-bottom:none; }
  .aura-rule-g { flex:none; width:26px; height:26px; display:grid; place-items:center; margin-top:1px;
    font-size:14px; border-radius:8px; color:rgba(var(--hue-r),1);
    background:rgba(var(--hue-r),0.1); border:1px solid rgba(var(--hue-r),0.28); }
  .aura-rule-t { display:flex; flex-direction:column; gap:2px; }
  .aura-rule-t b { font-size:13.5px; color:#fff; font-weight:620; }
  .aura-rule-t span { font-size:12.5px; line-height:1.5; color:var(--dim); }

  .aura-web { margin:8px 0 12px; padding:10px 8px 6px; border-radius:12px;
    border:1px solid rgba(var(--hue-c),0.16); background:rgba(var(--hue-c),0.04); }
  .aura-web svg { display:block; width:100%; height:auto; }
  .aura-web-edge { animation:auraDash 3.5s linear infinite; }
  @keyframes auraDash { to { stroke-dashoffset:-16; } }
  .aura-web-node { filter:drop-shadow(0 0 6px rgba(var(--hue-c),0.6)); }
  .aura-web-cap { text-align:center; font-size:10px; letter-spacing:0.08em; color:var(--faint); padding:6px 0 4px; }
  `;
  const tag = document.createElement('style');
  tag.id = 'aura-organ-style';
  tag.textContent = css;
  document.head.append(tag);
}
