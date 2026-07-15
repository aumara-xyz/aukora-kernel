// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The AUMLOK acrostic phrase — core-owned generation (canonical-ceremony round, #242).
 *
 * Moved VERBATIM from the approve door's retired phrase panel so the ONE bind/rotation ceremony
 * (core/src/aumlokBindCeremony.ts) mints the owner's intended AUMLOK-specific shape instead of a
 * generic word list. The phrase is a TRUE ACROSTIC (owner's design): a 6-letter ANCHOR word and six
 * words whose first letters spell the anchor — the anchor as the vertical spine, shown as a mnemonic
 * but never typed and never stored. e.g. HARBOR → hazel amber raven birch ochre rowan.
 *
 * Owner's meaning layer (2026-07-08, ROOT · UNITE · RISE / tri hita karana): the words carry the hue
 * of their row. Rows 1-2 (green) are of the earth — ROOT. Rows 3-4 (blue) are of each other — UNITE.
 * Rows 5-6 (purple) are of what lifts — RISE. Entropy note: themed buckets are 2-4 words per letter
 * (median 3-4), so phrase entropy is essentially unchanged versus a single pool
 * (~log2(18) + 6·log2(2..4) ≈ 15-16 bits) — and the phrase never authenticates alone: the Ed25519 key
 * signs; only a salted fingerprint is ever stored, freshly salted per write.
 *
 * This module GENERATES ONLY. It writes nothing, verifies nothing, and grants nothing.
 */
import { randomBytes } from 'crypto';

type Theme = 'root' | 'unite' | 'rise';
const THEME_BY_ROW: Theme[] = ['root', 'root', 'unite', 'unite', 'rise', 'rise'];
const WORDS_THEMED: Record<Theme, Record<string, string[]>> = {
  root: { // green — nature, of the earth
    a: ['amber', 'aspen', 'alder', 'acorn'], b: ['birch', 'brook', 'bramble', 'basin'],
    c: ['cedar', 'coral', 'clover', 'cliff'], d: ['delta', 'dune', 'drift', 'dawn'],
    e: ['elm', 'ember', 'estuary', 'eddy'], f: ['fern', 'flint', 'fjord', 'frost'],
    g: ['grove', 'glade', 'granite', 'garnet'], h: ['hazel', 'heath', 'hollow', 'harbor'],
    i: ['iris', 'ivy', 'island', 'inlet'], j: ['juniper', 'jasper', 'jade'],
    k: ['kelp', 'kestrel', 'knoll'], l: ['larch', 'lagoon', 'lichen', 'loam'],
    m: ['maple', 'marsh', 'meadow', 'moss'], n: ['nettle', 'nimbus', 'north', 'nectar'],
    o: ['ochre', 'otter', 'oasis', 'oak'], p: ['pebble', 'pine', 'petal', 'prairie'],
    q: ['quartz', 'quince', 'quarry'], r: ['rowan', 'reef', 'river', 'reed'],
    s: ['sage', 'slate', 'storm', 'spruce'], t: ['thorn', 'timber', 'tide', 'tundra'],
    u: ['umber', 'upland', 'ursa'], v: ['vale', 'verdant', 'vine', 'violet'],
    w: ['willow', 'wren', 'walnut', 'winter'], y: ['yarrow', 'yew', 'yonder'], z: ['zephyr', 'zinnia', 'zinc'],
  },
  unite: { // blue — people, of each other
    a: ['ally', 'accord', 'amity', 'anthem'], b: ['banter', 'bond', 'bridge', 'brother'],
    c: ['circle', 'chorus', 'comrade', 'cradle'], d: ['dance', 'duet', 'dwell', 'dinner'],
    e: ['embrace', 'ensemble', 'elder', 'emissary'], f: ['friend', 'family', 'fellow', 'feast'],
    g: ['gather', 'guest', 'guide', 'gift'], h: ['hearth', 'harmony', 'hello', 'haven'],
    i: ['invite', 'inn', 'icon'], j: ['jest', 'join', 'jubilee'],
    k: ['kin', 'kindred', 'keepsake'], l: ['laughter', 'link', 'lodge', 'lullaby'],
    m: ['mingle', 'mirth', 'mentor', 'market'], n: ['neighbor', 'nest', 'nomad'],
    o: ['offer', 'oath', 'opus'], p: ['partner', 'parley', 'pact', 'plaza'],
    q: ['quorum', 'quilt', 'quip'], r: ['rally', 'rapport', 'refuge', 'ring'],
    s: ['supper', 'salon', 'smile', 'shelter'], t: ['tribe', 'trust', 'toast', 'tavern'],
    u: ['unity', 'union', 'usher'], v: ['vow', 'voice', 'visit', 'village'],
    w: ['welcome', 'waltz', 'weave'], y: ['yarn', 'youth'], z: ['zeal', 'zest'],
  },
  rise: { // purple — higher purpose, of what lifts
    a: ['ascend', 'aura', 'altar', 'arrow'], b: ['beacon', 'bless', 'beyond'],
    c: ['calling', 'cosmos', 'crown', 'compass'], d: ['destiny', 'devotion', 'dharma'],
    e: ['eternal', 'exalt', 'essence'], f: ['faith', 'flame', 'favor'],
    g: ['grace', 'glory', 'gleam'], h: ['halo', 'heaven', 'horizon', 'hymn'],
    i: ['ideal', 'infinite', 'inspire'], j: ['journey', 'justice', 'jewel'],
    k: ['karma', 'keystone', 'kindle'], l: ['light', 'lumen', 'lodestar', 'legacy'],
    m: ['mercy', 'miracle', 'muse', 'myth'], n: ['noble', 'nirvana', 'nova'],
    o: ['oracle', 'omen', 'onward'], p: ['prayer', 'pilgrim', 'pinnacle', 'psalm'],
    q: ['quest', 'quasar'], r: ['radiant', 'rise', 'reverie', 'realm'],
    s: ['sacred', 'spirit', 'soul', 'summit'], t: ['temple', 'truth', 'totem'],
    u: ['uplift', 'upward', 'ultra'], v: ['vision', 'virtue', 'vessel'],
    w: ['wisdom', 'wonder', 'worship'], y: ['yearn', 'yonder'], z: ['zenith', 'zen'],
  },
};
// 6-letter anchor words — every letter must have a bucket in EVERY theme (letters can land on any row).
const ANCHOR_WORDS = ['harbor', 'cinder', 'garnet', 'meadow', 'willow', 'timber', 'sorrel', 'frosty',
  'velvet', 'silver', 'copper', 'walnut', 'embers', 'thorns', 'ravens', 'pewter', 'corals', 'winter'];

function pick<T>(arr: T[]): T { return arr[randomBytes(1)[0] % arr.length]; }

export interface AcrosticPhrase {
  /** The 6-letter anchor. Owner correction (#284 follow-up): the anchor is WORD ZERO of the phrase —
   *  it is SHOWN, TYPED, and fingerprinted, followed by the six themed acrostic words. */
  anchor: string;
  /** The six themed words, first letters spelling the anchor, one per themed row. */
  words: string[];
  /** The full seven tokens as typed/shown: `[anchor, ...words]`. */
  tokens: string[];
  /** The canonical typed-back form: SEVEN words dash-joined — anchor first, then the six themed words.
   *  The fingerprint is over THIS. Typing only the six-word tail (no anchor) does not match. */
  phrase: string;
}

/** Build an acrostic: a 6-letter anchor (word zero) + one themed word per anchor letter, whose initials
 *  spell the anchor, each drawn from its ROW's theme (root/root/unite/unite/rise/rise). No repeated
 *  words. The canonical phrase is the SEVEN tokens `[anchor, ...words]`. */
export function generateAcrosticPhrase(): AcrosticPhrase {
  const build = (anchor: string, words: string[]): AcrosticPhrase => {
    const tokens = [anchor, ...words];
    return { anchor, words, tokens, phrase: tokens.join('-') };
  };
  outer: for (let tries = 0; tries < 60; tries++) {
    const anchor = pick(ANCHOR_WORDS);
    const letters = anchor.split('');
    const words: string[] = [];
    for (let i = 0; i < letters.length; i++) {
      const pool = (WORDS_THEMED[THEME_BY_ROW[i]][letters[i]] ?? []).filter((w) => !words.includes(w));
      if (!pool.length) continue outer;
      words.push(pick(pool));
    }
    return build(anchor, words);
  }
  const anchor = 'harbor';
  const words = anchor.split('').map((c, i) => WORDS_THEMED[THEME_BY_ROW[i]][c][0]);
  return build(anchor, words);
}
