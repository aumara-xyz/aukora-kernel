// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.70c — AUMLOK ceremony wordlist (self-authored, license-clean; common English words are not copyrightable).
 * HONEST SCOPE: a MODEST list → generated-phrase entropy is MODEST (surfaced, never "unguessable" — GENESIS blocks that
 * without a legally-clean ≥300k dictionary). Acrostic = a 6-letter ANCHOR whose letters are the first letters of words
 * 2..7, each from POOL[letter]. Entropy = log2(|ANCHORS|) + Σ log2(|POOL[letter]|). Anchors use only COMMON letters
 * (every anchor letter has a real ≥24-word pool) so generation always completes. Real authority root = ML-DSA-65 (Step 4).
 */
export const ANCHORS: string[] = [
  'anchor', 'beacon', 'candle', 'dapper', 'ember', 'falcon', 'garden', 'hammer', 'island', 'ladder',
  'meadow', 'nectar', 'orchid', 'pillar', 'ribbon', 'saddle', 'temple', 'velvet', 'walnut', 'yonder',
  'bridge', 'castle', 'forest', 'harbor', 'lagoon', 'mirror', 'pebble', 'rocket', 'silver', 'thread',
  'violet', 'willow', 'copper', 'gentle', 'hollow', 'cinder', 'damper', 'fennel', 'gander', 'helmet',
].filter((w) => w.length === 6);

// POOL[letter] = candidate words whose first letter is `letter` (for words 2..7). ~24+ common words per used letter.
export const POOL: Record<string, string[]> = {
  a: ['apple', 'amber', 'arrow', 'azure', 'acorn', 'anvil', 'attic', 'aspen', 'alloy', 'arbor', 'angle', 'agile', 'await', 'adorn', 'album', 'alert', 'apron', 'ample', 'array', 'atlas', 'aura', 'avert', 'awake', 'aroma', 'asset', 'audit', 'amend', 'admit'],
  b: ['brook', 'bloom', 'brave', 'blaze', 'brisk', 'bison', 'birch', 'broom', 'badge', 'beryl', 'blend', 'bluff', 'baker', 'banjo', 'beach', 'beard', 'began', 'belt', 'bench', 'berry', 'blade', 'blunt', 'board', 'bolt', 'bonus', 'brick', 'brink', 'brush'],
  c: ['cedar', 'cliff', 'clove', 'crisp', 'coral', 'crane', 'cabin', 'cocoa', 'creek', 'cider', 'civic', 'comet', 'cubic', 'curve', 'champ', 'chalk', 'charm', 'chess', 'chime', 'clamp', 'clasp', 'clock', 'cloud', 'coast', 'craft', 'crown', 'crumb', 'cycle'],
  d: ['daisy', 'delta', 'dwell', 'drift', 'dusty', 'diner', 'dodge', 'dough', 'drake', 'dryer', 'depot', 'decoy', 'ditch', 'dance', 'dandy', 'dealt', 'decal', 'decor', 'delay', 'depth', 'diary', 'digit', 'dimly', 'diver', 'dozen', 'drain', 'dream', 'drove'],
  e: ['eagle', 'elbow', 'ember', 'easel', 'extra', 'equal', 'edict', 'elope', 'enjoy', 'envoy', 'erase', 'event', 'evoke', 'exact', 'eject', 'eager', 'early', 'earth', 'easy', 'eaten', 'edge', 'elder', 'elect', 'elite', 'empty', 'enact', 'endow', 'enter'],
  f: ['ferry', 'flint', 'frost', 'flame', 'feast', 'forge', 'fable', 'fancy', 'feral', 'flock', 'fluid', 'foggy', 'fruit', 'fence', 'fetch', 'fiber', 'field', 'fifth', 'final', 'fjord', 'flair', 'flash', 'fleet', 'floor', 'focal', 'force', 'frame', 'fresh'],
  g: ['grove', 'glint', 'gully', 'gauge', 'glaze', 'grain', 'globe', 'goose', 'grace', 'grasp', 'greet', 'guild', 'gusto', 'gamma', 'gates', 'gavel', 'gecko', 'gem', 'genre', 'giant', 'given', 'gleam', 'glide', 'glory', 'gloss', 'gourd', 'grape', 'grill'],
  h: ['heron', 'hatch', 'hazel', 'honey', 'humid', 'horse', 'hutch', 'hover', 'hyena', 'hinge', 'hardy', 'hasty', 'heath', 'hilly', 'humor', 'habit', 'haiku', 'hands', 'happy', 'haste', 'haven', 'heart', 'heavy', 'hedge', 'hello', 'hilt', 'hotel', 'house'],
  i: ['ivory', 'inlet', 'index', 'igloo', 'image', 'inbox', 'ionic', 'irate', 'issue', 'ideal', 'incur', 'inert', 'islet', 'icing', 'idiom', 'igneous', 'imbue', 'imply', 'inset', 'inter', 'intro', 'ivory', 'ivied', 'irony', 'ingot', 'inlay', 'input', 'irate'],
  k: ['kayak', 'kiosk', 'knack', 'knoll', 'kudos', 'kraft', 'kebab', 'kefir', 'koala', 'krill', 'knead', 'kneel', 'kitty', 'kazoo', 'ketch', 'khaki', 'kale', 'kappa', 'kelp', 'kernel', 'kettle', 'keyed', 'kicks', 'kiln', 'kinder', 'kingdom', 'kite', 'knight'],
  l: ['lemon', 'linen', 'lunar', 'lodge', 'latch', 'leafy', 'lever', 'lilac', 'lyric', 'llama', 'loyal', 'lucid', 'lumen', 'lupin', 'lotus', 'label', 'labor', 'ladle', 'lance', 'lapse', 'large', 'laser', 'latte', 'layer', 'leant', 'ledge', 'level', 'light'],
  m: ['maple', 'mango', 'marsh', 'mirth', 'mocha', 'mossy', 'motto', 'mural', 'music', 'mason', 'medal', 'merit', 'modal', 'moose', 'macro', 'madam', 'magic', 'major', 'mango', 'maple', 'march', 'maybe', 'mayor', 'metal', 'meter', 'midst', 'miner', 'motor'],
  n: ['noble', 'north', 'nudge', 'nylon', 'navel', 'nerdy', 'niche', 'ninja', 'noise', 'nomad', 'nurse', 'nutty', 'naval', 'never', 'newer', 'nicer', 'night', 'noble', 'nodal', 'noisy', 'noon', 'north', 'notch', 'novel', 'nudge', 'nylon', 'nymph', 'noted'],
  o: ['ocean', 'olive', 'onset', 'opera', 'orbit', 'otter', 'ozone', 'octet', 'omega', 'onion', 'oasis', 'oaken', 'often', 'olden', 'omit', 'onset', 'opal', 'orbit', 'order', 'organ', 'osprey', 'ought', 'ounce', 'outer', 'owing', 'owlet', 'oxen', 'oasis'],
  p: ['plaza', 'pearl', 'piano', 'plume', 'prism', 'porch', 'punch', 'panel', 'pixel', 'poppy', 'pouch', 'proxy', 'pulse', 'puree', 'patio', 'palm', 'panda', 'paper', 'party', 'pasta', 'patch', 'pause', 'peach', 'pedal', 'penny', 'petal', 'plank', 'plant'],
  r: ['raven', 'reign', 'ridge', 'roost', 'rumor', 'rural', 'ranch', 'rebel', 'relic', 'rhino', 'rinse', 'robin', 'rowdy', 'rover', 'radar', 'rally', 'ranch', 'range', 'rapid', 'ratio', 'reach', 'realm', 'relay', 'reply', 'ridge', 'river', 'roast', 'royal'],
  s: ['sable', 'spark', 'storm', 'swift', 'slate', 'snowy', 'spire', 'stork', 'sugar', 'sunny', 'syrup', 'salsa', 'scout', 'sedan', 'shiny', 'sable', 'salad', 'sandy', 'sauce', 'scarf', 'scene', 'scope', 'sense', 'shade', 'sharp', 'shelf', 'shore', 'sloth'],
  t: ['tiger', 'thorn', 'tulip', 'tonic', 'truce', 'trout', 'taffy', 'tango', 'tease', 'tepid', 'tidal', 'topaz', 'torch', 'trail', 'table', 'tally', 'tango', 'taper', 'tardy', 'taste', 'teach', 'tempo', 'tenor', 'theme', 'thumb', 'tidal', 'token', 'trace'],
  u: ['ultra', 'umbra', 'uncle', 'unfit', 'unify', 'unzip', 'upper', 'urban', 'usage', 'usher', 'utter', 'union', 'unbox', 'unwed', 'udder', 'ulcer', 'umpire', 'unbar', 'uncut', 'under', 'undue', 'unite', 'unlit', 'until', 'upend', 'upset', 'urged', 'usual'],
  v: ['vapor', 'vinyl', 'vouch', 'valor', 'vault', 'venom', 'verge', 'vigor', 'villa', 'vista', 'vivid', 'vocal', 'voter', 'vowel', 'vague', 'valet', 'valid', 'value', 'vanity', 'vegan', 'velar', 'venue', 'verse', 'vexed', 'video', 'viola', 'viper', 'visor'],
  w: ['wagon', 'wharf', 'whisk', 'widen', 'witty', 'woven', 'wrist', 'wafer', 'waltz', 'weave', 'wedge', 'whale', 'wheat', 'windy', 'woody', 'wader', 'wager', 'wagon', 'waist', 'waltz', 'water', 'weary', 'weigh', 'wharf', 'wheel', 'whirl', 'widow', 'world'],
  y: ['yacht', 'yearn', 'yeast', 'yield', 'yodel', 'young', 'youth', 'yucca', 'yummy', 'yokel', 'yapok', 'yip', 'yodel', 'yahoo', 'yamen', 'yards', 'yarns', 'yawns', 'years', 'yeast', 'yells', 'yeti', 'yield', 'yodel', 'yoga', 'yolk', 'young', 'yummy'],
};

// dedupe each pool (defensive — a couple of authored repeats above)
for (const k of Object.keys(POOL)) POOL[k] = Array.from(new Set(POOL[k]));
// keep only anchors whose every letter has a usable pool (so generation always completes)
export const USABLE_ANCHORS = ANCHORS.filter((w) => [...w].every((ch) => (POOL[ch] || []).length >= 8));
