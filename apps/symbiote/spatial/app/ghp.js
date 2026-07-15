// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// Aukora Spatial — GOLDEN HORIZON PRINCIPLE: the research program, explained honestly.
//
// This organ teaches GHP the way the ledger tells it: a beautiful conjecture fed into a
// falsification machine strict enough that it could not lie to us. Three interactive
// panels carry the real content:
//   1. THE FIXED POINT — the Viviani-phi Surface: gamma(r) = r/r_s crossing at exactly phi,
//      with the conformal-gravity slider live-solving the deformed cubic (VPS-CG, 2026-07-10:
//      leading drift -phi^3/sqrt(5), preregistered and verified 5/5).
//   2. THE HEALING TEAR — the recoverability discriminator you can run by hand: spread
//      redundancy by golden / silver / rational / random rotation, tear a block, watch what
//      survives. It shows the program's most honest twist: irrational spreading heals,
//      rational fails catastrophically — and SILVER ties or beats golden (GH-RECOV, ~5-sigma).
//   3. THE SCOREBOARD — every claim that reached a real test, with its verdict, nulls and
//      kills shown as prominently as passes. Architecture survived; selection died; the
//      machine caught two of its own tests cheating.
//
// Honesty rails: everything here is EXPLANATION of ledgered results — nothing is physics
// evidence, nothing grants authority, and the do-not-claim footer is binding. The numbers
// shown in panel 2 are a live toy in your browser, labeled as such; the ledgered verdicts
// came from the preregistered probes in GHP/runs/ and experiments/.

const PHI = (1 + Math.sqrt(5)) / 2;

let styleDone = false;
function injectStyle() {
  if (styleDone) return; styleDone = true;
  const s = document.createElement('style');
  s.textContent = `
  .ghp-app{max-width:880px;margin:0 auto;padding:74px 14px 60px;color:var(--text,rgba(244,246,255,.92));font-size:14px;line-height:1.65}
  .ghp-lede{font-size:15.5px;color:rgba(240,195,110,.95);margin:10px 0 2px;letter-spacing:.01em}
  .ghp-sub{color:rgba(228,232,248,.6);font-size:12.5px;margin-bottom:18px}
  .ghp-card{border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.045);padding:15px 17px;margin-bottom:16px}
  .ghp-card h3{margin:0 0 4px;font-size:14px;letter-spacing:.06em;color:rgba(240,195,110,.9)}
  .ghp-card .why{color:rgba(228,232,248,.6);font-size:12.5px;margin-bottom:10px}
  .ghp-layers{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:8px}
  .ghp-layer{border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:10px 12px;background:rgba(0,0,0,.22);cursor:pointer;transition:border-color .2s}
  .ghp-layer:hover{border-color:rgba(240,195,110,.4)}
  .ghp-layer b{display:block;font-size:12.5px;margin-bottom:4px}
  .ghp-layer .st{font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.05em}
  .ghp-layer .more{display:none;color:rgba(228,232,248,.62);font-size:12px;margin-top:6px}
  .ghp-layer.open .more{display:block}
  canvas.ghp-cv{width:100%;border-radius:10px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);display:block}
  .ghp-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
  .ghp-row label{font-size:12px;color:rgba(228,232,248,.65)}
  .ghp-row input[type=range]{flex:1;min-width:120px}
  .ghp-read{font-family:ui-monospace,monospace;font-size:12px;color:rgba(240,195,110,.92)}
  .ghp-btn{font:inherit;font-size:12.5px;padding:7px 14px;border-radius:10px;border:1px solid rgba(240,195,110,.45);background:rgba(240,195,110,.1);color:var(--text,#eef);cursor:pointer}
  .ghp-btn:hover{background:rgba(240,195,110,.2)}
  .ghp-seg{display:flex;gap:6px;flex-wrap:wrap}
  .ghp-seg button{font:inherit;font-size:11.5px;padding:5px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:rgba(228,232,248,.75);cursor:pointer}
  .ghp-seg button.on{border-color:rgba(240,195,110,.6);color:rgba(240,195,110,.95);background:rgba(240,195,110,.1)}
  .ghp-bars{display:flex;gap:14px;align-items:flex-end;height:90px;margin-top:12px}
  .ghp-bar{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10.5px;color:rgba(228,232,248,.65)}
  .ghp-bar .fill{width:100%;border-radius:6px 6px 0 0;background:rgba(150,180,255,.5);transition:height .4s}
  .ghp-bar.win .fill{background:rgba(240,195,110,.75)}
  .ghp-bar .v{font-family:ui-monospace,monospace;font-size:10px}
  table.ghp-score{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  .ghp-score th{text-align:left;color:rgba(228,232,248,.55);font-weight:600;font-size:10.5px;letter-spacing:.08em;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.1)}
  .ghp-score td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
  .ghp-v{font-family:ui-monospace,monospace;font-size:10.5px;font-weight:700;letter-spacing:.05em;padding:2px 8px;border-radius:999px;border:1px solid;white-space:nowrap}
  .v-proven{color:#9be8c5;border-color:rgba(129,212,180,.5);background:rgba(129,212,180,.09)}
  .v-null{color:#c9cfe4;border-color:rgba(200,205,220,.4);background:rgba(200,205,220,.07)}
  .v-kill{color:#ff9a9a;border-color:rgba(255,120,120,.5);background:rgba(255,90,90,.09)}
  .v-closed{color:#ffc38a;border-color:rgba(255,180,120,.5);background:rgba(255,180,120,.09)}
  .v-live{color:#a8c7ff;border-color:rgba(150,180,255,.5);background:rgba(150,180,255,.09)}
  .ghp-quote{border-left:2px solid rgba(240,195,110,.5);padding:2px 12px;color:rgba(228,232,248,.75);font-size:13px;margin:10px 0}
  .ghp-dnc{color:rgba(228,232,248,.45);font-size:11px;line-height:1.7;margin-top:18px;border-top:1px solid rgba(255,255,255,.08);padding-top:12px}
  .ghp-foot{color:rgba(228,232,248,.5);font-size:11.5px;margin-top:8px}
  `;
  document.head.appendChild(s);
}

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

// ── panel 1: the fixed point ──────────────────────────────────────────────────
function fixedPointPanel() {
  const card = el('div', 'ghp-card');
  card.append(el('h3', null, '1 · THE FIXED POINT — where phi actually lives'));
  card.append(el('div', 'why',
    'Ask a static observer near a black hole: at what radius does your time-dilation factor equal your horizon-normalized distance? ' +
    'The condition gamma(r) = r/rs is the golden ratio’s own equation x² = x + 1. The crossing sits at r = phi·rs — exactly, ' +
    'in any coordinates. Drag the slider to deform gravity with a conformal-gravity linear term and watch the surface drift inward: ' +
    'the leading drift is exactly −phi³/√5 (verified 5/5 against a frozen prereg, 2026-07-10).'));

  const cv = el('canvas', 'ghp-cv');
  cv.height = 240;
  const row = el('div', 'ghp-row');
  const lbl = el('label', null, 'conformal term g');
  const slider = el('input'); slider.type = 'range'; slider.min = '0'; slider.max = '0.12'; slider.step = '0.001'; slider.value = '0';
  const read = el('span', 'ghp-read');
  row.append(lbl, slider, read);
  card.append(cv, row);

  function rootCG(g) { // g*x^3 + x^2 - x - 1 = 0, Newton from phi
    let x = PHI;
    for (let i = 0; i < 40; i++) {
      const f = g * x ** 3 + x * x - x - 1;
      const d = 3 * g * x * x + 2 * x - 1;
      x -= f / d;
    }
    return x;
  }

  function draw() {
    const g = parseFloat(slider.value);
    const W = cv.clientWidth || 800; cv.width = W;
    const H = cv.height, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const x0 = 1.02, x1 = 2.6, y1 = 2.6;
    const X = (x) => ((x - x0) / (x1 - x0)) * (W - 50) + 40;
    const Y = (y) => H - 24 - (y / y1) * (H - 40);
    // axes
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, H - 24); ctx.lineTo(W - 10, H - 24); ctx.moveTo(40, H - 24); ctx.lineTo(40, 8); ctx.stroke();
    ctx.fillStyle = 'rgba(228,232,248,.5)'; ctx.font = '10px ui-monospace';
    ctx.fillText('r / rs →', W - 60, H - 10);
    // y = x  (the self-reference line)
    ctx.strokeStyle = 'rgba(150,180,255,.7)';
    ctx.beginPath(); ctx.moveTo(X(x0), Y(x0)); ctx.lineTo(X(Math.min(x1, y1)), Y(Math.min(x1, y1))); ctx.stroke();
    ctx.fillStyle = 'rgba(150,180,255,.8)'; ctx.fillText('y = r/rs', X(2.15), Y(2.15) - 8);
    // gamma(r) for the deformed lapse B = 1 - 1/x + g x
    ctx.strokeStyle = 'rgba(240,195,110,.9)'; ctx.beginPath();
    let started = false;
    for (let px = 0; px <= 300; px++) {
      const x = x0 + (px / 300) * (x1 - x0);
      const B = 1 - 1 / x + g * x;
      if (B <= 0.0001) { started = false; continue; }
      const gam = 1 / Math.sqrt(B);
      if (gam > y1) { started = false; continue; }
      if (!started) { ctx.moveTo(X(x), Y(gam)); started = true; } else ctx.lineTo(X(x), Y(gam));
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(240,195,110,.9)'; ctx.fillText('y = gamma(r)', X(1.06), Y(2.4));
    // the fixed point
    const xr = rootCG(g);
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath(); ctx.arc(X(xr), Y(xr), 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(g === 0 ? 'phi = 1.6180339…' : `x(g) = ${xr.toFixed(6)}`, X(xr) + 8, Y(xr) - 8);
    const tangent = PHI - (PHI ** 3 / Math.sqrt(5)) * g;
    read.textContent = g === 0
      ? 'g = 0 · the crossing is exactly phi'
      : `g = ${g.toFixed(3)} · root ${xr.toFixed(6)} · closed-form tangent ${tangent.toFixed(6)}`;
  }
  slider.addEventListener('input', draw);
  setTimeout(draw, 0); // rAF is throttled in hidden panes — draw immediately on mount
  new ResizeObserver(draw).observe(cv);

  card.append(el('div', 'ghp-foot',
    'What this is: a proven, coordinate-invariant identity of textbook general relativity (with clean deformations for charge, spin, extra dimensions, ' +
    'a cosmological constant, and now conformal gravity). What it is not: a horizon, a dynamical statement, or evidence that nature selects phi.'));
  return card;
}

// ── panel 2: the healing tear ─────────────────────────────────────────────────
function healingPanel() {
  const card = el('div', 'ghp-card');
  card.append(el('h3', null, '2 · THE HEALING TEAR — run the discriminator yourself'));
  card.append(el('div', 'why',
    'Store K memories around a ring, each with 3 copies, spreading copies by a fixed rotation. Then tear out a block and count what survives. ' +
    'Rational rotations stack copies into resonant piles — one tear can erase a memory completely. Irrational rotations spread copies evenly and heal. ' +
    'This is the program’s flagship experiment in miniature — and its most honest result: the mechanism is real, but SILVER (1+√2) ties or beats ' +
    'golden. Phi is the anchor of the family, not the champion. Try to beat silver with gold; the ledger couldn’t.'));

  const FAMILIES = {
    golden: { label: 'golden phi', alpha: PHI - 1 },
    silver: { label: 'silver 1+√2', alpha: Math.SQRT2 - 1 },
    rational: { label: 'resonant 1/3', alpha: 1 / 3 },
    random: { label: 'random', alpha: null },
  };
  const N = 144, K = 24, R = 3;
  let family = 'golden', damage = 0.72, seedTick = 1;

  const seg = el('div', 'ghp-seg');
  const segBtns = {};
  for (const [key, f] of Object.entries(FAMILIES)) {
    const b = el('button', key === family ? 'on' : '', f.label);
    b.onclick = () => { family = key; Object.values(segBtns).forEach((x) => x.classList.remove('on')); b.classList.add('on'); run(); };
    segBtns[key] = b; seg.append(b);
  }
  const cv = el('canvas', 'ghp-cv'); cv.height = 230;
  const row = el('div', 'ghp-row');
  const dmgLbl = el('label', null, 'tear size');
  const dmg = el('input'); dmg.type = 'range'; dmg.min = '0.1'; dmg.max = '0.9'; dmg.step = '0.01'; dmg.value = String(damage);
  const tear = el('button', 'ghp-btn', 'tear again');
  const read = el('span', 'ghp-read');
  row.append(dmgLbl, dmg, tear, read);
  const bars = el('div', 'ghp-bars');
  card.append(seg, cv, row, el('div', 'why',
    'the ledgered metric — WORST-CASE tear at this size (adversary picks where to cut; average over random tears in parentheses). ' +
    'Watch the resonant family hit exactly 0%: every copy piled on three sites, one cut erases everything. That number — 0.000 — is real and preregistered:'), bars);

  function placements(fam, tick) {
    // K logical slots x R replicas placed by successive rotation alpha (or uniform random)
    const pos = [];
    let alpha = FAMILIES[fam].alpha;
    let rngState = 12345 + tick * 977;
    const rng = () => { rngState = (rngState * 1103515245 + 12345) % 2147483648; return rngState / 2147483648; };
    for (let k = 0; k < K; k++) {
      const reps = [];
      for (let r = 0; r < R; r++) {
        const idx = alpha == null ? Math.floor(rng() * N) : Math.floor(((k * R + r) * alpha % 1) * N);
        reps.push(((idx % N) + N) % N);
      }
      pos.push(reps);
    }
    return pos;
  }

  function recovery(fam, start, size, tick) {
    const pos = placements(fam, tick);
    const dead = (i) => ((i - start + N) % N) < size;
    let ok = 0;
    for (const reps of pos) if (reps.some((i) => !dead(i))) ok++;
    return ok / K;
  }

  function run() {
    damage = parseFloat(dmg.value);
    seedTick++;
    const size = Math.round(N * damage);
    const start = Math.floor(((seedTick * 0.618) % 1) * N);
    const pos = placements(family, seedTick);
    const dead = (i) => ((i - start + N) % N) < size;

    // draw the ring
    const W = cv.clientWidth || 800; cv.width = W;
    const H = cv.height, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 4, rad = Math.min(W, H) / 2 - 26;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx + rad * Math.cos(a), cy + rad * Math.sin(a), 4.6, 0, Math.PI * 2);
      ctx.fillStyle = dead(i) ? 'rgba(255,90,90,.28)' : 'rgba(255,255,255,.14)';
      ctx.fill();
    }
    let okCount = 0;
    pos.forEach((reps, k) => {
      const alive = reps.some((i) => !dead(i));
      if (alive) okCount++;
      for (const i of reps) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx + rad * Math.cos(a), cy + rad * Math.sin(a), 3.2, 0, Math.PI * 2);
        ctx.fillStyle = dead(i) ? 'rgba(255,120,120,.7)' : (alive ? 'rgba(240,195,110,.95)' : 'rgba(150,180,255,.9)');
        ctx.fill();
      }
    });
    const rec = okCount / K;
    read.textContent = `${FAMILIES[family].label}: recovered ${okCount}/${K} memories (${(rec * 100).toFixed(0)}%)`;

    // family bars: WORST-CASE over every tear position (the ledgered adversarial metric),
    // with the random-tear average alongside for context.
    bars.innerHTML = '';
    const stats = Object.entries(FAMILIES).map(([key, f]) => {
      let worst = 1, sum = 0;
      for (let s2 = 0; s2 < N; s2++) {
        const rec2 = recovery(key, s2, size, 7);
        worst = Math.min(worst, rec2); sum += rec2;
      }
      return [key, f.label, worst, sum / N];
    });
    const best = Math.max(...stats.map((a) => a[2]));
    for (const [key, label, worst, avg] of stats) {
      const bar = el('div', 'ghp-bar' + (worst === best ? ' win' : ''));
      const fill = el('div', 'fill'); fill.style.height = `${Math.max(3, worst * 70)}px`;
      bar.append(el('span', 'v', `${(worst * 100).toFixed(0)}% (${(avg * 100).toFixed(0)})`), fill, el('span', null, label));
      bars.append(bar);
    }
  }
  dmg.addEventListener('input', run);
  tear.onclick = run;
  setTimeout(run, 0);

  card.append(el('div', 'ghp-foot',
    'Honesty note: this browser toy is an illustration, and in some regimes it will show golden edging silver — the ledgered runs (GH-RECOV, preregistered, ' +
    'two adversarial verifiers, harsher coverage-stressed regimes) found the reverse: silver beat golden, ~5-sigma in the adversarial tear. That regime-sensitivity ' +
    'is itself the lesson, and the unexplained silver edge is the program’s named open anomaly (SILVER-OPT). The selection lane is closed on five convergent instruments (SEL-CLOSE-001).'));
  return card;
}

// ── panel 3: the scoreboard ───────────────────────────────────────────────────
function scoreboardPanel() {
  const card = el('div', 'ghp-card');
  card.append(el('h3', null, '3 · THE SCOREBOARD — every claim that reached a real test'));
  card.append(el('div', 'why', 'Nulls and kills are shown as prominently as passes — deliberately. A program’s credibility is carried by the failures it reports.'));
  const rows = [
    ['Fibonacci is the minimal non-trivial boundary alphabet (category theory)', 'PROVEN', 'v-proven', 'phi is forced by the simplest fusion algebra — theorem-grade'],
    ['phi is the most irrational number (Hurwitz 1891)', 'PROVEN', 'v-proven', 'the one phi-specific fact that survives everything'],
    ['The r = phi·rs observer surface in GR (+ CG/de-Sitter rows, 2026-07-10)', 'PROVEN', 'v-proven', 'exact, coordinate-invariant identity — not a horizon, not selection'],
    ['Golden-chain dynamics are golden', 'KILL', 'v-kill', 'they are tricritical-Ising (c = 7/10) — the founding lesson: architecture is not dynamics'],
    ['phi² Jones index is specially clean', 'NULL', 'v-null', 'machinery closes at phi² — and equally at non-golden controls'],
    ['Two-observer consensus has a phi law', 'KILL', 'v-kill', 'met its own preregistered failure criterion'],
    ['Golden codes heal better than controls (the flagship discriminator)', 'NULL', 'v-null', 'mechanism real; SILVER ties/beats golden (~5-sigma in the adversarial regime)'],
    ['Nature selects phi over its metallic siblings', 'CLOSED', 'v-closed', 'SEL-CLOSE-001: five convergent instruments; identity yes, selection no; 4-part bar to reopen'],
    ['SYK kill window (the last live falsifier)', 'LIVE', 'v-live', 'theory audit 2026-07-10: standard answer beta = 2 sits INSIDE the kill window — an honest test'],
    ['Silver-optimality: real, or a noble-family plateau? (SILVER-OPT)', 'LIVE', 'v-live', 'the program’s named open anomaly — not a phi question'],
    ['Governed observer-boundary software + holographic memory', 'PASS', 'v-proven', 'engineering: 96% recall with half the trace destroyed — never physics evidence'],
  ];
  const table = el('table', 'ghp-score');
  const thead = el('tr'); ['CLAIM', 'VERDICT', 'MEANING'].forEach((h) => thead.append(el('th', null, h)));
  table.append(thead);
  for (const [claim, verdict, cls, meaning] of rows) {
    const tr = el('tr');
    tr.append(el('td', null, claim));
    const td = el('td'); td.append(el('span', `ghp-v ${cls}`, verdict)); tr.append(td);
    tr.append(el('td', null, meaning));
    table.append(tr);
  }
  card.append(table);
  card.append(el('div', 'ghp-quote',
    'The machine caught two of its own tests cheating in one session — one was measuring floating-point roundoff dressed as signal, one had a simulation ' +
    'that never actually evolved — and threw both out before reporting. The value of GHP is not that it finds phi everywhere; it is that it won’t let itself.'));
  return card;
}

// ── the mount ─────────────────────────────────────────────────────────────────
export function mountGhp(root) {
  injectStyle();
  const app = el('div', 'ghp-app');
  app.append(el('div', 'ghp-lede', 'Every measurement you have ever made is a record on a boundary.'));
  app.append(el('div', 'ghp-sub',
    'The Golden Horizon Principle asks whether that readable boundary has a minimal forced architecture — and whether it is the Fibonacci / golden-ratio ' +
    'structure category theory singles out. Months of preregistered tests returned an answer sharper than yes or no.'));

  // the three-layer discipline
  const layers = el('div', 'ghp-card');
  layers.append(el('h3', null, '0 · THREE QUESTIONS, THREE DIFFERENT DUTIES'));
  layers.append(el('div', 'why', 'Keeping these apart is the whole discipline. Tap each layer.'));
  const grid = el('div', 'ghp-layers');
  const L = [
    ['Layer 1 — Access', 'SOLID', 'rgba(129,212,180,.9)', 'Everything an observer has is boundary records — detector marks, retinal photons, signed receipts. This is ordinary physics, sharpened by the holographic bound. You may assert it.'],
    ['Layer 2 — Ontology', 'LIVE BET', 'rgba(150,180,255,.9)', 'Maybe the relational record-structure is all there is — no further “over there.” Held in the company of Wheeler’s it-from-bit and relational QM. Unproven, unrefuted; researched, never claimed.'],
    ['Layer 3 — Architecture', 'DECIDED: IDENTITY, NOT SELECTION', 'rgba(255,195,138,.9)', 'Is the boundary’s minimal structure Fibonacci? The theorems say phi IS the identity of the minimal alphabet once it exists. Every test of whether nature SELECTS it over silver/bronze came back generic — the lane is formally closed behind a reopening bar.'],
  ];
  for (const [title, status, color, more] of L) {
    const c = el('div', 'ghp-layer');
    c.append(el('b', null, title));
    const st = el('span', 'st', status); st.style.color = color; c.append(st);
    c.append(el('div', 'more', more));
    c.onclick = () => c.classList.toggle('open');
    grid.append(c);
  }
  layers.append(grid);
  app.append(layers);

  app.append(fixedPointPanel());
  app.append(healingPanel());
  app.append(scoreboardPanel());

  app.append(el('div', 'ghp-dnc',
    'Do-not-claim (binding, carried from the research canon): nothing on this screen is physics evidence · software success never validates GHP · ' +
    'the browser toy above is an illustration of a ledgered result, not a new run · an in-band exponent is standard physics, not GHP · the phi surface ' +
    'is not a horizon and proves nothing about selection · symbolic or aesthetic resonance is meaning-language, not proof. The research lives in GHP/ in this ' +
    'repository — canon, ledger, preregistrations, and every null — and is being prepared so others can contribute under the same falsification discipline.'));
  root.append(app);
}
