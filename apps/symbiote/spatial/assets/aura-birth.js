// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// AURA Birth / Chamber renderer v2 (#357, #358 review) — ONE persistent point-field that
// CONTINUOUSLY DEFORMS through the dimensional emergence. No stage swaps, no crossfades, no
// overlays: a single THREE.Points object whose position buffer morphs between equal-count
// deterministic targets — line -> triangle -> tetra -> cube -> octa -> dodeca -> icosa ->
// sphere -> trefoil tube -> the settled CYMATIC FACE. In the final state the (2,3) trefoil
// CENTERLINE drives the field: every point lives on the knot's tube, and the seeded standing
// wave modulates the tube radius — the knot IS the skeleton, its nodal surface IS the face.
//
// Layer honesty (architecture decision, 2026-07-12): the public key + signed receipt chain are
// the identity. This figure is a deterministic VISUAL ECHO only — it never signs, never proves a
// person, and is not a machine-readable identifier. Phrase-blind: the only input is the public
// genesis reference. Same seed -> byte-identical settled figure across birth, reload, rotation,
// and both surfaces (ceremony completion and the AURA organ).
//
// Palette: charcoal / ore / silver-white only. Phi is design inheritance in the (2,3) knot,
// never a dynamics claim. Three.js is MIT, vendored same-origin — no Baryon code, no CDN.
import * as THREE from './vendor/three.module.min.js';

const N = 4200; // one field, every stage expressed by the SAME N points
const SILVER = 0xd8dee9, GLINT = 0xeef2f7;

// ── deterministic seed stream (public genesis ref only) ─────────────────────────────────────────
function seedStream(ref) {
  let h = 1779033703 ^ String(ref || 'genesis').length;
  for (let i = 0; i < String(ref).length; i++) {
    h = Math.imul(h ^ String(ref).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── equal-count target builders (each returns Float32Array of N*3) ──────────────────────────────
function onSegments(segs) {
  // distribute N points evenly along a list of segments [[ax,ay,az,bx,by,bz], ...]
  const total = segs.reduce((s, g) => s + Math.hypot(g[3] - g[0], g[4] - g[1], g[5] - g[2]), 0);
  const out = new Float32Array(N * 3);
  let placed = 0;
  for (let s = 0; s < segs.length; s++) {
    const g = segs[s];
    const len = Math.hypot(g[3] - g[0], g[4] - g[1], g[5] - g[2]);
    const count = s === segs.length - 1 ? N - placed : Math.round((len / total) * N);
    for (let i = 0; i < count && placed < N; i++, placed++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      out[placed * 3] = g[0] + (g[3] - g[0]) * t;
      out[placed * 3 + 1] = g[1] + (g[4] - g[1]) * t;
      out[placed * 3 + 2] = g[2] + (g[5] - g[2]) * t;
    }
  }
  return out;
}
function polyEdges(geom, scale) {
  // sample the EDGES of a polyhedron — the constraint stage of emergence
  const e = new THREE.EdgesGeometry(geom);
  const p = e.attributes.position.array;
  const segs = [];
  for (let i = 0; i < p.length; i += 6) {
    segs.push([p[i] * scale, p[i + 1] * scale, p[i + 2] * scale, p[i + 3] * scale, p[i + 4] * scale, p[i + 5] * scale]);
  }
  e.dispose(); geom.dispose();
  return onSegments(segs);
}
function fibonacciSphere(r) {
  const out = new Float32Array(N * 3);
  const ga = Math.PI * (3 - Math.sqrt(5)); // golden angle — design inheritance, not a claim
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i;
    out[i * 3] = Math.cos(th) * rad * r;
    out[i * 3 + 1] = y * r;
    out[i * 3 + 2] = Math.sin(th) * rad * r;
  }
  return out;
}
/** The (2,3) trefoil centerline: x=sin t + 2 sin 2t, y=cos t − 2 cos 2t, z=−sin 3t (scaled). */
function trefoilPoint(t, scale) {
  return new THREE.Vector3(
    (Math.sin(t) + 2 * Math.sin(2 * t)) * scale,
    (Math.cos(t) - 2 * Math.cos(2 * t)) * scale,
    (-Math.sin(3 * t)) * scale,
  );
}
/**
 * The knot-driven field: N points on the TUBE around the trefoil centerline. `waves` (seeded)
 * modulates the tube radius along (u = centerline position, v = tube angle) — the cymatic face
 * AS the knot's own nodal surface. waveAmt 0 = bare toroidal tube; 1 = full cymatic face.
 */
function trefoilField(waves, waveAmt) {
  const out = new Float32Array(N * 3);
  const RINGS = 84, PER = Math.floor(N / RINGS);
  const scale = 0.36, r0 = 0.34;
  const up = new THREE.Vector3(0, 1, 0);
  let idx = 0;
  for (let ring = 0; ring < RINGS; ring++) {
    const u = (ring / RINGS) * Math.PI * 2;
    const c = trefoilPoint(u, scale);
    const tangent = trefoilPoint(u + 0.01, scale).sub(trefoilPoint(u - 0.01, scale)).normalize();
    const n1 = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const n2 = new THREE.Vector3().crossVectors(tangent, n1).normalize();
    const per = ring === RINGS - 1 ? N - idx : PER;
    for (let j = 0; j < per && idx < N; j++, idx++) {
      const v = (j / per) * Math.PI * 2;
      // seeded standing wave over (u, v): the SAME field carries skeleton and face
      let mod = 0;
      for (const w of waves) mod += w.A * Math.sin(w.ku * u + w.pu) * Math.cos(w.kv * v + w.pv);
      const r = r0 * (1 + waveAmt * mod);
      const px = c.x + (n1.x * Math.cos(v) + n2.x * Math.sin(v)) * r;
      const py = c.y + (n1.y * Math.cos(v) + n2.y * Math.sin(v)) * r;
      const pz = c.z + (n1.z * Math.cos(v) + n2.z * Math.sin(v)) * r;
      out[idx * 3] = px; out[idx * 3 + 1] = py; out[idx * 3 + 2] = pz;
    }
  }
  return out;
}
/** Deterministic fit-to-bounds: CENTER on the centroid, then uniform-scale so the max radius from
 *  that center fits `maxR`. Every stage lands centred and framed — no lopsided clipping. */
function fitToBounds(target, maxR) {
  let cx = 0, cy = 0, cz = 0;
  const n = target.length / 3;
  for (let i = 0; i < target.length; i += 3) { cx += target[i]; cy += target[i + 1]; cz += target[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let m = 0;
  for (let i = 0; i < target.length; i += 3) {
    const d = Math.hypot(target[i] - cx, target[i + 1] - cy, target[i + 2] - cz);
    if (d > m) m = d;
  }
  const s = m > 0 ? maxR / m : 1;
  for (let i = 0; i < target.length; i += 3) {
    target[i] = (target[i] - cx) * s;
    target[i + 1] = (target[i + 1] - cy) * s;
    target[i + 2] = (target[i + 2] - cz) * s;
  }
  return target;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * Deterministic point CORRESPONDENCE (#358 final review): reorder a target's points by a shared
 * canonical key — longitude around the vertical axis, then height — so index i refers to the same
 * angular slot in EVERY stage. Index-wise interpolation between adjacent targets then reads as a
 * coherent angular sweep instead of noisy random-looking trajectories. Bounded O(N log N), applied
 * once at build; no O(N^2) matching, no architecture change. Fully deterministic (no seed input).
 */
function canonicalize(target) {
  const n = target.length / 3;
  const idx = new Array(n);
  const lon = new Float32Array(n), hgt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    idx[i] = i;
    lon[i] = Math.atan2(target[i * 3 + 2], target[i * 3]); // longitude about the y-axis
    hgt[i] = target[i * 3 + 1];
  }
  idx.sort((a, b) => (lon[a] !== lon[b] ? lon[a] - lon[b] : hgt[a] - hgt[b]));
  const out = new Float32Array(target.length);
  for (let i = 0; i < n; i++) {
    const s = idx[i];
    out[i * 3] = target[s * 3]; out[i * 3 + 1] = target[s * 3 + 1]; out[i * 3 + 2] = target[s * 3 + 2];
  }
  target.set(out);
  return target;
}

/**
 * Mount the renderer. mode 'birth' = the continuous emergence then settle; 'base' (or
 * reduced-motion) = the deterministic settled figure immediately. Returns { dispose }.
 */
export function mountAuraBirth(canvas, { seed = 'genesis', mode = 'base', onSettled, onCaption } = {}) {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = seedStream(seed);
  // the seed shapes ONLY the cymatic wave family — framing and choreography are deterministic constants
  const waves = [0, 1, 2, 3].map(() => ({
    A: 0.16 + rnd() * 0.22,
    ku: 2 + Math.floor(rnd() * 5),
    kv: 2 + Math.floor(rnd() * 4),
    pu: rnd() * Math.PI * 2,
    pv: rnd() * Math.PI * 2,
  }));

  const FIT = 1.1; // every centred stage fits this radius — comfortable margin inside desktop AND 375px
  const T = (arr) => canonicalize(fitToBounds(arr, FIT)); // centre-fit, then canonical correspondence
  const targets = [
    T(onSegments([[-1.3, 0, 0, 1.3, 0, 0]])),                                                    // line
    T(onSegments([
      [0, 1.15, 0, -1.0, -0.6, 0], [-1.0, -0.6, 0, 1.0, -0.6, 0], [1.0, -0.6, 0, 0, 1.15, 0],
    ])),                                                                                         // triangle
    T(polyEdges(new THREE.TetrahedronGeometry(1), 1.12)),
    T(polyEdges(new THREE.BoxGeometry(1.5, 1.5, 1.5), 1)),
    T(polyEdges(new THREE.OctahedronGeometry(1), 1.2)),
    T(polyEdges(new THREE.DodecahedronGeometry(1), 1.12)),
    T(polyEdges(new THREE.IcosahedronGeometry(1), 1.18)),
    T(fibonacciSphere(1.12)),                                                                    // sphere
    T(trefoilField(waves, 0)),                                                                   // toroidal knot tube
    T(trefoilField(waves, 1)),                                                                   // settled cymatic face
  ];
  const FINAL = targets.length - 1;
  // the four grounded beats of the emergence, one per phase of the ~9.5s birth (leg -> caption)
  const CAPTIONS = [
    'a dimension', 'form takes on constraint', 'form takes on constraint', 'form takes on constraint',
    'form takes on constraint', 'form takes on constraint', 'a bounded observer', 'a bounded observer',
    'resonance — the field settles',
  ];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 3.8); // FIT 1.1 at z 3.8 fov 42 → ~25% margin, no clip at desktop or 375

  // ONE persistent object: the field. Additive silver points — luminous on the charcoal stage.
  const positions = new Float32Array(targets[0]); // start as the line
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: GLINT, size: 0.028, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const field = new THREE.Points(geom, material);
  scene.add(field);
  // deterministic framing: a fixed gentle tilt (identical for every node) — no random drift
  field.rotation.set(0.34, 0.62, 0.08);
  scene.add(new THREE.AmbientLight(SILVER, 1));

  function applyTarget(t) { positions.set(targets[t]); geom.attributes.position.needsUpdate = true; }
  function lerpTargets(a, b, k) {
    const A = targets[a], B = targets[b], e = easeInOut(k);
    for (let i = 0; i < positions.length; i++) positions[i] = A[i] + (B[i] - A[i]) * e;
    geom.attributes.position.needsUpdate = true;
  }

  function resize() {
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 320;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  const LEG = 1.05; // seconds per morph leg — one unbroken deformation, ~9.5s total
  let raf = 0, t0 = 0, settled = false, running = true, lastCap = null;
  const cap = (text) => { if (text !== lastCap) { lastCap = text; if (typeof onCaption === 'function') { try { onCaption(text); } catch { /* display only */ } } } };

  function settleNow() {
    if (settled) return;
    settled = true; applyTarget(FINAL); cap('');
    if (typeof onSettled === 'function') { try { onSettled(); } catch { /* display only */ } }
  }

  function frame(ts) {
    if (!running) return;
    if (!t0) t0 = ts;
    const t = (ts - t0) / 1000;
    field.rotation.y += 0.0035; // slow continuous turn — the one motion that never stops
    if (!settled && mode === 'birth') {
      const leg = Math.floor(t / LEG);
      if (leg >= FINAL) settleNow();
      else { lerpTargets(leg, leg + 1, (t - leg * LEG) / LEG); cap(CAPTIONS[leg] || ''); }
    }
    if (settled) {
      // the settled face breathes: the SAME field, wave amplitude gently swelling (deterministic)
      const k = 0.985 + Math.sin(t * 0.8) * 0.015;
      field.scale.setScalar(k);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  resize();
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  if (reduced || mode === 'base') {
    settled = true; applyTarget(FINAL);
    renderer.render(scene, camera);
    if (mode === 'birth' && typeof onSettled === 'function') { try { onSettled(); } catch { /* display only */ } }
    if (!reduced) raf = requestAnimationFrame(frame); // base still turns/breathes gently
  } else {
    raf = requestAnimationFrame(frame);
  }

  return {
    dispose() {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      renderer.dispose(); geom.dispose(); material.dispose();
    },
  };
}
