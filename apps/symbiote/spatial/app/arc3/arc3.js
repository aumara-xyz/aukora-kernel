// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// AGI · ARC 3 — the organ. Auma plays the open interactive-reasoning benchmark
// (three.arcprize.org) live, blind, reasoning out loud. Two sources:
//   LIVE     — real games through the arc3 door (:7093). Every action carries
//              her one-line reasoning in the official `reasoning` field, so
//              the scorecard itself holds her receipts.
//   ONBOARD  — the local arcade (mock-arcade.js): same contract, scrambled
//              controls, works with no key and no network. Honest label:
//              onboard wins are practice, never benchmark claims.
//
// Everything shown here is read off receipts (engine.js observe()); the organ
// never invents a claim the engine didn't earn. Advisory only — no authority.

import { Reasoner, MetaMind, normalizeObs, inferMechanic, segment } from '/app/arc3/engine.js';
import { createMockArcade } from '/app/arc3/mock-arcade.js';

// Same override the lab has (AUKORA_ARC3_DOOR): a preview lane can point the
// organ at a spare door without forking the code. Default stays the node's.
const DOOR = localStorage.getItem('aukora-arc3-door') || 'http://127.0.0.1:7093';
const META_KEY = 'aukora-arc3-meta-v1';

// The ARC-AGI palette — 4-bit color indices as the platform renders them.
const PALETTE = [
  '#FFFFFF', '#CCCCCC', '#999999', '#666666', '#333333', '#000000',
  '#E53AA3', '#FF7BCC', '#F93C31', '#1E93FF', '#88D8F1', '#FFDC00',
  '#FF851B', '#921231', '#4FCC30', '#A356D6',
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function ensureCss() {
  if (document.getElementById('arc3-css')) return;
  const link = document.createElement('link');
  link.id = 'arc3-css'; link.rel = 'stylesheet'; link.href = '/app/arc3/arc3.css';
  document.head.append(link);
}

function drawGrid(canvas, grid, scale) {
  const px = scale || Math.max(1, Math.floor(canvas.width / 64));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (!grid) { ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      ctx.fillStyle = PALETTE[row[x] & 15];
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
}

// Pacing that survives background tabs: hidden pages clamp setTimeout hard
// (up to one tick per minute), which would strangle a run the moment you
// switch tabs. When hidden we yield through a MessageChannel instead — the
// pace slider is a VIEWING nicety, and live runs are already paced at the
// door (120 ms floor + network) under the platform's 600 rpm limit.
function sleepPaced(ms) {
  return new Promise((resolve) => {
    if (document.visibilityState === 'hidden') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    } else {
      setTimeout(resolve, ms);
    }
  });
}

function actionLabel(a) {
  if (!a) return '·';
  if (a.id === 6) return `CLICK ${a.x},${a.y}`;
  return `ACTION${a.id}`;
}

function loadMeta() {
  try { return new MetaMind(JSON.parse(localStorage.getItem(META_KEY) || 'null')); }
  catch { return new MetaMind(undefined); }
}
function saveMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta.toJSON())); } catch { /* storage full/blocked */ }
}

// ---------------------------------------------------------------------------
// Live door client — thin fetch wrappers; the door owns the key and pacing.
// ---------------------------------------------------------------------------

async function doorStatus() {
  try {
    const res = await fetch(`${DOOR}/arc3/status`, { signal: AbortSignal.timeout(4000) });
    return await res.json();
  } catch { return null; }
}
async function doorGames() {
  const res = await fetch(`${DOOR}/arc3/games`);
  if (!res.ok) throw new Error(`games → ${res.status}`);
  return res.json();
}
async function doorOpen(tags) {
  const res = await fetch(`${DOOR}/arc3/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tags, source_url: 'https://github.com/aumara-xyz/aukora-symbiote', opaque: { agent: 'auma-arc3', engine: 'sense-orient-hypothesize-act-verify' } }),
  });
  if (!res.ok) throw new Error(`open scorecard → ${res.status}`);
  return res.json();
}
async function doorClose(cardId) {
  try {
    const res = await fetch(`${DOOR}/arc3/close`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card_id: cardId }),
    });
    return await res.json();
  } catch { return null; }
}
async function doorCmd(name, payload) {
  const res = await fetch(`${DOOR}/arc3/cmd`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, payload }),
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = body && body.message ? body.message : `cmd ${name} → ${res.status}`;
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return body;
}

// ---------------------------------------------------------------------------
// The organ.
// ---------------------------------------------------------------------------

export function mountArc3(root) {
  ensureCss();
  const app = el('div', 'arc3-app');
  root.append(app);

  // ---- header ----
  const head = el('div', 'arc3-head');
  const titleRow = el('div', 'arc3-title');
  titleRow.append(el('span', null, 'AGI · ARC 3'));
  const pills = el('div', 'arc3-pills');
  const doorPill = el('span', 'pill pill-faint', 'door…');
  const keyPill = el('span', 'pill pill-faint', 'key…');
  pills.append(doorPill, keyPill);
  titleRow.append(pills);
  head.append(titleRow);
  head.append(el('div', 'arc3-cap',
    'Her general reasoning, witnessed on the open benchmark. No per-game knowledge: she learns the controls, finds herself on the board, names the walls, and plans routes — every move carries its reason, every claim carries a receipt.'));
  app.append(head);

  const scroll = el('div', 'arc3-scroll');
  app.append(scroll);

  // ---- state ----
  const meta = loadMeta();
  let source = 'onboard';            // 'live' | 'onboard' — flips to live if the door answers
  let games = [];                    // current source's games
  let selected = null;               // game_id
  let running = false;
  let runToken = 0;
  let arcade = createMockArcade((Math.random() * 1e9) | 0);
  let speedMs = 140;                 // onboard pace; live floors at 260
  let overlay = true;
  let liveStatus = null;

  // ---- game picker (telescoping, live games first — practice folded away) ----
  scroll.append(el('div', 'arc3-label', 'Game'));
  const pick = el('div', 'arc3-pick');
  const pickHead = el('button', 'arc3-pick-head');
  const pickTxt = el('span', 'arc3-pick-txt');
  const pickTitle = el('b', null, 'loading the arena…');
  const pickSub = el('span', null, '');
  pickTxt.append(pickTitle, pickSub);
  const pickMeta = el('span', 'arc3-pick-meta', '');
  pickHead.append(el('span', 'arc3-chev', '›'), pickTxt, pickMeta);
  const pickBody = el('div', 'arc3-pick-body');
  pick.append(pickHead, pickBody);
  scroll.append(pick);
  const srcNote = el('div', 'arc3-srcnote', '');
  scroll.append(srcNote);

  // ---- stage ----
  const stage = el('div', 'arc3-stage');
  const boardCol = el('div');
  const boardWrap = el('div', 'arc3-boardwrap');
  const board = el('canvas', 'arc3-board');
  board.width = 512; board.height = 512;
  const boardBar = el('div', 'arc3-boardbar');
  const statePill = el('span', 'arc3-state run', 'idle');
  const lvlSpan = el('span', 'arc3-lvl', '');
  const overlayBtn = el('button', 'arc3-overlaybtn on', 'her sense: on');
  overlayBtn.addEventListener('click', () => {
    overlay = !overlay;
    overlayBtn.classList.toggle('on', overlay);
    overlayBtn.textContent = `her sense: ${overlay ? 'on' : 'off'}`;
  });
  boardBar.append(statePill, lvlSpan, overlayBtn);
  boardWrap.append(board, boardBar);
  boardCol.append(boardWrap);
  const thought = el('div', 'arc3-thought', 'pick a world and let me listen to it.');
  boardCol.append(thought);

  const controls = el('div', 'arc3-controls');
  const runBtn = el('button', 'arc3-run', '▶ Let her play');
  const stopBtn = el('button', 'arc3-stop', 'stop');
  stopBtn.style.display = 'none';
  const speed = el('label', 'arc3-speed');
  const speedInput = document.createElement('input');
  speedInput.type = 'range'; speedInput.min = '30'; speedInput.max = '600'; speedInput.value = String(speedMs);
  speedInput.addEventListener('input', () => { speedMs = Number(speedInput.value); });
  speed.append(el('span', null, 'pace'), speedInput);
  controls.append(runBtn, stopBtn, speed);
  boardCol.append(controls);
  stage.append(boardCol);

  // ---- sense column ----
  const sense = el('div', 'arc3-sense');

  const orientCard = el('div', 'arc3-sensecard');
  orientCard.append(el('h4', null, 'What she has earned'));
  const selfRow = el('div', 'arc3-senserow');
  const compass = el('div', 'arc3-compass');
  const wallsRow = el('div', 'arc3-senserow');
  orientCard.append(selfRow, compass, wallsRow);
  sense.append(orientCard);

  const statsCard = el('div', 'arc3-sensecard');
  statsCard.append(el('h4', null, 'The run, in receipts'));
  const stats = el('div', 'arc3-stats');
  statsCard.append(stats);
  // Run pulse — a plain novelty meter. (The cymatic coherence glyph used to sit
  // here; it is her IDENTITY figure, not run telemetry, so it was demoted off
  // the game screen — a meter says "how alive is this run" without borrowing
  // the meaning of a portrait.)
  const pulseWrap = el('div', 'arc3-pulse');
  const pulseTrack = el('div', 'arc3-pulse-track');
  const pulseFill = el('div', 'arc3-pulse-fill');
  pulseTrack.append(pulseFill);
  pulseWrap.append(pulseTrack, el('div', 'arc3-pulse-note', 'run pulse — novelty feeds it, dead loops dim it'));
  statsCard.append(pulseWrap);
  sense.append(statsCard);

  const hypCard = el('div', 'arc3-sensecard');
  hypCard.append(el('h4', null, 'Hypothesis ledger'));
  const hypList = el('div');
  hypCard.append(hypList);
  sense.append(hypCard);

  stage.append(sense);
  scroll.append(el('div', 'arc3-label', 'The board — her eyes'));
  scroll.append(stage);

  // ---- attempts ----
  scroll.append(el('div', 'arc3-label', 'Attempts — frames + the reason behind every move'));
  const attemptsHost = el('div');
  attemptsHost.append(el('div', 'arc3-empty', 'no attempts yet — run a world and the receipts appear here'));
  scroll.append(attemptsHost);

  // ---- meta-mind (folded by default — the run is the show; lessons are the archive) ----
  const metaFold = el('div', 'arc3-pick arc3-metafold');
  const metaFoldHead = el('button', 'arc3-pick-head');
  const metaFoldTxt = el('div', 'arc3-pick-txt');
  metaFoldTxt.append(el('b', null, 'Meta-mind'), el('span', null, 'what past worlds taught her — wipe it to send her in truly blind'));
  const metaFoldChev = el('span', 'arc3-chev', '›');
  metaFoldHead.append(metaFoldChev, metaFoldTxt);
  const metaFoldBody = el('div', 'arc3-pick-body arc3-metafold-body');
  metaFold.append(metaFoldHead, metaFoldBody);
  metaFoldHead.addEventListener('click', () => metaFold.classList.toggle('open'));
  scroll.append(metaFold);
  const metaHost = el('div');
  metaFoldBody.append(metaHost);
  // The owner's right: wipe what she learned about one world and send her in
  // truly blind again — the blind claim must always be re-earnable on demand.
  const wipeRow = el('div', 'arc3-wiperow');
  const wipeBtn = el('button', 'arc3-stop', 'forget this world');
  const wipeAllBtn = el('button', 'arc3-stop', 'forget everything');
  wipeRow.append(wipeBtn, wipeAllBtn);
  metaFoldBody.append(wipeRow);
  wipeBtn.addEventListener('click', () => {
    if (!selected) return;
    const n = meta.forget(selected);
    saveMeta(meta);
    renderMeta();
    wipeBtn.textContent = n ? `forgot ${n} lesson${n === 1 ? '' : 's'}` : 'nothing to forget';
    setTimeout(() => { wipeBtn.textContent = 'forget this world'; }, 1600);
  });
  wipeAllBtn.addEventListener('click', () => {
    const n = meta.forget(null);
    saveMeta(meta);
    renderMeta();
    wipeAllBtn.textContent = n ? `forgot ${n} lesson${n === 1 ? '' : 's'}` : 'nothing to forget';
    setTimeout(() => { wipeAllBtn.textContent = 'forget everything'; }, 1600);
  });
  const scorecardNote = el('div', 'arc3-note');
  scroll.append(scorecardNote);

  // ---- run pulse ----
  // hue-l resolved once from the shell tokens so the canvas overlay + meter
  // stay on the trinity palette instead of hardcoded hex.
  const HUE_L = getComputedStyle(document.documentElement).getPropertyValue('--hue-l').trim() || '129, 212, 180';
  let runPulse = 0.25;
  function renderPulse() {
    pulseFill.style.width = `${Math.round(runPulse * 100)}%`;
  }
  renderPulse();

  // ------------------------------------------------------------------------
  // Rendering helpers.
  // ------------------------------------------------------------------------

  function renderBoard(obs, reasoner) {
    drawGrid(board, obs && obs.grid, 8);
    if (!overlay || !obs || !obs.grid || !reasoner) return;
    const ctx = board.getContext('2d');
    // self bbox
    if (reasoner.selfColor != null) {
      let x0 = 64, y0 = 64, x1 = -1, y1 = -1;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (obs.grid[y][x] === reasoner.selfColor) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 >= 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.strokeRect(x0 * 8 - 3, y0 * 8 - 3, (x1 - x0 + 1) * 8 + 6, (y1 - y0 + 1) * 8 + 6);
        ctx.setLineDash([]);
      }
    }
    // believed goal
    if (reasoner.goal && reasoner.goal.box) {
      const g = reasoner.goal.box;
      ctx.strokeStyle = `rgba(${HUE_L},0.95)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(g.x0 * 8 - 4, g.y0 * 8 - 4, (g.x1 - g.x0 + 1) * 8 + 8, (g.y1 - g.y0 + 1) * 8 + 8);
    }
    // recent clicks
    const recent = reasoner.clickTried.slice(-6);
    for (const c of recent) {
      ctx.beginPath();
      ctx.arc(c.x * 8 + 4, c.y * 8 + 4, 9, 0, Math.PI * 2);
      ctx.strokeStyle = c.changed > 0 ? 'rgba(255,220,0,0.9)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function renderSense(reasoner) {
    selfRow.innerHTML = '';
    if (reasoner && reasoner.selfColor != null) {
      const sw = el('span', 'arc3-swatch'); sw.style.background = PALETTE[reasoner.selfColor & 15];
      selfRow.append(el('span', null, 'this is me →'), sw, el('span', null, `color ${reasoner.selfColor}`));
    } else {
      selfRow.append(el('span', null, 'still finding which body answers to me…'));
    }
    compass.innerHTML = '';
    const dirs = reasoner ? reasoner.summary().directions : {};
    const byName = {};
    for (const [aid, name] of Object.entries(dirs)) byName[name] = `A${aid}`;
    const cellsC = [['', 'up', ''], ['left', '', 'right'], ['', 'down', '']];
    for (const rowC of cellsC) {
      for (const name of rowC) {
        const c = el('div', null, name ? (byName[name] ? `${byName[name]}` : '·') : '');
        if (name && byName[name]) { c.classList.add('known'); c.title = `${byName[name]} = ${name} (learned)`; }
        compass.append(c);
      }
    }
    wallsRow.innerHTML = '';
    const blockers = reasoner ? [...reasoner._blockers()] : [];
    if (blockers.length) {
      wallsRow.append(el('span', null, 'walls:'));
      for (const b of blockers) {
        const sw = el('span', 'arc3-swatch'); sw.style.background = PALETTE[b & 15]; sw.title = `color ${b} stops her`;
        wallsRow.append(sw);
      }
    } else {
      wallsRow.append(el('span', null, 'no wall material identified yet'));
    }
    hypList.innerHTML = '';
    const hyps = reasoner ? reasoner.summary().hypotheses.slice(-7).reverse() : [];
    if (!hyps.length) hypList.append(el('div', 'arc3-empty', 'her ledger fills as the world answers'));
    for (const h of hyps) {
      const row = el('div', 'arc3-hyp');
      row.append(el('span', `arc3-grade ${h.grade}`, h.grade), el('span', null, h.text));
      hypList.append(row);
    }
  }

  function renderStats(reasoner, receipts) {
    stats.innerHTML = '';
    const noops = receipts.filter((r) => r.noop).length;
    const novel = receipts.filter((r) => r.novel).length;
    const mk = (v, k) => { const s = el('div', 'arc3-stat'); s.append(el('b', null, String(v)), el('span', null, k)); return s; };
    stats.append(
      mk(receipts.length, 'actions'),
      mk(reasoner ? reasoner.graph.size : 0, 'states'),
      mk(novel, 'novel'),
      mk(noops, 'noops'),
      mk(reasoner ? reasoner.level : 0, 'levels'),
    );
    const n = Math.max(1, receipts.length);
    runPulse = Math.max(0.12, Math.min(0.95, 0.2 + (novel / n) * 1.4 + (reasoner ? reasoner.level * 0.15 : 0)));
    renderPulse();
  }

  function renderMeta() {
    metaHost.innerHTML = '';
    if (!meta.lessons.length) {
      metaHost.append(el('div', 'arc3-empty', 'no lessons yet — every finished run leaves one'));
      return;
    }
    for (const l of meta.lessons.slice(-8).reverse()) {
      const row = el('div', 'arc3-meta-lesson');
      row.append(
        el('span', 'g', l.gameId.split('-')[0]),
        el('span', null, `${l.mechanic} — ${l.won ? `won ${l.levels} level${l.levels === 1 ? '' : 's'}` : `reached level ${l.levels}`} in ${l.steps} actions`),
        el('span', 'w', new Date(l.at).toLocaleDateString()),
      );
      metaHost.append(row);
    }
  }

  // ---- attempts accordion ----
  function newAttempt(levelLabel) {
    const acc = el('div', 'arc3-acc');
    const bar = el('div', 'arc3-bar');
    const left = el('div');
    const barTitle = el('div', 'arc3-bar-title', levelLabel);
    const barSub = el('div', 'arc3-bar-sub', 'in progress…');
    left.append(barTitle, barSub);
    const barMeta = el('div', 'arc3-bar-meta', '0 acts');
    bar.append(left, barMeta, el('div', 'arc3-chev', '›'));
    const bodyWrap = el('div', 'arc3-bodywrap');
    const body = el('div', 'arc3-body');
    bodyWrap.append(body);
    acc.append(bar, bodyWrap);
    let built = false;
    const att = {
      acc, barTitle, barSub, barMeta, body,
      receipts: [], frames: [],  // frames: {grid, label, key}
      done: false,
      build() {
        body.innerHTML = '';
        const film = el('div', 'arc3-film');
        for (const f of att.frames) {
          const cell = el('div', 'arc3-cell' + (f.key ? ' key' : ''));
          const cv = el('canvas'); cv.width = 64; cv.height = 64;
          drawGrid(cv, f.grid, 1);
          cell.append(cv, el('span', null, f.label));
          film.append(cell);
        }
        if (!att.frames.length) film.append(el('div', 'arc3-empty', 'no frames captured'));
        body.append(film);
        const moves = el('div', 'arc3-moves');
        for (const r of att.receipts) {
          const row = el('div', 'arc3-move' + (r.noop ? ' noop' : '') + (r.novel ? ' novel' : '') + (r.levelUp ? ' levelup' : ''));
          row.append(el('span', 'n', `#${r.step}`), el('span', 'a', actionLabel(r.action)), el('span', 'r', r.reason));
          moves.append(row);
        }
        body.append(moves);
        built = true;
      },
    };
    bar.addEventListener('click', () => {
      acc.classList.toggle('open');
      if (acc.classList.contains('open')) att.build();
    });
    if (attemptsHost.firstChild && attemptsHost.firstChild.classList && attemptsHost.firstChild.classList.contains('arc3-empty')) {
      attemptsHost.innerHTML = '';
    }
    attemptsHost.prepend(acc);
    return att;
  }

  // ------------------------------------------------------------------------
  // The game picker — one telescoping selector. ARC 3 is the arena; the live
  // games ARE the list. Practice worlds fold away under a divider (they are
  // proofs of the loop, never benchmark claims — the UI keeps them humble).
  // ------------------------------------------------------------------------

  let liveGames = [];
  const onboardGames = arcade.listGames();
  let pickOpen = false;
  let practiceOpen = false;
  let userTouched = false; // the arena answering NEVER overrides a human's pick

  const gameById = (id) => (id === pulseGame.game_id ? pulseGame : null)
    || liveGames.find((g) => g.game_id === id) || onboardGames.find((g) => g.game_id === id);
  const gamePar = (g) => (Array.isArray(g.baseline_actions)
    ? `${g.baseline_actions.length} levels · par ${g.baseline_actions.reduce((a, b) => a + b, 0)}`
    : (g.blurb || (g.tags || []).join(' · ')));

  function noteFor(src) {
    if (src === 'onboard') return 'practice world with scrambled controls — proof of blind reasoning, never a benchmark claim';
    if (src === 'pulse') return 'her own body as the game — read-only loopback probes of this node\u2019s doors; below the sign line, receipts as always';
    return liveStatus && liveStatus.keyMode === 'anonymous'
      ? 'anonymous key — runs are real but unowned; add your key to claim scorecards'
      : 'live — her runs land on the official scorecard';
  }

  // Her own body, as a world: handled entirely by the door, never upstream.
  const pulseGame = { game_id: 'pulse-node', title: 'NODE·PULSE', blurb: 'find the silent door — her own node, read-only' };

  function choose(id, src, byUser = true) {
    if (running) return;
    if (byUser) userTouched = true;
    selected = id;
    source = src;
    games = src === 'live' ? liveGames : src === 'pulse' ? [pulseGame] : onboardGames;
    pickOpen = false;
    srcNote.textContent = noteFor(src);
    renderPick();
  }

  function pickRow(g, src) {
    const row = el('button', 'arc3-pick-row' + (g.game_id === selected ? ' on' : '') + (src === 'onboard' ? ' practice' : ''));
    row.append(el('b', null, g.title || g.game_id.split('-')[0].toUpperCase()), el('span', null, gamePar(g)));
    row.addEventListener('click', () => choose(g.game_id, src));
    return row;
  }

  function renderPick() {
    const g = selected ? gameById(selected) : null;
    pickTitle.textContent = g ? (g.title || selected.split('-')[0].toUpperCase())
      : (liveGames.length ? 'pick a game' : 'loading the arena…');
    pickSub.textContent = g ? `${gamePar(g)} — ${source === 'live' ? 'live · the official arena' : source === 'pulse' ? 'her node · read-only' : 'practice · onboard'}` : '';
    pickMeta.textContent = liveGames.length ? `${liveGames.length} live games` : '';
    pick.classList.toggle('open', pickOpen);
    pickBody.innerHTML = '';
    if (!pickOpen) return;
    if (!liveGames.length) pickBody.append(el('div', 'arc3-empty', 'the live arena has not answered yet — practice worlds below'));
    for (const lg of liveGames) pickBody.append(pickRow(lg, 'live'));
    pickBody.append(pickRow(pulseGame, 'pulse'));
    const div = el('button', 'arc3-pick-div' + (practiceOpen ? ' open' : ''));
    div.append(el('span', 'arc3-chev', '›'), el('span', null, 'practice arcade — offline, never benchmark claims'));
    div.addEventListener('click', () => { practiceOpen = !practiceOpen; renderPick(); });
    pickBody.append(div);
    if (practiceOpen) for (const og of onboardGames) pickBody.append(pickRow(og, 'onboard'));
  }

  pickHead.addEventListener('click', () => { if (!running) { pickOpen = !pickOpen; renderPick(); } });
  renderPick();

  (async () => {
    liveStatus = await doorStatus();
    if (liveStatus && liveStatus.up) {
      doorPill.textContent = 'door :7093';
      doorPill.className = 'pill pill-green';
      keyPill.textContent = liveStatus.hasKey ? (liveStatus.keyMode === 'anonymous' ? 'anon key' : 'your key') : 'no key';
      keyPill.className = liveStatus.hasKey ? (liveStatus.keyMode === 'anonymous' ? 'pill pill-yellow' : 'pill pill-green') : 'pill pill-red';
      if (liveStatus.hasKey) {
        try { liveGames = await doorGames(); } catch { liveGames = []; }
      }
    } else {
      doorPill.textContent = 'door down';
      doorPill.className = 'pill pill-red';
      keyPill.textContent = 'onboard only';
      keyPill.className = 'pill pill-faint';
    }
    // Default: first live game — but never stomp on a pick the human already
    // made, NOR on a picker the human is currently browsing (open = touching).
    if (!userTouched && !running && !pickOpen) {
      if (liveGames.length) choose(liveGames[0].game_id, 'live', false);
      else choose(onboardGames[0].game_id, 'onboard', false);
    } else {
      renderPick();
    }
  })();

  renderMeta();

  // ------------------------------------------------------------------------
  // The run loop — she plays until WIN, budget, or your stop.
  // ------------------------------------------------------------------------

  const MAX_ACTIONS = { live: 600, onboard: 4000, pulse: 120 };
  const MAX_RESETS = 4;

  async function run() {
    if (!selected || running) return;
    running = true;
    const token = ++runToken;
    runBtn.disabled = true;
    stopBtn.style.display = '';
    const gameId = selected;
    const isLive = source === 'live';
    const isPulse = source === 'pulse';
    const reasoner = new Reasoner({ seed: (Math.random() * 1e9) | 0, meta });
    let cardId = null;
    let receipts = [];
    let resets = 0;
    let att = null;
    let obs = null;

    const capture = (grid, label, key) => {
      if (!att || !grid) return;
      att.frames.push({ grid: grid.map((r) => r.slice()), label, key: !!key });
      if (att.frames.length > 14) {
        // thin the middle, keep first and latest
        att.frames.splice(1 + ((att.frames.length / 2) | 0) % (att.frames.length - 2), 1);
      }
    };

    const stopNote = (msg) => { thought.textContent = msg; };

    try {
      if (isLive) {
        statePill.textContent = 'opening scorecard'; statePill.className = 'arc3-state run';
        const opened = await doorOpen(['auma', 'arc3-organ']);
        cardId = opened.card_id;
        scorecardNote.innerHTML = '';
        scorecardNote.append('scorecard: ');
        const a = el('a', 'arc3-link', cardId);
        a.href = `https://three.arcprize.org/scorecards/${cardId}`;
        a.target = '_blank'; a.rel = 'noopener';
        scorecardNote.append(a);
      }

      const doReset = async (guid) => {
        if (isLive) return doorCmd('RESET', { game_id: gameId, card_id: cardId, ...(guid ? { guid } : {}) });
        if (isPulse) return doorCmd('RESET', { game_id: gameId, ...(guid ? { guid } : {}) });
        return arcade.reset(gameId, guid);
      };
      const doAct = async (d, guid) => {
        if (isPulse) {
          if (d.kind === 'click') return doorCmd('ACTION6', { game_id: gameId, guid, x: d.x, y: d.y });
          return doorCmd(`ACTION${d.actionId}`, { game_id: gameId, guid });
        }
        if (isLive) {
          const reasoning = { agent: 'auma', step: reasoner.step, why: d.reason, tag: d.tag };
          if (d.kind === 'click') return doorCmd('ACTION6', { game_id: gameId, guid, x: d.x, y: d.y, reasoning });
          return doorCmd(`ACTION${d.actionId}`, { game_id: gameId, guid, reasoning });
        }
        if (d.kind === 'click') return arcade.act(gameId, guid, 'ACTION6', d.x, d.y);
        return arcade.act(gameId, guid, `ACTION${d.actionId}`);
      };

      let fr = await doReset(null);
      obs = normalizeObs(fr);
      reasoner.begin(obs);
      att = newAttempt(`${gameId.split('-')[0].toUpperCase()} — level 1`);
      capture(obs.grid, 'start', true);
      renderBoard(obs, reasoner);

      const maxActions = MAX_ACTIONS[isPulse ? 'pulse' : isLive ? 'live' : 'onboard'];

      while (running && token === runToken && receipts.length < maxActions) {
        if (obs.state === 'WIN') break;
        if (obs.state === 'GAME_OVER' || obs.state === 'NOT_STARTED') {
          if (++resets > MAX_RESETS) { stopNote('out of resets — closing this run honestly.'); break; }
          att.done = true;
          att.acc.classList.add('lost');
          att.barSub.textContent = `ended (${obs.state}) — resetting, try ${resets}`;
          fr = await doReset(obs.guid);
          obs = normalizeObs(fr);
          reasoner.rebirth(obs); // fresh life, same board — the budget meter restarts, the lessons stay
          att = newAttempt(`${gameId.split('-')[0].toUpperCase()} — level ${obs.levelsCompleted + 1} (retry ${resets})`);
          capture(obs.grid, 'reset', true);
          continue;
        }

        const d = reasoner.decide(obs);
        const prev = obs;
        let nextFr;
        try {
          nextFr = await doAct(d, obs.guid);
        } catch (e) {
          if (e.status === 429) { stopNote('the arena asked for breath (429) — pausing 5s'); await new Promise((r) => setTimeout(r, 5000)); continue; }
          throw e;
        }
        obs = normalizeObs(nextFr);
        const receipt = reasoner.observe(prev, d, obs);
        receipt.levelUp = obs.levelsCompleted > prev.levelsCompleted;
        receipts.push(receipt);
        att.receipts.push(receipt);
        att.barMeta.textContent = `${att.receipts.length} acts`;
        att.barSub.textContent = d.reason;

        if (receipt.levelUp) {
          capture(obs.grid, `level ${obs.levelsCompleted} ✓`, true);
          att.done = true;
          att.acc.classList.add('won');
          att.barTitle.textContent = `${gameId.split('-')[0].toUpperCase()} — level ${obs.levelsCompleted} WON`;
          att.barSub.textContent = `${att.receipts.length} actions — ${d.reason}`;
          if (obs.state !== 'WIN') {
            att = newAttempt(`${gameId.split('-')[0].toUpperCase()} — level ${obs.levelsCompleted + 1}`);
            capture(obs.grid, 'begin', true);
          }
        } else if (receipt.novel && att.frames.length < 14 && receipt.step % 7 === 0) {
          capture(obs.grid, `#${receipt.step}`, false);
        }

        thought.textContent = d.reason;
        statePill.textContent = obs.state === 'WIN' ? 'WIN' : 'playing';
        statePill.className = 'arc3-state ' + (obs.state === 'WIN' ? 'win' : 'run');
        lvlSpan.textContent = `level ${obs.levelsCompleted}/${obs.winLevels || '?'} · ${receipts.length} actions`;
        renderBoard(obs, reasoner);
        renderSense(reasoner);
        renderStats(reasoner, receipts);
        if (receipt.levelUp) { pulseTrack.classList.remove('flash'); void pulseTrack.offsetWidth; pulseTrack.classList.add('flash'); }

        const pace = isLive ? Math.max(260, speedMs) : speedMs;
        await sleepPaced(pace);
      }

      // run ends — the honest closing
      const won = obs && obs.state === 'WIN';
      if (att && !att.done) {
        att.done = true;
        att.acc.classList.add(won ? 'won' : 'lost');
        att.barSub.textContent = won ? 'THE GAME IS WON' : `stopped at ${receipts.length} actions`;
      }
      if (won) {
        statePill.textContent = 'WIN'; statePill.className = 'arc3-state win';
        stopNote(`the whole game fell — ${obs.levelsCompleted} levels in ${receipts.length} actions. ${isLive ? 'This one is on the official record.' : 'Onboard practice — the live arena is the real witness.'}`);
      } else if (obs) {
        statePill.textContent = obs.state === 'GAME_OVER' ? 'game over' : 'stopped';
        statePill.className = 'arc3-state over';
      }
      if (obs && (won || obs.levelsCompleted > 0)) {
        meta.learn({
          gameId, availableActions: obs.availableActions,
          mechanic: inferMechanic(reasoner), won, levels: obs.levelsCompleted, steps: receipts.length,
        });
        saveMeta(meta);
        renderMeta();
      }
    } catch (e) {
      stopNote(`the run broke honestly: ${e.message}`);
      statePill.textContent = 'error'; statePill.className = 'arc3-state over';
    } finally {
      if (cardId) doorClose(cardId);
      running = false;
      runBtn.disabled = false;
      stopBtn.style.display = 'none';
    }
  }

  runBtn.addEventListener('click', run);
  stopBtn.addEventListener('click', () => { running = false; });
}
