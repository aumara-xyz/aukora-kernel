# Aukora Spatial — the Trinity Spatial IDE

**Status:** Brick 1 built and verified locally (2026-07-02). This document is the
architecture spec for the spatial workspace and the task queue for the next bricks.

The codebase is the map. Files are orbs, folders are gravity wells, imports are
threads, test results are waves that travel the threads. The whole surface is
**advisory**: it renders engine state and proposes; only the AUMLOK signature
ceremony ever writes.

Run it: `bun spatial/serve.ts` → http://127.0.0.1:7090

---

## 1. Rendering substrate — decision record

Three candidate architectures were argued independently and judged (full panel
run in session artifacts, 2026-07-02):

| Substrate | Verdict | Why |
| --- | --- | --- |
| **Raw WebGL2, zero deps** | **CHOSEN** | One instanced graph in 2 draw calls; per-edge pulse shaders are trivial to own; no 650KB unauditable vendored blob in a repo with no root package.json, an egress sandbox, and an audit culture; keeps the WebGPU door open behind a thin `Renderer` interface. |
| three.js (vendored ESM) | rejected | Every hot path fights the library's idioms (LineMaterial patching for pulses, Raycaster bypassed, GC-hazard idioms banned) — it degrades into a 650KB pass-through for camera math. Re-open only if the roadmap pivots to meshes/GLTF/PBR. |
| Canvas2D 2.5D (worker) | rejected | Its own honest orbit-gesture ceiling (~2.5–3k nodes / ~8k edges) is below the "thousands of nodes" contract. Grafted from it: the stable `Renderer` seam, DOM labels with copyable paths, deterministic seeding, converge-then-freeze layout. |

**Architecture as built (spatial/app/map/):**

- **Position texture** — RGBA32F, side `ceil(sqrt(n))`, NEAREST filtering
  (Safari/ANGLE), one `texSubImage2D` per layout tick. Both shaders `texelFetch`
  node positions by index; node data lives in exactly one place on the GPU.
- **Draw call 1: node impostor spheres** — instanced billboard quads, sphere
  shading + rim in the fragment shader, per-instance color (top-level dir),
  size (√LOC), state flag (hover/selected/neighbor/dimmed).
- **Draw call 2: edge ribbons** — instanced screen-space quads expanded in the
  vertex shader; per-instance `(a,b)` indices + `(bfsDepth, orientation)`.
  A wave is ONE uniform (`u_waveTime`) advancing a gaussian brightness band
  down the depth gradient — green for pass, red for fail. Firing a wave uploads
  one small buffer; animating it costs zero uploads.
- **Layout** — Web Worker, O(n²) repulsion + import springs + cluster-anchor
  gravity over flat SoA Float32Arrays, converge-then-freeze, camera-only after.
  Seeds are deterministic (FNV-1a of file path → offset in the directory's
  anchor ball, anchors on a fibonacci sphere) so the map is spatially stable
  across sessions — muscle memory is the product.
- **Picking** — CPU: the projected screen mirror (already computed for labels)
  gets a front-most circle test. No GPU readback, no duplicated spatial index.
- **Labels** — DOM tier only, hard-capped: cluster names always, hovered node,
  selected + neighbors ≤ 48. Paths are real text: selectable, copyable.
- **On-demand rAF** — zero frames while nothing moves (camera inertia, layout,
  waves, hover changes are the only frame triggers). Idle cost is 0% CPU.

Measured at current scale: 290 nodes / 582 edges — roughly 30× below the
substrate's cliff. `spatial/RENDERER.md` documents the program I/O contracts.

## 2. Interaction model

**The trinity shell** (from auma.one/trinity, rebuilt from scratch — no code
reused): three frosted-glass lanes on a near-black navy stage, one hue per lane.

- **Green / left — Chats. Always chats (owner's rule).** The Aukora thread is
  the governed workbench loop: `help` / `status` / `map yourself` / `search` /
  `agent: <goal>` / `propose patch` … — she explores read-only, drafts in the
  sandbox, and halts for the signature. Tool calls render as dashed notes so
  the machinery stays visible. Served by a SEPARATE process
  (`spatial/chat-serve.ts`, port 7091) so the advisory GET-only server never
  carries write-capable traffic.
- **Blue / center — Canvas.** The organ stage. Default organ is the Spatial
  Map; the node **inspector is a bottom dock inside the map** (path copy,
  badges, wave triggers, imports both ways). Fusion Council, Kira Memory,
  Aumlok Gate and Engine Status render here as read-only DOM panels. Each
  future capability is one more organ in the menu.
- **Purple / right — Menu.** Three tabs (▲ Organs, ■ System, ● Yours),
  right-aligned rows, filled shape = active tab.

**Hot corners are the verbs.** 74px invisible corner buttons with a breathing
quarter-circle bloom in the lane's hue. Uniform rule: a corner press pushes its
panel out a third — unless the panel is already full, then it pulls in a third.
Lane widths live on a 2-divider state machine over a 3-unit track
(`0 ≤ a ≤ d ≤ 3`), so every lane is always an exact multiple of one-third and
resizes glide on the house easing `cubic-bezier(.22,1,.36,1)`. Collapsed lanes
leave a 3px hue sliver at the screen edge. Keyboard: `[` `]` `,` `.` drive the
corners, `Esc` deselects. Mobile (≤680px): one full-screen pane, corners
navigate.

**Reading code spatially.** Select an orb → the camera flies to it, the rest of
the graph dims, neighbors label themselves, and the inspector shows both sides
of its dependency surface. Text-level reading/editing stays in brick 3 (node
open → code panel organ); the map is for orientation, blast-radius reasoning,
and watching the system's health propagate.

## 3. State flows

```
repo files ──(scan: TS AST via core/src/importGraphVerifier)──► /api/graph ─┐
state/kira/brain.json ────────(summary)───────────────────────► /api/kira   │
~/.aukora-symbiote/aumlok/* ──(snapshot, never key bytes)─────► /api/aumlok │──► trinity shell
dashboard/fu/runs/*.json ─────(read-only)─────────────────────► /api/council│      (7090)
scripts/status.sh ────────────(spawn, cached)─────────────────► /api/status │
sandbox test events ──────────(brick 2)───────────────────────► /api/events ┘ (SSE, stub today)
```

- **Server** (`spatial/serve.ts`): Bun.serve on 127.0.0.1:7090, **GET/HEAD
  only** — the method guard runs before routing, so no write lane can exist on
  this surface even by accident. It never proxies dashboard 7070's
  `POST /api/workbench/chat` or `GET /api/heartbeat`.
- **Chat door** (`spatial/chat-serve.ts`, 127.0.0.1:7091): the governed
  workbench loop as a sibling process — dynamic import per request (boot
  survives core/ mid-edit), commands serialized (the loop is a single-driver
  REPL), server-side Origin allowlist (browser CSRF guard). Chat writes only
  through the engine's own governed lanes: pending proposals, tmp sandboxes,
  and the signature-gated apply.
- **Convex position (honest):** there is no live Convex deployment in the seed
  today — `convex/` is a contract, the real store is `state/kira/brain.json`,
  and `convexReadOnlyInvariant.test.ts` enforces that no write lane exists.
  The UI therefore binds to *files + SSE*, shaped so that a future local
  Convex (or the existing Kira loopback's Convex-style envelopes on 3220) can
  replace the polling reads without touching the canvas: every API already
  returns snapshot-style JSON with `advisoryOnly: true`.
- **The Aumlok boundary:** the canvas is advisory. Brick 4's visual editing
  (dragging a thread between orbs) generates a **draft proposal artifact** in
  the existing pending-proposals lane (`self-edit-proposal-artifact-v1`), where
  it waits for the owner's Ed25519 signature like any other proposal. The UI
  renders the queue (it does today); it cannot sign, apply, or unlock —
  structurally, because its server accepts no writes.

## 4. Brick queue (drafted GitHub issues for Sonnet)

Filed as drafts here — the owner files them to GitHub Issues (single source of
truth) when approved.

**Brick 1 — DONE (this change): trinity shell + live spatial map.**
290 real file nodes from `/api/graph`, orbit/fly camera, picking, inspector,
simulated pass/fail waves, 4 read-only engine organs, GET-only server on 7090.

**Brick 2 — real test waves over SSE.**
`scripts/test.sh` (or a thin watcher around `/tmp/aukora-vitest.txt`) feeds
`/api/events`: `run-started`, per-file pass/fail, `run-settled`. Client maps
failed test files to nodes, fires red waves from them (green sweep on a clean
run). Acceptance: run the suite in a terminal, watch the map light up with no
UI interaction. No new write lanes; the watcher only reads the log artifact.

**Brick 3 — node open → code organ.**
Click-through from the inspector to a read-only code panel organ (server gains
`GET /api/file?path=…`, allowlisted to the scanned roots, size-capped).
Monospace, line numbers, import lines linkified to their nodes. Acceptance:
orb → code in under 150ms, zero write surface.

**Brick 4 — drag-a-thread → draft proposal.**
Drag from orb A to orb B proposes "A imports B": the UI POSTs nothing — it
renders a proposal *script* (goal + file diff preview) the owner can hand to
the governed workbench lane, which writes the pending-proposal artifact through
the existing gate. The map shows the pending edge as a dashed purple thread
until signed. Acceptance: the artifact appears in `/api/aumlok` pending queue;
the live folder is untouched until signature.

**Brick 5 — scale hardening (when >1k nodes or the map feels heavy).**
Grid-bucketed repulsion in the worker, edge LOD during orbit, glyph-atlas
labels if the DOM cap starts hurting. Explicitly NOT now — 30× headroom.

## 5. Honest limits (as of brick 1)

- Waves are simulated (fired from the inspector), not yet driven by real test
  runs — that is brick 2, and the SSE route is already stubbed.
- `/api/events` streams heartbeats only.
- No file-content viewing yet (brick 3).
- `deferred-tests/` (47 files) is excluded from the graph — its imports are
  dangling by design; the exclusion is reported in `/api/graph` meta.
- Engine status currently reports `NOT_READY / gate integrity: MISMATCH`
  because another session holds uncommitted edits to `authority/gate/` — the
  UI reports the working tree truthfully.
