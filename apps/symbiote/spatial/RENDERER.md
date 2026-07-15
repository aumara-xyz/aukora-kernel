# Renderer contract — spatial/app/map/renderer.js

Raw WebGL2, two programs, two draw calls per frame. This file is the audit
surface for the GLSL: what each program reads, writes, and assumes.

## Position texture (shared by both programs)

- RGBA32F, square, side = `ceil(sqrt(nodeCount))`, MIN/MAG = NEAREST
  (float textures must not be filtered — Safari/ANGLE hard requirement).
- Both vertex shaders declare `uniform highp sampler2D u_pos;` — the `highp`
  is load-bearing: GLSL ES 3.00 defaults vertex-stage samplers to lowp, and
  texelFetch results take the sampler's precision, which would quantize world
  positions on precision-honoring GPUs (Mali/Adreno/ANGLE-Metal).
- Texel for node *i*: `ivec2(i % side, i / side)`; `.xyz` = world position,
  `.w` = 1. Updated whole-texture via `texSubImage2D` on each layout tick
  (layout freezes after convergence, so steady-state uploads are zero).

## Program 1 — nodes (impostor spheres)

Instanced TRIANGLE_STRIP quad (4 verts × n instances).

| Input | Kind | Meaning |
| --- | --- | --- |
| `a_corner` | per-vertex vec2 | quad corner in [-1,1]² |
| `a_index` | per-instance float | node index → position texel |
| `a_color` | per-instance u8×3 (normalized) | dir color |
| `a_size` | per-instance float | world radius (√LOC scaled) |
| `a_flag` | per-instance float | 0 normal · 1 hover · 2 selected · 3 neighbor · 4 dimmed |
| `u_vp` | mat4 | view-projection (column-major) |
| `u_viewport` | vec2 | drawing-buffer size, device px |
| `u_pixFactor` | float | `H / (2·tan(fov/2))` — world→pixel at depth w |

Vertex: fetch center, billboard-offset in clip space by
`max(size·pixFactor/w, 2.5px)`. Behind-camera guard: `w ≤ 0.001` → degenerate.
Fragment: circle discard, sphere normal from quad UV, lambert + rim, flag
tinting/dimming. Output premultiplied; blend `ONE, ONE_MINUS_SRC_ALPHA`,
depth test + write ON (drawn first).

## Program 2 — edges (screen-space ribbons + wave)

Instanced TRIANGLE_STRIP quad (4 verts × m instances).

| Input | Kind | Meaning |
| --- | --- | --- |
| `a_corner` | per-vertex vec2 | `(t, side)`: t∈{0,1} along edge, side∈{−1,1} |
| `a_pair` | per-instance vec2 | node indices (a, b) → position texels |
| `a_wave` | per-instance vec2 | `(bfsDepth, orientation)`; depth < 0 = wave skips this edge |
| `u_widthPx` | float | ribbon half-width, device px |
| `u_waveOn / u_waveTime / u_waveColor` | float / float / vec3 | one uniform animates every edge |

Vertex: fetch endpoints, perpendicular expand in screen space, degenerate if
either endpoint is behind the camera. `v_t` flips with orientation so the wave
always travels away from the BFS origin. Fragment: faint base
(`edgeColor·0.16, α 0.055`) + gaussian band at `u_waveTime − (depth + t)` with
an exponential trail. Blend `ONE, ONE_MINUS_SRC_ALPHA` (high rgb / low alpha ≈
additive glow), depth test ON, depth write OFF (drawn after nodes → correctly
occluded by orbs in front).

## Frame + lifecycle

- `frame(vp, pixFactor, wave)` draws nodes then edges; clear is transparent
  black so the trinity glass shows through (canvas context `alpha: true`,
  premultiplied).
- DPR capped at 2.
- Context loss: `webglcontextlost` flags, `webglcontextrestored` rebuilds
  programs and re-uploads the retained graph + last positions, then
  `onRestored()` asks the app for a frame.

## Debug recipe

Each program is testable alone: comment out the other draw call in `frame`.
A blank screen with no console error is almost always (a) position texture not
bound, (b) `u_texW` wrong after a node-count change, or (c) all vertices behind
the camera — check `camera.dist` against graph radius first.
