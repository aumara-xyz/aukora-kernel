// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// AURA Birth / Chamber renderer (#357) — structural pins for the ONE shared display-only renderer.
// It must be phrase-blind (seeded only by the public genesis ref), same-origin (vendored MIT
// Three.js, no CDN), display-only (never signs/gates/reads back), and honor reduced-motion with the
// deterministic final state. The one-time birth plays on FIRST bind only; the AURA organ and the
// ceremony completion use the SAME renderer.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf-8');
const renderer = read('spatial/assets/aura-birth.js');
const door = read('spatial/aumlok-bind-serve.ts');
const aura = read('spatial/app/aura.js');

describe('the renderer is phrase-blind and same-origin', () => {
  it('imports vendored Three.js same-origin — no CDN, no bare specifier', () => {
    expect(renderer).toContain("import * as THREE from './vendor/three.module.min.js'");
    expect(renderer).not.toMatch(/https?:\/\//); // no remote fetches
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'spatial/assets/vendor/three.module.min.js'))).toBe(true);
  });

  it('is seeded ONLY by the genesis ref — no phrase/key/typing IDENTIFIER reaches it', () => {
    // code-shaped tokens only (the module's honest prose may say "phrase-blind"); none of these
    // phrase-/key-/typing-carrying identifiers may appear
    for (const banned of ['typedRail', 'typedPhrase', 'privateKeyHex', 'normalizePhrase', 'fingerprintSha', 'keystroke', 'keydown', 'clipboardData']) {
      expect(renderer).not.toContain(banned);
    }
    expect(renderer).toContain('seedStream'); // deterministic PRNG from the public ref
    expect(renderer).toContain('seed = ');     // the ONLY input is the public seed string
  });

  it('honors reduced-motion / base mode with the deterministic FINAL state (no sequence)', () => {
    expect(renderer).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(renderer).toContain("if (reduced || mode === 'base')");
    expect(renderer).toContain('applyTarget(FINAL)');
  });

  it('is ONE persistent morphing field, not a slideshow of swapped objects (#358 review)', () => {
    expect(renderer).toContain('const field = new THREE.Points'); // a single render object
    expect(renderer).toContain('lerpTargets'); // continuous deformation between equal-count targets
    expect(renderer).not.toContain('showOnly'); // the old stage-swap/crossfade is gone
    expect(renderer).not.toContain('setStageOpacity');
    expect(renderer).toContain('const N = 4200'); // every stage expressed by the SAME N points
  });

  it('traverses the dimensional emergence and the trefoil CENTERLINE drives the cymatic face', () => {
    for (const g of ['TetrahedronGeometry', 'BoxGeometry', 'OctahedronGeometry', 'DodecahedronGeometry', 'IcosahedronGeometry']) {
      expect(renderer).toContain(g);
    }
    // the (2,3) trefoil is the analytic centerline, and the SAME field's tube radius is wave-modulated
    expect(renderer).toContain('function trefoilPoint');
    expect(renderer).toContain('Math.sin(2 * t)'); // (2,3): 2t and 3t harmonics
    expect(renderer).toContain('Math.sin(3 * t)');
    expect(renderer).toContain('trefoilField(waves, 0)'); // bare toroidal tube
    expect(renderer).toContain('trefoilField(waves, 1)'); // settled cymatic face — SAME field
    expect(renderer).not.toContain('knot-over-points');
  });

  it('has deterministic fit-to-bounds framing — no random drift (#358 review)', () => {
    expect(renderer).toContain('function fitToBounds');
    expect(renderer).toContain('field.rotation.set(0.34, 0.62, 0.08)'); // a FIXED tilt, identical every node
    expect(renderer).not.toContain('rnd() - 0.5'); // no random framing/tilt
    // the seed shapes only the cymatic WAVE family, never the camera or framing
    expect(renderer).toContain('the seed shapes ONLY the cymatic wave family');
  });

  it('deterministic point correspondence: every target canonicalized by a shared key, bounded not O(N^2) (#358 final)', () => {
    expect(renderer).toContain('function canonicalize');
    expect(renderer).toContain('idx.sort'); // O(N log N), the shared angular ordering
    expect(renderer).toContain('Math.atan2(target[i * 3 + 2], target[i * 3])'); // longitude key
    // EVERY target flows through canonicalize (via the T() wrapper), not just some
    expect(renderer).toContain('const T = (arr) => canonicalize(fitToBounds(arr, FIT))');
    expect((renderer.match(/T\(/g) || []).length).toBeGreaterThanOrEqual(10); // all 10 stages
  });

  it('the birth carries grounded changing captions: dimension -> constraint -> observer -> resonance', () => {
    expect(renderer).toContain('const CAPTIONS');
    expect(renderer).toContain('a dimension');
    expect(renderer).toContain('form takes on constraint');
    expect(renderer).toContain('a bounded observer');
    expect(renderer).toContain('resonance — the field settles');
    expect(renderer).toContain('onCaption'); // surfaced to the page, cleared on settle
    // no consciousness/humanity claim smuggled into the captions
    for (const banned of ['conscious', 'sentient', 'alive human', 'proves you']) expect(renderer.toLowerCase()).not.toContain(banned);
  });

  it('display only: no authority/sign/apply/readback surface in the renderer', () => {
    // code-shaped tokens (prose may say "design"); no ceremony/authority call surface
    for (const banned of ['grantsAuthority', 'signPromotion', '.sign(', '/api/bind/complete', '/api/approve', 'completeCeremony', 'postMessage']) {
      expect(renderer).not.toContain(banned);
    }
  });
});

describe('the door wires birth on FIRST bind only, phrase-blind, fail-soft', () => {
  it('serves the renderer + three.js same-origin via a strict filename allowlist', () => {
    expect(door).toContain("p === '/assets/aura-birth.js' || p === '/assets/vendor/three.module.min.js'");
    expect(door).toContain("if (rel.includes('..'))"); // no traversal
  });

  it('starts birth ONLY on a bind (never rotate), seeded by the public genesisRef', () => {
    expect(door).toContain('if(v.mode==="bind") startBirth()');
    const fn = door.slice(door.indexOf('async function startBirth'), door.indexOf('async function renderGenesisBase'));
    expect(fn).toContain('g.packet.genesisRef'); // the only seed — public, phrase-blind
    expect(fn).toContain('mode:"birth"');
    expect(fn).not.toContain('typedRail'); // no phrase material ever enters the renderer
  });
});

describe('the AURA organ uses the same renderer and drops the alarming banner (#357)', () => {
  it('mounts the shared renderer in base mode from the same genesis ref', () => {
    expect(aura).toContain("import { mountAuraBirth } from '/assets/aura-birth.js'");
    expect(aura).toContain("mode: 'base'");
    expect(aura).toContain('g.packet.genesisRef');
  });

  it('the alarming legacy integrity banner is removed from the primary experience', () => {
    expect(aura).not.toContain("the local record failed its integrity check and was re-derived from lesson evidence");
    expect(aura).toContain("tamperNote.style.display = 'none'");
  });
});

describe('owner first-impression pass (#358, round 3): telescoping panels, ceremony-order color, honest crypto', () => {
  it('the four facts are telescoping <details> panels with LEFT-justified text and a subtle chevron — no tell-me-more/show-me-math buttons (owner order 2026-07-12)', () => {
    // the whole panel is one <details>; the header is a .fact-sum summary with a CSS chevron
    expect((door.match(/<details class="fact /g) || []).length).toBeGreaterThanOrEqual(8); // 4 arrival + 4 bound recap
    expect(door).toContain('class="fact-sum"');
    expect(door).toContain('.fact-sum::after{content:""'); // the chevron is a pure-CSS arrow, not a button
    expect(door).toContain('details.fact[open] .fact-sum::after'); // it rotates open
    expect(door).not.toContain('>tell me more<');   // the buttons the owner called redundant are gone
    expect(door).not.toContain('>show me the math<');
    expect(door).not.toContain('class="tele"');     // the old telescope grammar is gone entirely
    expect(door.slice(door.indexOf('.facts{'), door.indexOf('details.fact{'))).toContain('text-align:left');
  });

  it('color runs in CEREMONY ORDER green→blue→purple→GOLD, with gold = the user/AURA (owner: "the user is the gold")', () => {
    const arrive = door.slice(door.indexOf('id="s-arrive"'), door.indexOf('id="s-recover"'));
    // the four arrival panels appear in this exact order
    const order = ['fact f-l', 'fact f-c', 'fact f-r', 'fact f-o'].map((c) => arrive.indexOf(c));
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly increasing → correct order
    expect(order.every((i) => i > 0)).toBe(true);
    // gold is the AURA (the owner made visible), not the receipt
    expect(arrive.slice(arrive.indexOf('fact f-o'))).toContain('your <b>AURA</b>');
    expect(door).toContain('details.fact.f-o{--fc:255,193,122}'); // a warm GOLD, distinct from the completion halo
  });

  it('the detail is super-simple first, then a REAL hard-math block with formulas — and names the mandatory live hybrid honestly', () => {
    expect((door.match(/class="fact-math"/g) || []).length).toBeGreaterThanOrEqual(4); // every arrival fact carries its math block
    expect(door).toContain('class="ml"'); // the "the actual crypto" label
    expect((door.match(/class="f"/g) || []).length).toBeGreaterThanOrEqual(6); // rendered formula lines
    // the REAL implemented crypto — pinned so the door can never drift back into overclaiming
    for (const real of ['Ed25519', 'Pollard', 'discrete-log', 'scrypt', 'N=32768', 'drand', 'BLS12-381', 'SHA-256', '(2,3) trefoil knot', 'standing waves']) {
      expect(door).toContain(real);
    }
    // the formulas themselves are present
    expect(door).toContain('P = k · B'); // Ed25519 keygen
    expect(door).toContain('e( sig , g₂ ) = e( H(round) , pk )'); // BLS pairing check
    expect(door).toContain('hᵢ = SHA-256( hᵢ₋₁ ‖ event ‖ signature )'); // the receipt hash chain
    expect(door).toContain('Ed25519 + ML-DSA-65 hybrid');
    expect(door).toContain('both signatures must verify');
    expect(door).not.toContain('ML-DSA-65) is designed and reserved for later');
  });

  it('the AURA panel goes sci-fi about where it evolves — offline ID, alien-QR future, honestly "not built yet"', () => {
    expect(door).toContain('offline ID');
    expect(door).toContain('Like a QR code, but alive');
    expect(door.toLowerCase()).toContain('designed, not built yet'); // the future is never sold as present
    expect(door).toContain('unlocks nothing'); // today it is a mirror, powerless
  });

  it('AURA is named on arrival AND on completion — the figure has a home the owner can find', () => {
    expect((door.match(/<b>AURA<\/b>/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(door).toContain('AURA</b> organ'); // points at where the standing figure lives in the app
  });

  it('the bound screen is a clear RECAP in the same telescoping panels, and a rotation honestly hides it', () => {
    const recap = door.slice(door.indexOf('id="bound-recap"'), door.indexOf('id="aftercare"'));
    expect(recap).toContain('id="keyline"');      // the key fingerprint lives INSIDE the green panel
    expect(recap).toContain('id="anchor-truth"'); // the time truth lives INSIDE the receipt panel
    expect(recap).toContain('your <b>AURA</b>');
    expect((recap.match(/<details class="fact /g) || []).length).toBe(4); // four recap panels
    expect(door).toContain('$("#bound-recap").style.display="none"'); // a rotation is not a birth — the recap hides honestly
  });

  it('the reveal screen: GOLD anchor hero + a THREE-BOX theme row (Tri Hita Karana) + a centered SVG write-it-down slap (owner round 4)', () => {
    const reveal = door.slice(door.indexOf('id="s-reveal"'), door.indexOf('id="s-confirm"'));
    expect(reveal).toContain('class="anchor-hero"');        // word zero gets its own gold bar
    expect(reveal).toContain('id="anchor-hero-w"');
    expect(reveal).toContain('word zero · your anchor');
    // the verbose "trick" box is gone; the three themes are three color boxes in a row
    expect(reveal).not.toContain('class="teach"');
    expect(reveal).toContain('class="theme-row"');
    expect((reveal.match(/class="theme-box/g) || []).length).toBe(3);
    expect(reveal).toContain('Tri Hita Karana');           // the Balinese framing, on one floating line
    for (const t of ['Palemahan', 'Pawongan', 'Parahyangan']) expect(reveal).toContain(t);
    // the write-it-down slap: centered, an SVG pen (NEVER an emoji), simpler copy
    expect(reveal).toContain('class="writedown"');
    expect(reveal).toContain('WRITE THESE DOWN NOW');
    expect(reveal).toContain('<svg');                       // an SVG icon, not an emoji
    expect(reveal).toContain('You will not be shown these again');
    expect(reveal).toContain('refresh your phrase later');
    // the anchor is rendered into the hero and wiped on completion (still never stored/posted)
    expect(door).toContain('hero.textContent=String(tokens[0]||"")');
    expect(door).toContain('const h=$("#anchor-hero-w"); if(h) h.textContent="";');
  });

  it('NO EMOJIS anywhere in the door (owner order 2026-07-12: use SVG, never an emoji; no ✓/✍️/etc.)', () => {
    // sweep for the emoji ranges the door used to contain (pencil, check mark, misc pictographs)
    expect(door).not.toMatch(/[✀-➿\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}✅✔️]/u);
  });

  it('time truth is honest and fail-soft: plain-language verdict, real drand-round gate, VDF never mentioned', () => {
    // the mono jargon is gone; the verdict is a full plain sentence either way
    expect(door).toContain('Time anchor: verified.');
    expect(door).toContain('Time anchor: local only.');
    expect(door).toContain('v.echo.packet.drand.round'); // the verdict reflects a REAL verified round only
    expect(door.toLowerCase()).not.toContain('vdf'); // unbuilt — never surfaced in the page
    expect(door.toLowerCase()).not.toContain('verifiable delay');
  });
});

describe('layer-honesty copy (#358 review): the figure is a visual echo, never proof', () => {
  it('the ceremony names the identity/echo distinction plainly', () => {
    expect(door).toContain('Your key is the identity. This figure is its <b>deterministic visual echo</b>');
    expect(door).toContain('never signs and never proves a person');
  });
  it('the AURA hero says the same', () => {
    expect(aura).toContain('deterministic visual echo');
    expect(aura).toContain('never signs and never proves a person');
  });
});
