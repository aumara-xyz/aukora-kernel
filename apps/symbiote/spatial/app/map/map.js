// Aukora Spatial — the map organ. Fetches /api/graph (a read-only snapshot),
// runs the layout worker, drives the WebGL2 renderer with on-demand rAF
// (zero frames while idle), and binds picking + inspector + test-wave pulses.
// Everything here is advisory: selecting, orbiting and firing simulated waves
// never touch the engine.

import { OrbitCamera } from '/app/map/camera.js';
import { createRenderer } from '/app/map/renderer.js';

const PALETTE = {
  'core/src': [150, 180, 255],
  'core/tests': [129, 212, 180],
  'core': [190, 205, 255],
  'authority': [196, 170, 255],
  'memory': [255, 205, 150],
  'dashboard': [140, 220, 235],
  'receiver': [255, 170, 190],
  'website': [235, 225, 160],
  'scripts': [205, 205, 215],
  'convex': [160, 235, 205],
};
const DEFAULT_COLOR = [200, 200, 210];
const WAVE_GREEN = [129 / 255, 212 / 255, 180 / 255];
const WAVE_RED = [1.0, 0.42, 0.42];

const S = {
  graph: null,
  positions: null,   // Float32Array 3n mirror of the worker/renderer state
  proj: null,        // Float32Array 3n: screen x, y, clip w (CSS px)
  radii: null,       // projected pixel radius per node
  outAdj: [],
  inAdj: [],
  adj: [],
  renderer: null,
  camera: null,
  canvas: null,
  labelsEl: null,
  hovered: -1,
  selected: -1,
  flags: null,
  wave: { on: false, time: 0, color: WAVE_GREEN, start: 0, maxDepth: 0 },
  layoutRunning: false,
  userMoved: false,
  rafId: 0,
  clusterLabels: new Map(),
  nodeLabels: [],
  hoverLabel: null,
};

export async function mountMap(root) {
  const canvas = document.createElement('canvas');
  canvas.id = 'glmap';
  const labels = document.createElement('div');
  labels.id = 'labels';
  const dock = document.createElement('div');
  dock.className = 'inspector-dock';
  root.append(canvas, labels, dock);
  S.canvas = canvas;
  S.labelsEl = labels;
  S.dockEl = dock;

  S.renderer = createRenderer(canvas);
  if (!S.renderer) {
    const msg = document.createElement('div');
    msg.className = 'gl-missing';
    msg.textContent = 'WebGL2 is unavailable in this browser — the spatial map needs it. The other organs still work.';
    root.append(msg);
    return;
  }
  S.renderer.onRestored = () => needFrame();

  S.camera = new OrbitCamera(canvas);
  ['pointerdown', 'pointermove', 'pointerup', 'wheel'].forEach((ev) =>
    canvas.addEventListener(ev, () => needFrame(), { passive: ev !== 'wheel' })
  );
  ['pointerdown', 'wheel'].forEach((ev) =>
    canvas.addEventListener(ev, () => { S.userMoved = true; }, { passive: true })
  );
  // rAF suspends in hidden tabs; kick a frame when we come back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) needFrame(); });

  let res;
  try {
    res = await fetch('/api/graph');
    if (!res.ok) throw new Error('graph ' + res.status);
    S.graph = await res.json();
  } catch (e) {
    document.getElementById('organ-sub').textContent = 'graph unavailable: ' + (e.message ?? e);
    return;
  }
  const g = S.graph;
  const n = g.nodes.length;

  document.getElementById('organ-sub').textContent =
    `${n} files · ${g.meta.edgeCount} imports · advisory (excludes deferred-tests: ${g.meta.excluded['deferred-tests'].files} files)`;

  // flat arrays for the renderer + worker
  const seeds = new Float32Array(n * 3);
  const anchors = new Float32Array(n * 3);
  const colors = new Uint8Array(n * 3);
  const sizes = new Float32Array(n);
  g.nodes.forEach((node, i) => {
    seeds.set(node.seed, i * 3);
    anchors.set(node.anchor, i * 3);
    colors.set(PALETTE[node.cluster] ?? DEFAULT_COLOR, i * 3);
    sizes[i] = 0.9 + Math.min(2.6, Math.sqrt(node.loc) * 0.09);
  });
  const edges = new Uint32Array(g.edges);

  S.positions = new Float32Array(seeds);
  S.proj = new Float32Array(n * 3);
  S.radii = new Float32Array(n);
  S.flags = new Float32Array(n);
  S.outAdj = Array.from({ length: n }, () => []);
  S.inAdj = Array.from({ length: n }, () => []);
  S.adj = Array.from({ length: n }, () => []);
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e], b = edges[e + 1];
    S.outAdj[a].push(b);
    S.inAdj[b].push(a);
    S.adj[a].push({ node: b, edge: e / 2 });
    S.adj[b].push({ node: a, edge: e / 2 });
  }

  S.renderer.setGraph({ count: n, colors, sizes, edges });
  S.renderer.resize();
  S.renderer.updatePositions(S.positions);

  // frame the whole graph
  let radius = 1;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(seeds[i * 3], seeds[i * 3 + 1], seeds[i * 3 + 2]);
    if (r > radius) radius = r;
  }
  S.camera.dist = radius * 2.4;

  buildClusterLabels();

  // layout worker: converge, then freeze
  const worker = new Worker('/app/map/layout.worker.js');
  S.layoutRunning = true;
  worker.postMessage({ n, seeds, anchors, edges });
  worker.onmessage = (msg) => {
    const { type, positions } = msg.data;
    S.positions = new Float32Array(positions);
    S.renderer.updatePositions(S.positions);
    if (type === 'settled') {
      S.layoutRunning = false;
      worker.terminate();
      updateClusterCentroids();
      // The force sim expands the graph well past its seed radius; reframe so
      // the whole map is in view — unless the user has already taken the wheel.
      if (!S.userMoved && S.selected < 0) {
        let r = 1;
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(S.positions[i * 3], S.positions[i * 3 + 1], S.positions[i * 3 + 2]);
          if (d > r) r = d;
        }
        S.camera.flyTo([0, 0, 0], r * 2.2);
      }
    }
    needFrame();
  };

  attachPicking(canvas);

  const ro = new ResizeObserver(() => { S.renderer.resize(); needFrame(); });
  ro.observe(canvas);
  window.addEventListener('lane-settled', () => { S.renderer.resize(); needFrame(); });

  needFrame();
}

// ---------------------------------------------------------------------------
// Frame loop — on-demand: render only while something moves.
// ---------------------------------------------------------------------------

function needFrame() {
  if (!S.rafId && S.renderer) S.rafId = requestAnimationFrame(loop);
}

function loop() {
  S.rafId = 0;
  // Frame-scheduling listeners attach before the graph fetch resolves (and
  // survive a failed fetch) — never render without data.
  if (!S.graph) return;
  const cam = S.camera, r = S.renderer, canvas = S.canvas;
  const active = cam.update();

  const vp = cam.viewProj(canvas.clientWidth, canvas.clientHeight);
  const pixFactorDevice = cam.pixFactor(canvas.height);

  if (S.wave.on) {
    S.wave.time = (performance.now() - S.wave.start) / 300;
    if (S.wave.time > S.wave.maxDepth + 4) S.wave.on = false;
  }

  r.frame(vp, pixFactorDevice, { on: S.wave.on, time: S.wave.time, color: S.wave.color });
  projectAll(vp);
  updateLabels();

  if (active || S.wave.on || S.layoutRunning) needFrame();
}

function projectAll(vp) {
  const n = S.graph.nodes.length;
  const pos = S.positions, out = S.proj;
  const w = S.canvas.clientWidth, h = S.canvas.clientHeight;
  const pixFactor = S.camera.pixFactor(h);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (cw <= 0.001) {
      out[i * 3 + 2] = -1;
      continue;
    }
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    out[i * 3] = (cx / cw * 0.5 + 0.5) * w;
    out[i * 3 + 1] = (0.5 - cy / cw * 0.5) * h;
    out[i * 3 + 2] = cw;
    S.radii[i] = Math.max((0.9 + Math.min(2.6, Math.sqrt(S.graph.nodes[i].loc) * 0.09)) * pixFactor / cw, 2.5);
  }
}

// ---------------------------------------------------------------------------
// Picking — analytic screen-space circle test over the projected mirror.
// ---------------------------------------------------------------------------

function pick(px, py) {
  const n = S.graph.nodes.length;
  let best = -1, bestW = Infinity;
  for (let i = 0; i < n; i++) {
    const w = S.proj[i * 3 + 2];
    if (w <= 0) continue;
    const dx = S.proj[i * 3] - px, dy = S.proj[i * 3 + 1] - py;
    const r = S.radii[i] + 3;
    if (dx * dx + dy * dy <= r * r && w < bestW) {
      best = i;
      bestW = w;
    }
  }
  return best;
}

function attachPicking(canvas) {
  let downX = 0, downY = 0, downT = 0;
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const i = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (i !== S.hovered) {
      S.hovered = i;
      rebuildFlags();
      rebuildHoverLabel();
      needFrame();
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; downT = performance.now();
  });
  canvas.addEventListener('pointerup', (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved > 5 || performance.now() - downT > 500) return;
    const rect = canvas.getBoundingClientRect();
    const i = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (i >= 0) selectNode(i);
    else deselectNode();
  });
}

function rebuildFlags() {
  const n = S.flags.length;
  if (S.selected >= 0) {
    S.flags.fill(4);
    for (const { node } of S.adj[S.selected]) S.flags[node] = 3;
    S.flags[S.selected] = 2;
  } else {
    S.flags.fill(0);
  }
  if (S.hovered >= 0 && S.hovered !== S.selected) S.flags[S.hovered] = 1;
  S.renderer.setFlags(S.flags);
}

// ---------------------------------------------------------------------------
// Selection + inspector.
// ---------------------------------------------------------------------------

export function focusNode(i) {
  selectNode(i);
}

export function deselectNode() {
  if (S.selected < 0) return;
  S.selected = -1;
  rebuildFlags();
  rebuildNodeLabels();
  renderInspector();
  needFrame();
}

function selectNode(i) {
  S.selected = i;
  rebuildFlags();
  rebuildNodeLabels();
  renderInspector();
  const p = [S.positions[i * 3], S.positions[i * 3 + 1], S.positions[i * 3 + 2]];
  S.camera.flyTo(p, Math.min(Math.max(S.camera.dist * 0.6, 22), 60));
  needFrame();
}

// The inspector lives INSIDE the map organ as a bottom dock — the left lane
// is always chats (owner's rule).
function renderInspector() {
  const dock = S.dockEl;
  if (!dock) return;
  if (S.selected < 0) {
    dock.classList.remove('open');
    return;
  }
  dock.innerHTML = '';

  const close = document.createElement('button');
  close.className = 'dock-close';
  close.textContent = '✕';
  close.title = 'close (Esc)';
  close.addEventListener('click', () => deselectNode());
  dock.append(close);

  const node = S.graph.nodes[S.selected];
  const left = document.createElement('div');
  left.className = 'dock-left';

  const label = document.createElement('span');
  label.className = 'micro-label hue-l-text';
  label.textContent = 'Node';
  left.append(label);

  const pathEl = document.createElement('div');
  pathEl.className = 'node-path';
  pathEl.textContent = node.path;
  pathEl.title = 'click to copy';
  pathEl.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(node.path);
      pathEl.style.borderLeft = '2px solid rgba(129,212,180,.9)';
      setTimeout(() => (pathEl.style.borderLeft = ''), 600);
    } catch { /* clipboard denied — text is still selectable */ }
  });
  left.append(pathEl);

  const badges = document.createElement('div');
  badges.className = 'badges';
  const mk = (txt, cls) => {
    const s = document.createElement('span');
    s.className = 'pill ' + cls;
    s.textContent = txt;
    return s;
  };
  badges.append(
    mk(node.cluster, 'pill-purple'),
    mk(`${node.loc} loc`, 'pill-faint'),
    mk(`${S.outAdj[S.selected].length} out · ${S.inAdj[S.selected].length} in`, 'pill-green'),
  );
  left.append(badges);

  const waves = document.createElement('div');
  waves.className = 'wave-buttons';
  const pass = document.createElement('button');
  pass.className = 'wave-btn';
  pass.textContent = 'Pulse · pass';
  pass.addEventListener('click', () => fireWave(false));
  const fail = document.createElement('button');
  fail.className = 'wave-btn fail';
  fail.textContent = 'Pulse · fail';
  fail.addEventListener('click', () => fireWave(true));
  waves.append(pass, fail);
  left.append(waves);
  dock.append(left);

  const lists = document.createElement('div');
  lists.className = 'imports-list dock-lists';
  const addList = (title, ids) => {
    const t = document.createElement('span');
    t.className = 'micro-label';
    t.textContent = `${title} (${ids.length})`;
    lists.append(t);
    for (const id of ids.slice(0, 40)) {
      const b = document.createElement('button');
      b.className = 'import-item';
      b.textContent = S.graph.nodes[id].path;
      b.addEventListener('click', () => selectNode(id));
      lists.append(b);
    }
    if (ids.length > 40) {
      const more = document.createElement('span');
      more.className = 'faint';
      more.textContent = `… ${ids.length - 40} more`;
      lists.append(more);
    }
  };
  addList('imports', S.outAdj[S.selected]);
  addList('imported by', S.inAdj[S.selected]);
  dock.append(lists);

  dock.classList.add('open');
}

// ---------------------------------------------------------------------------
// Test waves — BFS from the selected node; depth + orientation per edge, the
// shader animates the front from a single uniform. Simulated in brick 1; brick
// 2 feeds real sandbox test events through /api/events.
// ---------------------------------------------------------------------------

function fireWave(fail) {
  if (S.selected < 0) return;
  const n = S.graph.nodes.length;
  const dist = new Int32Array(n).fill(-1);
  const queue = [S.selected];
  dist[S.selected] = 0;
  let maxDepth = 0;
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    for (const { node } of S.adj[u]) {
      if (dist[node] === -1) {
        dist[node] = dist[u] + 1;
        if (dist[node] > maxDepth) maxDepth = dist[node];
        queue.push(node);
      }
    }
  }
  const m = S.graph.edges.length / 2;
  const waves = new Float32Array(m * 2);
  for (let e = 0; e < m; e++) {
    const a = S.graph.edges[e * 2], b = S.graph.edges[e * 2 + 1];
    const da = dist[a], db = dist[b];
    if (da === -1 || db === -1) {
      waves[e * 2] = -1;
      waves[e * 2 + 1] = 1;
    } else {
      waves[e * 2] = Math.min(da, db);
      waves[e * 2 + 1] = da <= db ? 1 : -1;
    }
  }
  S.renderer.setWaveEdges(waves);
  S.wave = { on: true, time: 0, color: fail ? WAVE_RED : WAVE_GREEN, start: performance.now(), maxDepth };
  needFrame();
}

// ---------------------------------------------------------------------------
// Labels — DOM tier only (crisp, copyable): cluster names always, hovered node,
// selected node + neighbors capped at 48.
// ---------------------------------------------------------------------------

function buildClusterLabels() {
  for (const c of S.graph.clusters) {
    const el = document.createElement('div');
    el.className = 'cluster-label';
    el.textContent = c.key;
    const rgb = PALETTE[c.key] ?? DEFAULT_COLOR;
    el.style.setProperty('--cl', `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`);
    S.labelsEl.append(el);
    S.clusterLabels.set(c.key, { el, centroid: [...c.anchor] });
  }
  updateClusterCentroids();
}

function updateClusterCentroids() {
  const sums = new Map();
  S.graph.nodes.forEach((node, i) => {
    let s = sums.get(node.cluster);
    if (!s) { s = [0, 0, 0, 0]; sums.set(node.cluster, s); }
    s[0] += S.positions[i * 3];
    s[1] += S.positions[i * 3 + 1];
    s[2] += S.positions[i * 3 + 2];
    s[3]++;
  });
  for (const [key, s] of sums) {
    const entry = S.clusterLabels.get(key);
    if (entry) entry.centroid = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
  }
}

function rebuildNodeLabels() {
  for (const l of S.nodeLabels) l.el.remove();
  S.nodeLabels = [];
  if (S.selected < 0) return;
  const ids = [S.selected, ...S.adj[S.selected].map((x) => x.node)].slice(0, 48);
  for (const id of ids) {
    const el = document.createElement('div');
    el.className = 'node-label' + (id === S.selected ? ' hovered' : '');
    el.textContent = S.graph.nodes[id].path.split('/').pop();
    S.labelsEl.append(el);
    S.nodeLabels.push({ el, id });
  }
}

function rebuildHoverLabel() {
  S.hoverLabel?.el.remove();
  S.hoverLabel = null;
  if (S.hovered < 0 || S.hovered === S.selected) return;
  const el = document.createElement('div');
  el.className = 'node-label hovered';
  el.textContent = S.graph.nodes[S.hovered].path;
  S.labelsEl.append(el);
  S.hoverLabel = { el, id: S.hovered };
}

function placeLabel(el, i) {
  const w = S.proj[i * 3 + 2];
  if (w <= 0) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.left = S.proj[i * 3] + 'px';
  el.style.top = (S.proj[i * 3 + 1] - S.radii[i]) + 'px';
}

function updateLabels() {
  for (const { el, id } of S.nodeLabels) placeLabel(el, id);
  if (S.hoverLabel) placeLabel(S.hoverLabel.el, S.hoverLabel.id);
  // cluster labels: project centroids directly
  const w = S.canvas.clientWidth, h = S.canvas.clientHeight;
  const m = S.camera.viewProj(w, h);
  for (const { el, centroid } of S.clusterLabels.values()) {
    const [x, y, z] = centroid;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.001) { el.style.display = 'none'; continue; }
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    el.style.display = '';
    el.style.left = (cx / cw * 0.5 + 0.5) * w + 'px';
    el.style.top = (0.5 - cy / cw * 0.5) * h + 'px';
  }
}
