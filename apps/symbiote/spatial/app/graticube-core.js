// Aukora Spatial — GRATICUBE core: the pure game brain (no DOM, no imports).
// CardRepository (filtering + faceted counts) and CardSelector (shuffle bag with
// recent-card avoidance), exactly per the owner's build brief:
//   - filters compose; an empty group means "all of that group"
//   - selection draws through a shuffled queue (never pure random)
//   - the last 15 drawn cards are deprioritized when the bag reshuffles
//   - the bag resets when filters change (recent history survives the reset)
// Kept import-free so `bun` can exercise it headlessly in tests.

export const RECENT_AVOID = 15;

export const FILTER_GROUPS = [
  { key: 'deck',       label: 'Deck',       field: (c) => c.source_decks,  values: ['alive', 'alive_bonus', 'og', 'abundance'] },
  { key: 'depth',      label: 'Depth',      field: (c) => c.depth,      values: ['D1', 'D2', 'D3', 'D4'],
    labels: { D1: 'D1 Light', D2: 'D2 Personal', D3: 'D3 Vulnerable', D4: 'D4 Deep' } },
  { key: 'complexity', label: 'Complexity', field: (c) => c.complexity, values: ['C1', 'C2', 'C3', 'C4'],
    labels: { C1: 'C1 Very Simple', C2: 'C2 Simple', C3: 'C3 Moderate', C4: 'C4 Complex' } },
  { key: 'audience',   label: 'Audience',   field: (c) => c.audience,   values: ['Youth', 'Universal', 'Advanced'] },
  { key: 'context',    label: 'Context',    field: (c) => c.context,    values: ['Group-safe', 'Pair', 'Facilitated-only'] },
  { key: 'energy',     label: 'Energy',     field: (c) => c.energy,     values: ['Playful', 'Reflective', 'Activating', 'Grounding'] },
];

const matchesGroup = (card, group, selected) => {
  if (!selected || selected.size === 0) return true;            // empty group = all
  const v = group.field(card);
  return Array.isArray(v) ? v.some((x) => selected.has(x)) : selected.has(v);
};

// filters: { deck: Set, depth: Set, ... } (any group may be missing/empty)
export function filterCards(cards, filters) {
  return cards.filter((c) => FILTER_GROUPS.every((g) => matchesGroup(c, g, filters[g.key])));
}

// Faceted option counts: each group's counts are computed against the pool
// filtered by every OTHER group, so an option shows what picking it would yield.
export function optionCounts(cards, filters) {
  const out = {};
  for (const g of FILTER_GROUPS) {
    const others = cards.filter((c) =>
      FILTER_GROUPS.every((o) => o.key === g.key || matchesGroup(c, o, filters[o.key])));
    const m = {};
    for (const v of g.values) m[v] = 0;
    for (const c of others) {
      const v = g.field(c);
      for (const x of Array.isArray(v) ? v : [v]) if (x in m) m[x] += 1;
    }
    out[g.key] = m;
  }
  return out;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The shuffle bag. `rng` is injectable for tests (defaults to Math.random).
export function makeSelector(cards, rng = Math.random) {
  let pool = cards.slice();
  let bag = [];
  const recent = [];   // most-recent-last, capped at RECENT_AVOID

  function rebuild() {
    const avoid = new Set(recent);
    const fresh = [];
    const seenRecently = [];
    for (const c of shuffle(pool, rng)) (avoid.has(c.id) ? seenRecently : fresh).push(c);
    // recently-seen cards go to the BACK of the queue — drawn only when the
    // fresh ones run out (small pools still work; nothing is ever unreachable).
    bag = fresh.concat(seenRecently);
  }

  return {
    setPool(next) { pool = next.slice(); bag = []; },   // filters changed → bag resets
    poolSize() { return pool.length; },
    remaining() { return bag.length; },
    recentIds() { return recent.slice(); },
    next() {
      if (pool.length === 0) return null;
      if (bag.length === 0) rebuild();
      const card = bag.shift();
      recent.push(card.id);
      if (recent.length > RECENT_AVOID) recent.shift();
      return card;
    },
  };
}
