// Aukora Spatial — force layout worker. Converge-then-freeze: the simulation
// runs once at load over flat typed arrays (SoA, so Barnes-Hut can drop in
// later), posts positions as transferable buffers, then goes silent.
// Deterministic: seeds come from the server (hash of file path), iteration
// order is fixed, no randomness here — the map is spatially stable forever.

const REPULSION = 320;
const SPRING_K = 0.035;
const SPRING_REST = 7;
const ANCHOR_K = 0.012;
const DAMPING = 0.85;
const MAX_FORCE = 6;
const MAX_TICKS = 420;
const SETTLE_ENERGY = 0.0006;
const POST_EVERY = 4;

onmessage = (msg) => {
  const { n, seeds, anchors, edges } = msg.data;
  const pos = new Float32Array(seeds);
  const vel = new Float32Array(n * 3);
  const force = new Float32Array(n * 3);
  const m = edges.length / 2;

  let tick = 0;
  function step() {
    force.fill(0);

    // O(n^2) repulsion — 337 nodes is ~56k pairs, trivially fast; swap in a
    // grid-bucketed approximation when the map crosses ~3k nodes.
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      for (let j = i + 1; j < n; j++) {
        const jx = j * 3;
        let dx = pos[ix] - pos[jx];
        let dy = pos[ix + 1] - pos[jx + 1];
        let dz = pos[ix + 2] - pos[jx + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        let f = REPULSION / d2;
        if (f > MAX_FORCE) f = MAX_FORCE;
        const inv = f / Math.sqrt(d2);
        dx *= inv; dy *= inv; dz *= inv;
        force[ix] += dx; force[ix + 1] += dy; force[ix + 2] += dz;
        force[jx] -= dx; force[jx + 1] -= dy; force[jx + 2] -= dz;
      }
    }

    // springs along import edges
    for (let e = 0; e < m; e++) {
      const a = edges[e * 2] * 3, b = edges[e * 2 + 1] * 3;
      let dx = pos[b] - pos[a];
      let dy = pos[b + 1] - pos[a + 1];
      let dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
      let f = SPRING_K * (d - SPRING_REST);
      if (f > MAX_FORCE) f = MAX_FORCE;
      if (f < -MAX_FORCE) f = -MAX_FORCE;
      const inv = f / d;
      dx *= inv; dy *= inv; dz *= inv;
      force[a] += dx; force[a + 1] += dy; force[a + 2] += dz;
      force[b] -= dx; force[b + 1] -= dy; force[b + 2] -= dz;
    }

    // gravity toward each node's cluster anchor keeps directories coherent
    for (let i = 0; i < n * 3; i++) {
      force[i] += ANCHOR_K * (anchors[i] - pos[i]);
    }

    let energy = 0;
    for (let i = 0; i < n * 3; i++) {
      vel[i] = (vel[i] + force[i]) * DAMPING;
      pos[i] += vel[i];
      energy += vel[i] * vel[i];
    }
    return energy / n;
  }

  function run() {
    let energy = Infinity;
    const deadline = 12; // ms per slice, keeps the worker responsive
    const sliceStart = performance.now();
    while (performance.now() - sliceStart < deadline && tick < MAX_TICKS) {
      energy = step();
      tick++;
      if (energy < SETTLE_ENERGY) break;
    }
    if (tick % POST_EVERY === 0 || tick >= MAX_TICKS || energy < SETTLE_ENERGY) {
      const copy = new Float32Array(pos);
      const settled = tick >= MAX_TICKS || energy < SETTLE_ENERGY;
      postMessage({ type: settled ? 'settled' : 'tick', tick, positions: copy.buffer }, [copy.buffer]);
      if (settled) return;
    }
    setTimeout(run, 0);
  }
  run();
};
