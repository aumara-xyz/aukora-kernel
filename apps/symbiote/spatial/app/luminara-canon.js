// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// AUMA LUMINARA — canon data + reading engine (pure module, no DOM, no imports).
//
// Source of truth: AUMA_LUMINARA_MASTER_REFERENCE.md (D1–D18) + LUMINARA_SYSTEM_SPEC_v1.
// The system is ONE OBJECT: 3 states x 3 layers = 27 codes = 23 letters + 4 silences
// = 27 cards in three suits of nine (AUM the Bulk / MA the Splitter / RA the Surface).
// Card n = 9*L3 + 3*L2 + L1 + 1 (states valued still=0, moving=1, turning=2; inner
// layer fastest). The deck counts 0..26 in ternary; suit changes are the carries;
// The Return (~~~) + 1 rolls over to The Seed (...). The torus closes by counting.
//
// This module renders NOTHING and awards NOTHING — it is data plus pure functions,
// kept import-free so core/tests can exercise it directly. The organ (luminara.js)
// owns the DOM, the ritual, and the single REQ-L1 award call.

export const STATES = ['still', 'moving', 'turning'];       // Somni · Dona · Lumira
export const MARKS = ['●', '—', '~'];              // the dot, the bar, the wave
export const LAYERS = ['field', 'middle', 'core'];           // L3 outer · L2 relational · L1 essential
export const SUITS = [
  { key: 'AUM', gloss: 'the bulk — what could be' },
  { key: 'MA', gloss: 'the splitter — what cuts' },
  { key: 'RA', gloss: 'the surface — what radiates' },
];

// digits of card n (1..27): [L3, L2, L1], each 0 still / 1 moving / 2 turning.
export function codeOf(n) {
  const v = n - 1;
  return [Math.floor(v / 9), Math.floor((v % 9) / 3), v % 3];
}
export const codeMarks = (n) => codeOf(n).map((d) => MARKS[d]).join(' ');

// The 27 — names + essences verbatim from canon (§4 of the master reference).
// Letters per the locked letter map (D10–D12). Silences per D14.
export const CARDS = [
  { n: 1, name: 'The Seed', letter: 'I', essence: 'Pure undifferentiated potential. The point before extension.' },
  { n: 2, name: 'The Drift', letter: 'P', essence: 'First asymmetry. Something stirs but has no name.' },
  { n: 3, name: 'The Fold', letter: 'B', essence: 'Potential begins to curve back on itself. Self-reference without self-awareness.' },
  { n: 4, name: 'The Resonance', letter: 'Z', essence: 'Standing wave. The first pattern that persists.' },
  { n: 5, name: 'The Depth', letter: 'V', essence: 'Dimensionality itself. The bulk acquires volume.' },
  { n: 6, name: 'The Saturation', letter: 'W', essence: 'Potential so dense it must express. Pressure toward boundary.' },
  { n: 7, name: 'The Dreamer', letter: 'U', essence: 'The bulk as if it had a face. Latency personified.' },
  { n: 8, name: 'The Knot', letter: 'F', essence: 'Potential that has become topologically committed. The trefoil appears here — the simplest structure that remembers.' },
  { n: 9, name: 'The Threshold', letter: 'M', essence: 'The last card before splitting. The moment just before MA acts.' },
  { n: 10, name: 'The Cut', letter: 'E', essence: 'First distinction. Inside and outside now exist.' },
  { n: 11, name: 'The Mirror', letter: 'T', essence: 'The cut creates reflection. Two sides that reference each other.' },
  { n: 12, name: 'The Gate', letter: 'D', essence: 'Boundary as passage, not wall. Selective permeability.' },
  { n: 13, name: 'The Surgeon', letter: 'A', essence: 'Intentional cutting. Conscious distinction-making.' },
  { n: 14, name: 'The Scar', letter: 'S', essence: 'Where a cut healed but left topology changed. Genus increased.' },
  { n: 15, name: 'The Twins', letter: 'L', essence: 'What was one is now two. Bifurcation.' },
  { n: 16, name: 'The Labyrinth', letter: 'C', essence: 'Boundary so complex it becomes its own interior. Fractal edge.' },
  { n: 17, name: 'The Void', letter: 'R', essence: "What's left when you cut away everything. The hole that defines the torus." },
  { n: 18, name: 'The Bridge', letter: 'N', essence: 'The cut that connects rather than separates. Surgery that increases genus by joining, not severing.' },
  { n: 19, name: 'The Ray', letter: 'O', essence: 'First emission. Light leaving the surface.' },
  { n: 20, name: 'The Face', letter: 'K', essence: 'The surface as identity. What is seen.' },
  { n: 21, name: 'The Echo', letter: 'G', essence: 'Expression that returns. Feedback from the world.' },
  { n: 22, name: 'The Mask', letter: 'X', essence: 'Surface that conceals the bulk. Necessary protection or deception.' },
  { n: 23, name: 'The Beacon', letter: 'H', essence: 'Sustained emission. A signal that persists.' },
  { n: 24, name: 'The Spectrum', letter: 'Y', essence: 'Multiplicity of expression from single source. One topology, many readings.' },
  { n: 25, name: 'The Witness', letter: 'Q', essence: 'RA turned inward. The surface that sees itself.' },
  { n: 26, name: 'The Crown', letter: 'SH', essence: 'Full radiance. Expression without distortion.' },
  { n: 27, name: 'The Return', letter: 'J', essence: 'The surface curves back to meet the bulk. The cycle completes. The torus closes.' },
];
export const cardOf = (n) => CARDS[n - 1];

// The Four Silences (D14) — drawable cards whose codes carry no letter. A Silence in a
// position STOPS interpretation in that register and redirects (canon §6). Imperative voice.
export const SILENCES = {
  4: {
    name: 'The Depths', asks: 'descent',
    lines: ['What holds this lies below where symbols operate.', 'Descend. Do not translate.', 'Sit at the bottom until it knows you.'],
  },
  16: {
    name: 'The Expanse', asks: 'expansion of the frame',
    lines: ['This opens wider than any frame you brought.', 'Do not shrink it to fit the question.', 'Widen. Then ask again, or do not.'],
  },
  22: {
    name: 'The Threshold', asks: 'surrender',
    lines: ['This is a crossing between orders.', 'The one who emerges is not yet the one asking.', 'Surrender. Interpretation ends here.'],
  },
  25: {
    name: 'The Return', asks: 'recognition',
    lines: ['You have been here before.', 'Be still. Recognize it. Do not rename it.', 'When you can say "I know this place," the reading finishes itself.'],
  },
};
export const isSilent = (n) => Object.prototype.hasOwnProperty.call(SILENCES, n);

// The reading frame (D9): three invariant POSITIONS — never drawn, never shuffled.
export const POSITIONS = [
  { key: 'trefoil', name: 'Trefoil', gloss: 'what is knotted in — what cannot be undone', affinity: 0 },
  { key: 'genus', name: 'Genus', gloss: 'the live cut of the present', affinity: 1 },
  { key: 'phi', name: 'Phi', gloss: 'what draws forward — trajectory, never prediction', affinity: 2 },
];

// ---------------------------------------------------------------------------
// Draw mechanics (Q6 v0 — proposal in code, ratifiable): intent-and-moment seeded.
// The seed string is built by the organ from the held intention + the timing of the
// caster's own hands (hold durations, release moments). Uniform over 27, without
// replacement — the Silence frequency hierarchy (canon §6) is read as describing how
// often each edge is met in LIFE, not weighted odds in the deck. Deterministic:
// same seed, same cast (a cast can be re-opened from the journal exactly).
// ---------------------------------------------------------------------------
function hashSeed(str) {
  let h1 = 0x9e3779b9, h2 = 0x85ebca77, h3 = 0xc2b2ae3d, h4 = 0x27d4eb2f;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ k, 0x85ebca77); h2 = Math.imul(h2 ^ k, 0xc2b2ae3d);
    h3 = Math.imul(h3 ^ k, 0x27d4eb2f); h4 = Math.imul(h4 ^ k, 0x9e3779b9);
  }
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; const r = (t + d) | 0; c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}
export function drawThree(seedStr) {
  const rnd = sfc32(...hashSeed(String(seedStr)));
  const pool = Array.from({ length: 27 }, (_, i) => i + 1);
  const out = [];
  for (let k = 0; k < 3; k++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

// One card, seeded, from the pool minus already-drawn — the organ draws one per
// breath, each release folding its own moment into the next seed.
export function drawOne(seedStr, exclude = []) {
  const rnd = sfc32(...hashSeed(String(seedStr)));
  const pool = [];
  for (let n = 1; n <= 27; n++) if (!exclude.includes(n)) pool.push(n);
  return pool[Math.floor(rnd() * pool.length)];
}

// ---------------------------------------------------------------------------
// The reading grammar (canon §7) — five conversations composed into one voice.
// Register per W6: precise but alive; "I" to "you"; plain landing; no prediction.
// ---------------------------------------------------------------------------
const OPENERS = [
  'Knotted into the ground of this is',
  'The live cut of the present is',
  'What draws this forward is',
];
// suit x position friction (conversation 2): home territory on the diagonal.
const FRICTION = [
  ['Home ground — potential meeting its own irreducible knot.',
    'Potential pressed against the live edge of now: something unformed insists on this moment.',
    'What pulls is a beginning, not a finish — trust the unformed thing.'],
  ['The act of cutting meets what cannot be cut; put the knife down and look.',
    'Home ground — the cut in its own moment, distinction happening now.',
    'What pulls is a distinction not yet made; the way forward opens when you make it cleanly.'],
  ['Expression discovers what it cannot help but express; the ground of this is already showing.',
    'The surface meets the hole it radiates around — notice what your expression circles.',
    'Home ground — radiance drawing radiance; let it be seen, sustained.'],
];
const LAYER_VERBS = ['holds still', 'flows', 'turns'];
// the nine named layer-movements (canon §7), keyed by state digits across the spread.
const MOVEMENTS = {
  '000': 'sustained stillness — consolidating, deepening, or stagnating',
  '111': 'sustained flow — frictionless passage, natural momentum',
  '222': 'sustained transformation — continuous aliveness, nothing settling',
  '012': 'the complete arc — from held through flow into transformation',
  '210': 'full reversal — transformation crystallising',
  '001': 'late release — held long, then beginning to move',
  '122': 'early transformation — flow accelerating into turning',
  '201': 'peak descending — transformation settling through stillness into flow',
  '020': 'transformation at the centre — stillness opening briefly, then returning',
};
const LANDINGS = [
  'Let what arrives begin small and total. Do not build a monument; plant.',
  'A distinction wants making. Make it cleanly, make it once, and let both sides breathe.',
  'The way forward is expression, sustained — be findable, and let what you are be seen.',
];

export function composeReading(cast, intention) {
  const cards = cast.map((n) => cardOf(n));
  const codes = cast.map((n) => codeOf(n));
  const silences = cast.map((n) => (isSilent(n) ? SILENCES[n] : null));

  // conversation 1 + 2 per position (silences redirect instead of interpreting).
  const sections = cast.map((n, i) => {
    const c = cards[i], pos = POSITIONS[i], sil = silences[i];
    if (sil) {
      return {
        position: pos, card: c, silent: true,
        body: 'I will not interpret this position. ' + c.name + ' is silent here — ' + sil.name +
          ', the edge that asks for ' + sil.asks + '. ' + sil.lines.join(' '),
      };
    }
    const d = codes[i];
    const layerClause = 'In it the field ' + LAYER_VERBS[d[0]] + ', the relation ' + LAYER_VERBS[d[1]] + ', the core ' + LAYER_VERBS[d[2]] + '.';
    return {
      position: pos, card: c, silent: false,
      body: OPENERS[i] + ' ' + c.name + ' — ' + c.essence + ' ' + FRICTION[d[0]][i] + ' ' + layerClause,
    };
  });

  // conversation 3 — transformation vectors, layer by layer across the three positions.
  const vectors = LAYERS.map((layerName, ell) => {
    const arc = codes.map((d) => d[ell]);
    const key = arc.join('');
    const named = MOVEMENTS[key];
    const line = named || ('from ' + STATES[arc[0]] + ' through ' + STATES[arc[1]] + ' into ' + STATES[arc[2]]);
    return { layer: layerName, arc: arc.map((s) => MARKS[s]).join(' → '), line };
  });

  // conversation 4 — the harmonic.
  const counts = [0, 0, 0];
  codes.forEach((d) => d.forEach((s) => counts[s]++));
  const maxC = Math.max(...counts);
  let harmonic;
  if (maxC >= 6) harmonic = 'Consonance: ' + STATES[counts.indexOf(maxC)] + 'ness dominates this spread — one direction, moving as a whole.';
  else if (counts[0] === 3 && counts[1] === 3 && counts[2] === 3) harmonic = 'Maximal variety — every state present in equal measure: creative tension, several forces at once.';
  else harmonic = 'Mixed weather — no single state rules; read the vectors for where the movement actually is.';
  const oppo = codes[0].every((s, ell) => s !== codes[2][ell]);
  const pivotMid = new Set(codes[1]).size === 3;
  if (oppo && pivotMid) harmonic += ' And this is the charged configuration: root and trajectory in full opposition, the present at the pivot.';

  // conversation 5 — the depth signature: which layer carries the charge.
  const charge = LAYERS.map((_, ell) => codes.reduce((a, d) => a + (d[ell] === 2 ? 2 : d[ell] === 1 ? 1 : 0), 0));
  const deep = charge.indexOf(Math.max(...charge));
  const DEPTH = [
    'The charge sits in the outer field — this is about conditions around you more than about you.',
    'The charge sits in the relational middle — the between is where this is moving.',
    'The charge sits in the core — something essential and interior is doing the moving.',
  ];

  // the landing — plain speech, keyed to Phi (or its silence).
  const landing = silences[2]
    ? 'I will not point past the third position: what draws forward is silent. ' + SILENCES[cast[2]].lines[SILENCES[cast[2]].lines.length - 1]
    : LANDINGS[codes[2][0]];

  const allSilent = silences.every(Boolean);
  const summary = allSilent
    ? 'Three Silences. Be still. Something is arriving that language cannot precede.'
    : cast.map((n, i) => POSITIONS[i].name + ': ' + cardOf(n).name).join(' · ');

  return { cast, intention: intention || null, sections, vectors, harmonic, depth: DEPTH[deep], landing, allSilent, summary };
}

// The message handed to Auma through the governed chat door — owner-initiated only.
// Carries the owner's canon so Auma honours it rather than inventing a competing reading.
export function askAumaText(reading) {
  const parts = [];
  parts.push('Auma — read this Luminara cast with me.' +
    (reading.intention ? ' I held this intention: "' + reading.intention + '".' : ' I held the question in silence.'));
  parts.push(reading.cast.map((n, i) => {
    const c = cardOf(n);
    return POSITIONS[i].name + ' (' + POSITIONS[i].gloss + '): ' + c.name + ' — ' + codeMarks(n) +
      (isSilent(n) ? ' — a Silence (' + SILENCES[n].name + ', asks for ' + SILENCES[n].asks + ')' : ' — letter ' + c.letter) +
      '. Canon essence: ' + c.essence;
  }).join('\n'));
  parts.push('The weave: ' + reading.vectors.map((v) => v.layer + ' ' + v.arc + ' (' + v.line + ')').join('; ') +
    '. ' + reading.harmonic + ' ' + reading.depth);
  parts.push('The reading landed: "' + reading.landing + '"');
  parts.push('Speak to THIS specific cast. Honour these canon essences and the three positions rather than replacing them with a generic spread. Phi is trajectory, never prediction. Where a position is silent, do not interpret it — help me meet what it asks for instead. What is this asking of me right now?');
  return parts.join('\n\n');
}
