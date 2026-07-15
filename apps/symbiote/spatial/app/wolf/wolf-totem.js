// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// The golden wolf — a low-poly 3D totem, hand-built. No three.js, no vendored
// libraries, no network: forty-odd triangles, a perspective projection, a
// painter's sort, and flat gold shading on a 2D canvas. It spins slowly and
// breathes. It is decoration with teeth — and like everything in this app,
// it owes nothing to anyone's servers.

// Half-side vertices of a stylized wolf head (x mirrored for the full head).
const HALF = [
  [0.00, -0.24, 1.34],   // 0 nose tip — the long lupine snout
  [0.10, -0.02, 1.08],   // 1 snout bridge side
  [0.00,  0.08, 1.00],   // 2 snout top center
  [0.14, -0.18, 0.94],   // 3 snout side
  [0.00, -0.34, 0.72],   // 4 chin front
  [0.20, -0.30, 0.52],   // 5 jaw side
  [0.00, -0.50, 0.30],   // 6 jaw back center
  [0.42, -0.02, 0.42],   // 7 cheek
  [0.24,  0.28, 0.55],   // 8 brow
  [0.00,  0.42, 0.48],   // 9 forehead center
  [0.52,  0.26, 0.05],   // 10 skull side
  [0.30,  0.50, 0.10],   // 11 ear base front
  [0.52,  0.42, -0.28],  // 12 ear base back
  [0.36,  0.98, -0.22],  // 13 ear tip — upright, not wide
  [0.00,  0.52, -0.10],  // 14 crown center
  [0.00,  0.30, -0.55],  // 15 head back center
  [0.40, -0.20, -0.30],  // 16 neck side
  [0.00, -0.40, -0.45],  // 17 neck bottom center
];

// Faces as index triples into the mirrored vertex list (see below): index i is
// the half-side vertex, i+18 its mirror. Center vertices (x=0) mirror onto
// themselves — using either index is fine. Wound roughly outward.
const FACES = [
  // snout + nose
  [0, 1, 2], [0, 3, 1], [0, 4, 3], [3, 4, 5], [1, 3, 7], [1, 7, 8], [2, 1, 8],
  // jaw
  [4, 6, 5], [5, 6, 16], [5, 16, 7],
  // brow/forehead
  [2, 8, 9], [8, 11, 9], [8, 7, 10], [8, 10, 11],
  // ears
  [11, 10, 12], [11, 12, 13], [11, 13, 14], [13, 12, 15], [13, 15, 14],
  // skull sides + back
  [7, 16, 10], [10, 16, 12], [12, 16, 17], [12, 17, 15], [9, 11, 14],
  // mirrored side (swap winding)
  [18, 20, 19], [18, 19, 21], [18, 21, 22], [21, 23, 22], [19, 25, 21], [19, 26, 25], [20, 26, 19],
  [22, 23, 24], [23, 34, 24], [23, 25, 34],
  [20, 27, 26], [26, 27, 29], [26, 28, 25], [26, 29, 28],
  [29, 30, 28], [29, 31, 30], [29, 32, 31], [31, 33, 30], [31, 32, 33],
  [25, 28, 34], [28, 30, 34], [30, 35, 34], [30, 33, 35], [27, 32, 29],
];

function buildMesh() {
  const verts = [];
  for (const [x, y, z] of HALF) verts.push([x, y, z]);
  for (const [x, y, z] of HALF) verts.push([-x, y, z]);
  // remap mirrored center-line indices onto the originals so faces stay tidy
  const map = (i) => (i >= 18 && HALF[i - 18][0] === 0 ? i - 18 : i);
  const faces = FACES.map((f) => f.map(map));
  return { verts, faces };
}

const GOLD_DARK = [122, 82, 16];
const GOLD_MID = [212, 154, 52];
const GOLD_HI = [255, 215, 106];

function shade(nz, ny) {
  // light from the upper-front-left; mix three golds by the lambert term
  const l = Math.max(0, nz * 0.75 + ny * 0.45 + 0.18);
  const t = Math.min(1, l);
  const lerp = (a, b, k) => Math.round(a + (b - a) * k);
  const from = t < 0.5 ? GOLD_DARK : GOLD_MID;
  const to = t < 0.5 ? GOLD_MID : GOLD_HI;
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return `rgb(${lerp(from[0], to[0], k)},${lerp(from[1], to[1], k)},${lerp(from[2], to[2], k)})`;
}

/** Mount the spinning golden wolf onto a canvas. Returns { destroy() }. */
export function createWolfTotem(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy() {} };
  const { verts, faces } = buildMesh();
  let raf = 0;
  let t0 = performance.now();

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!canvas.isConnected) return; // organ hidden or gone — stay cheap
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 96, h = canvas.clientHeight || 96;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t = (now - t0) / 1000;
    const yaw = Math.sin(t * 0.45) * 0.9;          // slow gaze sweep
    const breathe = 1 + Math.sin(t * 1.6) * 0.015; // it lives
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const pitch = -0.08, cp = Math.cos(pitch), sp = Math.sin(pitch);
    const scale = Math.min(w, h) * 0.42 * breathe;
    const cx = w / 2, cyx = h * 0.56;

    // rotate + project
    const P = verts.map(([x, y, z]) => {
      const rx = x * cy + z * sy;
      const rz = -x * sy + z * cy;
      const ry = y * cp - rz * sp;
      const rz2 = y * sp + rz * cp;
      const depth = 1 / (1 + rz2 * 0.18); // gentle perspective
      return { x: cx + rx * scale * depth, y: cyx - ry * scale * depth, z: rz2 };
    });

    // painter's sort, back to front
    const order = faces
      .map((f, i) => ({ i, z: (P[f[0]].z + P[f[1]].z + P[f[2]].z) / 3 }))
      .sort((a, b) => a.z - b.z);

    for (const { i } of order) {
      const [a, b, c] = faces[i];
      const A = P[a], B = P[b], C = P[c];
      // screen-space normal-ish for shading (z from the unprojected face)
      const va = verts[a], vb = verts[b], vc = verts[c];
      const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2];
      const vx = vc[0] - va[0], vyy = vc[1] - va[1], vz = vc[2] - va[2];
      let nx = uy * vz - uz * vyy, ny = uz * vx - ux * vz, nz = ux * vyy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      // rotate the normal's x/z by yaw so the light stays in world space
      const rnz = -nx * sy + nz * cy;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y);
      ctx.closePath();
      ctx.fillStyle = shade(rnz, ny);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,14,4,0.35)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // the eye — a single ember that tracks with the gaze
    const eye = P[8]; // brow vertex, near enough
    const ex = eye.x + (P[1].x - eye.x) * 0.25, ey = eye.y + (P[1].y - eye.y) * 0.4;
    ctx.beginPath();
    ctx.arc(ex, ey, Math.max(1.2, scale * 0.035), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,240,180,0.95)';
    ctx.shadowColor = 'rgba(255,200,90,0.9)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  raf = requestAnimationFrame(frame);
  return { destroy() { cancelAnimationFrame(raf); } };
}
