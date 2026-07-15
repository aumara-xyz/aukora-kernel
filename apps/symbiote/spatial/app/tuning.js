// Aukora Spatial — THE TUNING: the gamification layer, transposed into the
// resonance register (docs/THE_TUNING.md; grown from the Zeus meta-prompt with
// its scalar mechanics deliberately rejected — no XP, no leaderboards, no
// public scores, per the AURA spec §12 representation rule).
//
// The game: TUNE YOUR GLYPH. Progression is the Platonic ladder — tetrahedron,
// cube, octahedron, dodecahedron, icosahedron: the five and only five regular
// solids, ending at the last stable state before the snap (COHERENCE_GLYPH.md
// §2). Each stage unlocks another resonant MODE of your own signature — the
// figure doesn't get bigger, more of who you already are becomes audible.
// There is no level six: the sphere is not a level. Past the icosahedron the
// endgame is MAINTENANCE of resonance (liveness), not climbing — infinite
// endgame with built-in humility.
//
// This module is a PURE DERIVATION over aura-core's evidence (readAura()).
// It writes nothing, stores nothing, awards nothing — same posture as
// "derived, not set." Everything it derives is provisional and clock-honest
// exactly to the degree aura-core is; the witnessed ladder arrives with the
// chain, like everything else.

// The ladder. Gates are EVIDENCE gates (lessons completed, domains sounded,
// streak held) — never raw aura totals, so grinding one source can't climb it:
// diversity is structural, not moral (a one-note plate can't form a figure).
const LADDER = [
  {
    solid: 'tetrahedron', glyphChar: '△', faces: 4, modes: 2,
    line: 'the spark — the first stable form',
    gate: () => true,
    next: 'complete a lesson and let a second domain sound',
  },
  {
    solid: 'cube', glyphChar: '□', faces: 6, modes: 3,
    line: 'grounding — structure you can stand on',
    gate: (a) => (a.lessons ?? 0) >= 1 && domains(a) >= 1,
    next: 'let a second kind of act sound',
  },
  {
    solid: 'octahedron', glyphChar: '◇', faces: 8, modes: 4,
    line: 'balance — held between opposite points',
    gate: (a) => domains(a) >= 2 && (a.lessons ?? 0) >= 2,
    next: 'every kind of act sounding, with more lessons lived',
  },
  {
    solid: 'dodecahedron', glyphChar: '⬠', faces: 12, modes: 5,
    line: 'the cosmos — twelve faces of the same thing',
    gate: (a) => domains(a) >= 3 && (a.lessons ?? 0) >= 3,
    next: 'a long, steady practice with every kind still alive',
  },
  {
    solid: 'icosahedron', glyphChar: '✦', faces: 20, modes: 6,
    line: 'the last stable state — held open by φ',
    gate: (a) => domains(a) >= 3 && (a.lessons ?? 0) >= 7,
    next: 'there is no next solid — the sphere is not a level. Stay in tune.',
  },
];

// Which act KINDS have ever sounded — qualitative marks (detokenized), with a
// legacy fallback so a device that earned under the old economy keeps its rung.
function domains(a) {
  const marks = Object.values(a.domainsSounded ?? {}).filter(Boolean).length;
  const legacy = [a.fromLessons, a.fromMessages, a.fromReadings].filter((x) => (x ?? 0) > 0).length;
  return Math.max(marks, legacy);
}

// The day's notes — a resonance is struck, not scored. Each is a ✓/· row; the
// "done" reads derive from aura-core's honest bookkeeping, nothing new is kept.
function dailyNotes(a) {
  const src = a.todaySources || {};
  const notes = [
    { k: 'first-note', label: 'strike the first note', hint: 'any real act starts the day', done: Object.values(src).some(Boolean) },
    { k: 'ring', label: 'close a ring', hint: 'finish a lesson', done: !!src.lesson },
    { k: 'voice', label: 'speak with her', hint: 'a real exchange', done: !!src.message },
    { k: 'cast', label: 'cast a reading', hint: 'a six-line cast', done: !!src.reading },
    { k: 'chordal', label: 'sound the chord', hint: 'all three kinds in one day', done: !!(src.lesson && src.message && src.reading) },
  ];
  const struck = notes.filter((n) => n.done).length;
  return { notes, struck, chord: struck >= 3 };   // three notes make a chord — the day rings
}

// tuningState(readAura()) → everything the page needs, derived fresh each call.
// The snapshot argument is optional: callers that only need the ladder shape
// (e.g. the Forge's figure) may omit it and get the first rung — this module
// stays import-free on purpose (pure derivation, hermetically testable).
export function tuningState(a) {
  if (!a) a = {};
  let stage = LADDER[0];
  for (const s of LADDER) { if (s.gate(a)) stage = s; else break; }
  const idx = LADDER.indexOf(stage);
  const nextStage = LADDER[idx + 1] || null;
  const day = dailyNotes(a);
  return {
    solid: stage.solid,
    glyphChar: stage.glyphChar,
    faces: stage.faces,
    line: stage.line,
    stageIndex: idx,                                  // 0..4
    stageCount: LADDER.length,
    modes: stage.modes,                               // resonant modes audible at this stage
    modesMax: LADDER[LADDER.length - 1].modes,
    atLast: idx === LADDER.length - 1,
    next: stage.next,
    nextSolid: nextStage ? nextStage.solid : null,
    day,
  };
}
