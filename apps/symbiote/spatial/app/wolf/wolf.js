// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// THE WOLF — paper trading, loudly. PAPER ONLY, forever (issue #270).
//
// One screen, money in, money out: a PAPER MODE banner that never leaves,
// five fictional instruments on a deterministic local walk, a simulated
// wallet, manual buys and sells, a timeline where every entry carries its
// price's provenance, and a reset button that burns it all down. Nothing
// here can reach a broker, a wallet, an exchange, or the network — the
// market is arithmetic, the money is theater, the receipts are real.
//
// Registered through the app registry (aukora-app-contract-v1, organ `wolf`);
// no shell literals were touched to put this on screen.

import { createMarket, SIM_SOURCE } from '/app/wolf/wolf-market.js';
import { createLedger, isValidLedger, STARTING_CASH } from '/app/wolf/wolf-ledger.js';
import { createWolfTotem } from '/app/wolf/wolf-totem.js';
import { runStudy, STUDY_DISCLAIMER, buildPackNote, verifyPackNote, packDisagreement, composeDossier } from '/app/wolf/wolf-lab.js';
import { parseMindReceipts, storyVerdict, parseEpisodicMemory } from '/app/wolf/wolf-mind-story.js';
import { WOLF_ACTION_MEANING } from '/app/wolf/wolf-mind-env.js';
import { fetchKrakenTicker, fetchKrakenHistory, fetchCoinbaseSpot, secondWitness, makeLiveQuote, LIVE_PRODUCT, LIVE_SOURCES, MIN_POLL_MS } from '/app/wolf/wolf-live.js';

const LS_LEDGER = 'aukora-wolf-ledger-v1';
const LS_SEED = 'aukora-wolf-seed-v1';
const LS_STUDIES = 'aukora-wolf-studies-v1';
const LS_PACK = 'aukora-wolf-pack-v1';
const LS_NODE = 'aukora-wolf-nodename-v1';
const LS_HUMAN = 'aukora-wolf-humannotes-v1';
const LS_LIVE = 'aukora-wolf-live-v1';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function ensureCss() {
  if (document.getElementById('wolf-css')) return;
  const link = document.createElement('link');
  link.id = 'wolf-css'; link.rel = 'stylesheet'; link.href = '/app/wolf/wolf.css';
  document.head.append(link);
}

function money(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function loadLedger() {
  try {
    const raw = localStorage.getItem(LS_LEDGER);
    const parsed = raw ? JSON.parse(raw) : null;
    return createLedger(isValidLedger(parsed) ? parsed : undefined);
  } catch { return createLedger(); }
}

function loadSeed() {
  try {
    const raw = localStorage.getItem(LS_SEED);
    if (raw && /^\d+$/.test(raw)) return Number(raw);
    const seed = (Math.random() * 1e9) | 0;
    localStorage.setItem(LS_SEED, String(seed));
    return seed;
  } catch { return 42; }
}

function sparkline(canvas, history, hue) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 220, h = canvas.clientHeight || 44;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const n = history.length;
  if (n < 2) return;
  let min = Infinity, max = -Infinity;
  for (const v of history) { if (v < min) min = v; if (v > max) max = v; }
  const span = max - min || 1;
  const up = history[n - 1] >= history[0];
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h - 3 - ((history[i] - min) / span) * (h - 6);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `rgba(${hue},${up ? 0.9 : 0.55})`;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = `rgba(${hue},0.07)`;
  ctx.fill();
}

export function mountApp(root) {
  ensureCss();
  const seed = loadSeed();
  const market = createMarket({ seed });
  const ledger = loadLedger();
  const buyChips = [100, 500, 1000];
  let buyAmt = buyChips[0];

  const wrap = el('div', 'wolf');
  root.append(wrap);

  // ---- the banner that never leaves (the shell header owns the title;
  // this app leads with the golden wolf and the one label that matters) ----
  const head = el('div', 'wolf-head');
  const totemCv = el('canvas', 'wolf-totem');
  totemCv.title = 'the golden wolf — forty triangles, zero dependencies';
  const totem = createWolfTotem(totemCv);
  const headText = el('div', 'wolf-head-text');
  const paper = el('div', 'wolf-paper');
  paper.append(el('span', null, 'PAPER MODE'));
  paper.title = 'Simulated money only. Fictional instruments. Not investment advice. Nothing here can place a real order.';
  headText.append(paper, el('div', 'wolf-sub', 'simulated money · fictional instruments · never advice · real friction (fees + slippage) so the paper never flatters you'));
  head.append(totemCv, headText);
  wrap.append(head);

  // ---- wallet strip ----
  const strip = el('div', 'wolf-strip');
  const stat = (label) => {
    const s = el('div', 'wolf-stat');
    const v = el('b', null, '—');
    s.append(v, el('span', null, label));
    strip.append(s);
    return v;
  };
  const vCash = stat('paper cash');
  const vEquity = stat('equity');
  const vUnreal = stat('open P&L');
  const vReal = stat('realized P&L');
  wrap.append(strip);

  // ---- instrument cards ----
  const rail = el('div', 'wolf-rail');
  wrap.append(rail);
  const cards = new Map();
  for (const q of market.quotes()) {
    const card = el('div', 'wolf-card');
    card.style.setProperty('--whue', q.hue);
    const top = el('div', 'wolf-card-top');
    const idw = el('div', 'wolf-id');
    idw.append(el('b', null, q.symbol), el('span', null, q.name));
    const px = el('div', 'wolf-px');
    const pxV = el('b', null, money(q.price));
    const pxD = el('span', 'wolf-delta', '·');
    px.append(pxV, pxD);
    top.append(idw, px);
    const cv = el('canvas', 'wolf-spark');
    const act = el('div', 'wolf-act');
    const buy = el('button', 'wolf-buy', `Buy $${buyAmt}`);
    const sellQ = el('button', 'wolf-sell', 'Sell ½');
    const sellAll = el('button', 'wolf-sell', 'Sell all');
    act.append(buy, sellQ, sellAll);
    const held = el('div', 'wolf-held', '');
    card.append(top, cv, act, held);
    rail.append(card);
    cards.set(q.symbol, { card, pxV, pxD, cv, buy, sellQ, sellAll, held });

    buy.addEventListener('click', () => {
      const quote = market.quotes().find((x) => x.symbol === q.symbol);
      const r = ledger.buy(quote, buyAmt);
      note(r.ok ? `bought ${r.qty.toFixed(4)} ${q.symbol} for ${money(buyAmt)}` : r.reason, r.ok);
      persist(); render();
    });
    const sellFrac = (f, label) => {
      const quote = market.quotes().find((x) => x.symbol === q.symbol);
      const r = ledger.sell(quote, f);
      note(r.ok ? `sold ${label} ${q.symbol} for ${money(r.proceeds)} (${r.realized >= 0 ? '+' : ''}${money(r.realized)} realized)` : r.reason, r.ok);
      persist(); render();
    };
    sellQ.addEventListener('click', () => sellFrac(0.5, '½ of'));
    sellAll.addEventListener('click', () => sellFrac(1, 'all'));
  }

  // ---- THE LIVE TAPE: real public prices, read-only, OFF by default ----
  // The fence, kept: keyless public endpoints only, no orders, no writes.
  // Two independent sources — Kraken is the tape, Coinbase is the second
  // witness; divergence is shown, never averaged. Paper trades against the
  // live price settle in the SAME receipted ledger as the SIM instruments.
  wrap.append(el('div', 'wolf-label', 'The Live Tape — real public prices · read-only · off by default'));
  const liveBox = el('div', 'wolf-live');
  const liveRow = el('div', 'wolf-den-row');
  const liveBtn = el('button', 'wolf-den-run', `watch ${LIVE_PRODUCT} live`);
  const liveNote = el('span', 'wolf-den-note', `keyless public data (${LIVE_SOURCES.kraken.name.split(' (')[0]} + a second witness) · it can only READ · your paper, their prices`);
  liveRow.append(liveBtn, liveNote);
  liveBox.append(liveRow);
  const liveHost = el('div');
  liveBox.append(liveHost);
  wrap.append(liveBox);

  const live = { on: false, price: null, prev: null, history: [], witness: null, witnessAt: 0, provenance: null, timer: null, ui: null };

  function buildLiveCard() {
    const card = el('div', 'wolf-card wolf-live-card');
    card.style.setProperty('--whue', '247,147,26');
    const top = el('div', 'wolf-card-top');
    const idw = el('div', 'wolf-id');
    idw.append(el('b', null, LIVE_PRODUCT), el('span', null, 'Bitcoin — a real market, watched read-only'));
    const px = el('div', 'wolf-px');
    const pxV = el('b', null, '…');
    const pxD = el('span', 'wolf-delta', '·');
    px.append(pxV, pxD);
    top.append(idw, px);
    const cv = el('canvas', 'wolf-spark');
    const witnessEl = el('div', 'wolf-live-witness', 'calling the second witness…');
    const act = el('div', 'wolf-act');
    const buy = el('button', 'wolf-buy', `Buy $${buyAmt.toLocaleString()}`);
    const sellQ = el('button', 'wolf-sell', 'Sell ½');
    const sellAll = el('button', 'wolf-sell', 'Sell all');
    act.append(buy, sellQ, sellAll);
    const held = el('div', 'wolf-held', '');
    const prov = el('div', 'wolf-live-prov', '');
    card.append(top, cv, witnessEl, act, held, prov);
    liveHost.append(card);

    const liveQuote = () => makeLiveQuote(live.price, live.prev, live.history, live.provenance);
    buy.addEventListener('click', () => {
      if (!live.price) { note('no live price yet — wait for the tape', false); return; }
      const r = ledger.buy(liveQuote(), buyAmt);
      note(r.ok ? `bought ${r.qty.toFixed(6)} ${LIVE_PRODUCT} for ${money(buyAmt)} — real price, paper money` : r.reason, r.ok);
      persist(); render(); renderLive();
    });
    const sellFrac = (f, label) => {
      if (!live.price) { note('no live price yet — wait for the tape', false); return; }
      const r = ledger.sell(liveQuote(), f);
      note(r.ok ? `sold ${label} ${LIVE_PRODUCT} for ${money(r.proceeds)} (${r.realized >= 0 ? '+' : ''}${money(r.realized)} realized) — real price, paper money` : r.reason, r.ok);
      persist(); render(); renderLive();
    };
    sellQ.addEventListener('click', () => sellFrac(0.5, '½ of'));
    sellAll.addEventListener('click', () => sellFrac(1, 'all'));
    live.ui = { pxV, pxD, cv, buy, sellQ, sellAll, held, witnessEl, prov };
  }

  function renderLive() {
    if (!live.on || !live.ui) return;
    const u = live.ui;
    if (live.price) {
      u.pxV.textContent = money(live.price);
      const d = live.prev ? ((live.price - live.prev) / live.prev) * 100 : 0;
      u.pxD.textContent = `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(3)}%`;
      u.pxD.className = 'wolf-delta ' + (d >= 0 ? 'up' : 'down');
      sparkline(u.cv, live.history, '247,147,26');
      u.prov.textContent = `tape: ${live.provenance?.source ?? '…'} · fetched ${live.provenance ? new Date(live.provenance.fetchedAt).toLocaleTimeString() : '…'} · polls every ${Math.round(MIN_POLL_MS / 1000)}s, reads only`;
    }
    if (live.witness) {
      const w = secondWitness(live.price, live.witness);
      if (w.ok) {
        u.witnessEl.textContent = `second witness (Coinbase): ${money(live.witness)} — ${w.line}`;
        u.witnessEl.className = 'wolf-live-witness ' + (w.agree ? 'ok' : 'warn');
      }
    }
    const pos = ledger.positions[LIVE_PRODUCT];
    const has = pos && pos.qty > 0;
    u.held.textContent = has ? `holding ${pos.qty.toFixed(6)} @ ${money(pos.costBasis)} avg — paper only, always` : '';
    u.sellQ.disabled = !has;
    u.sellAll.disabled = !has;
  }

  async function livePoll() {
    const t = await fetchKrakenTicker();
    if (!t.ok) {
      note(`live tape: ${t.reason} — staying honest: no proxy, no retry storm; toggle again to retry`, false);
      stopLive();
      return;
    }
    live.prev = live.price ?? t.price;
    live.price = t.price;
    live.provenance = t.provenance;
    live.history.push(t.price);
    if (live.history.length > 720) live.history.shift();
    if (Date.now() - live.witnessAt > 30000) {
      live.witnessAt = Date.now();
      fetchCoinbaseSpot().then((w) => { if (w.ok) { live.witness = w.price; renderLive(); } });
    }
    renderLive();
    render();
  }

  function stopLive() {
    live.on = false;
    if (live.timer) { clearInterval(live.timer); live.timer = null; }
    liveHost.innerHTML = '';
    live.ui = null;
    liveBtn.textContent = `watch ${LIVE_PRODUCT} live`;
    try { localStorage.setItem(LS_LIVE, 'off'); } catch { /* fine */ }
  }

  async function startLive() {
    live.on = true;
    liveBtn.textContent = 'stop watching';
    try { localStorage.setItem(LS_LIVE, 'on'); } catch { /* fine */ }
    buildLiveCard();
    const h = await fetchKrakenHistory();
    if (h.ok) live.history = h.closes;
    await livePoll();
    if (live.on && !live.timer) live.timer = setInterval(() => { if (!wrap.isConnected) { stopLive(); return; } livePoll(); }, Math.max(MIN_POLL_MS, 6000));
  }

  liveBtn.addEventListener('click', () => { live.on ? stopLive() : startLive(); });
  try { if (localStorage.getItem(LS_LIVE) === 'on') startLive(); } catch { /* default off */ }

  // ---- amount chips + reset ----
  const controls = el('div', 'wolf-controls');
  const chips = el('div', 'wolf-chips');
  chips.append(el('span', 'wolf-chips-label', 'buy size'));
  const chipEls = buyChips.map((amt) => {
    const c = el('button', 'wolf-chip' + (amt === buyAmt ? ' on' : ''), `$${amt.toLocaleString()}`);
    c.addEventListener('click', () => {
      buyAmt = amt;
      chipEls.forEach((e, i) => e.classList.toggle('on', buyChips[i] === amt));
      for (const { buy } of cards.values()) buy.textContent = `Buy $${amt.toLocaleString()}`;
      if (live.ui) live.ui.buy.textContent = `Buy $${amt.toLocaleString()}`;
    });
    chips.append(c);
    return c;
  });
  const noteEl = el('span', 'wolf-note', '');
  const auditBtn = el('button', 'wolf-audit', 'audit the book');
  auditBtn.title = 'Re-derive cash, positions and realized P&L from the receipt stream alone, and prove the book matches. The receipts ARE the book.';
  auditBtn.addEventListener('click', () => {
    const a = ledger.audit();
    if (a.ok) note(`book reconciles — cash, positions and realized P&L re-derived from ${a.checked} receipt${a.checked === 1 ? '' : 's'} ✓`, true);
    else note(`audit: ${a.reason}`, false);
  });
  const reset = el('button', 'wolf-reset', 'reset the wallet');
  let armed = false;
  reset.addEventListener('click', () => {
    if (!armed) { armed = true; reset.textContent = 'really burn it down?'; setTimeout(() => { armed = false; reset.textContent = 'reset the wallet'; }, 2500); return; }
    armed = false; reset.textContent = 'reset the wallet';
    ledger.reset();
    note(`wallet reset — back to ${money(STARTING_CASH)} of paper`, true);
    persist(); render();
  });
  controls.append(chips, noteEl, auditBtn, reset);
  wrap.append(controls);

  function note(msg, ok) {
    noteEl.textContent = msg;
    noteEl.className = 'wolf-note ' + (ok ? 'ok' : 'err');
  }

  // ---- positions: portal cards that telescope open ----
  wrap.append(el('div', 'wolf-label', 'Positions — paper only · tap one to open its story'));
  const posHost = el('div', 'wolf-pos');
  wrap.append(posHost);
  const openPorts = new Set();

  // ---- timeline ----
  wrap.append(el('div', 'wolf-label', 'Activity — every entry carries its price’s provenance'));
  const tlHost = el('div', 'wolf-tl');
  wrap.append(tlHost);

  // ---- THE DEN: the offline research lab — where it keeps evolving ----
  wrap.append(el('div', 'wolf-label', 'The Den — offline research lab · studies, never orders'));
  const den = el('div', 'wolf-den');
  const denRow = el('div', 'wolf-den-row');
  const denBtn = el('button', 'wolf-den-run', 'run a study');
  denBtn.title = 'Backtest simple, readable habits over this seed\u2019s generated tape — trained on the first 70%, judged on the 30% it never saw. Research only; a study can never place or recommend a trade.';
  const denNote = el('span', 'wolf-den-note', 'the wolf studies its own tape: readable rules, walk-forward honesty, receipts throughout');
  denRow.append(denBtn, denNote);
  den.append(denRow);
  const denHost = el('div');
  den.append(denHost);
  wrap.append(den);

  let studies = [];
  try { const raw = localStorage.getItem(LS_STUDIES); if (raw) studies = JSON.parse(raw); } catch { studies = []; }
  const openStudies = new Set();

  function pct(x) { return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`; }

  function equitySpark(canvas, series) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 260, h = canvas.clientHeight || 36;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!series || series.length < 2) return;
    let min = Infinity, max = -Infinity;
    for (const v of series) { if (v < min) min = v; if (v > max) max = v; }
    const span = max - min || 1;
    const up = series[series.length - 1] >= series[0];
    ctx.beginPath();
    for (let i = 0; i < series.length; i++) {
      const x = (i / (series.length - 1)) * w;
      const y = h - 2 - ((series[i] - min) / span) * (h - 4);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = up ? 'rgba(129,212,180,0.9)' : 'rgba(255,154,154,0.8)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  function renderDen() {
    denHost.innerHTML = '';
    if (!studies.length) {
      denHost.append(el('div', 'wolf-empty', 'no studies yet — press the button and the wolf reads its own history'));
      return;
    }
    for (const st of studies) {
      const open = openStudies.has(st.symbol);
      const card = el('div', 'wolf-port wolf-study' + (open ? ' open' : ''));
      const bar = el('button', 'wolf-port-bar');
      const beat = st.test.return - st.buyHoldTest;
      bar.append(
        el('span', 'wolf-chev', '›'),
        el('b', null, st.symbol),
        el('span', 'wolf-port-meta', st.habit),
        el('span', 'wolf-delta ' + (st.test.return >= 0 ? 'up' : 'down'), `test ${pct(st.test.return)}`),
      );
      bar.addEventListener('click', () => {
        openStudies.has(st.symbol) ? openStudies.delete(st.symbol) : openStudies.add(st.symbol);
        renderDen();
      });
      card.append(bar);
      if (open) {
        const body = el('div', 'wolf-port-body');
        const sum = el('div', 'wolf-port-sum');
        sum.append(
          el('span', null, `trained on ticks 0–${st.window.trainTo} (${pct(st.train.return)} there)`),
          el('span', null, `judged on the ${st.window.ticks - st.window.trainTo} ticks it never saw: ${pct(st.test.return)}`),
          el('span', null, `just holding would have made ${pct(st.buyHoldTest)} — the habit ${beat >= 0 ? 'beat' : 'trailed'} it by ${pct(Math.abs(beat)).replace('+', '')}`),
        );
        body.append(sum);
        if (st.test.regimePnl) {
          const rp = st.test.regimePnl;
          const w = el('div', 'wolf-port-sum');
          w.append(el('span', null, `weather report — earned in trends ${money(rp.trending)} · in chop ${money(rp.choppy)} · in storms ${money(rp.storm)}${st.params && st.params.calmOnly ? ' (it learned to shelter through storms)' : ''}`));
          body.append(w);
        }
        if (typeof st.test.grossReturn === 'number') {
          const ate = st.test.grossReturn - st.test.return;
          const cost = el('div', 'wolf-port-sum wolf-costs');
          cost.append(el('span', null, `before costs ${pct(st.test.grossReturn)} · after costs ${pct(st.test.return)} — friction ate ${(ate * 100).toFixed(2)}% (${st.feeBps ?? 10} bps/fill). Most paper apps hide this line; the Wolf leads with it.`));
          body.append(cost);
        }
        const sum2 = el('div', 'wolf-port-sum');
        sum2.append(
          el('span', null, `${st.test.trades} trade${st.test.trades === 1 ? '' : 's'}`),
          el('span', null, `win rate ${(st.test.winRate * 100).toFixed(0)}%`),
          el('span', null, `worst drawdown ${(st.test.maxDrawdown * 100).toFixed(1)}%`),
          el('span', null, `calm ratio ${(st.test.maxDrawdown > 0.0001 ? st.test.return / st.test.maxDrawdown : 0).toFixed(2)} — return per unit of pain`),
          el('span', null, st.test.auditOk ? 'lab book audit ✓' : 'lab book audit FAILED'),
        );
        body.append(sum2);
        const cv = el('canvas', 'wolf-study-spark');
        body.append(cv);
        requestAnimationFrame(() => equitySpark(cv, st.test.equity));
        // the human half: your read, in your words, riding with the habit
        const hRow = el('div', 'wolf-human');
        const hIn = el('input', 'wolf-human-in');
        hIn.placeholder = 'your read on this habit — the human half of the pack note';
        hIn.maxLength = 500;
        hIn.value = humanNotes[st.symbol] || '';
        hIn.addEventListener('change', () => {
          humanNotes[st.symbol] = hIn.value;
          try { localStorage.setItem(LS_HUMAN, JSON.stringify(humanNotes)); } catch { /* full */ }
        });
        const dossierBtn = el('button', 'wolf-pack-copy', 'copy dossier');
        dossierBtn.title = 'Compose the full research brief for this instrument — tape facts, the kept habit, costs, the pack\u2019s verified voices, your read — every sentence receipt-derived. Copies as text.';
        dossierBtn.addEventListener('click', async () => {
          const d = composeDossier(seed, st, { humanNote: hIn.value, packNotes });
          try { await navigator.clipboard.writeText(d.text); note(`dossier composed for ${st.symbol} — every line re-derivable from seed ${seed}`, true); }
          catch { note('clipboard refused — dossier logged to console', false); console.log(d.text); }
        });
        const copyBtn = el('button', 'wolf-pack-copy', 'copy pack note');
        copyBtn.title = 'Seal this study + your note into a pack note another node can verify by re-deriving the whole study. Copying is the export — one note, your call.';
        copyBtn.addEventListener('click', async () => {
          const packNote = buildPackNote(st, { node: nodeName, humanNote: hIn.value });
          try { await navigator.clipboard.writeText(JSON.stringify(packNote, null, 2)); note('pack note copied — carry it to another wolf; they will re-derive every number before believing one', true); }
          catch { note('clipboard refused — select and copy from the console instead', false); }
        });
        hRow.append(hIn, dossierBtn, copyBtn);
        body.append(hRow);
        body.append(el('div', 'wolf-study-disc', st.disclaimer));
        card.append(body);
      }
      denHost.append(card);
    }
  }
  renderDen();

  denBtn.addEventListener('click', () => {
    denBtn.disabled = true;
    denBtn.textContent = 'reading the tape…';
    setTimeout(() => {
      try {
        studies = runStudy(seed);
        try { localStorage.setItem(LS_STUDIES, JSON.stringify(studies.map((st) => ({ ...st, test: { ...st.test, equity: st.test.equity.filter((_, i) => i % 4 === 0) } })))); } catch { /* storage full */ }
        note(`study complete — ${studies.length} instruments read, walk-forward, ${STUDY_DISCLAIMER.split(' — ')[1]}`, true);
      } catch (e) {
        note(`the study stumbled: ${e.message}`, false);
      }
      denBtn.disabled = false;
      denBtn.textContent = 'run a study';
      renderDen();
    }, 30);
  });

  // ---- THE PACK: foreign notes, verified by re-derivation — never by trust ----
  wrap.append(el('div', 'wolf-label', 'The Pack — notes from other wolves · verified by re-running the math, never by trust'));
  const pack = el('div', 'wolf-pack');
  const packRow = el('div', 'wolf-den-row');
  const packIn = el('input', 'wolf-pack-in');
  packIn.placeholder = 'paste a pack note from another node…';
  const packBtn = el('button', 'wolf-den-run', 'verify & keep');
  packRow.append(packIn, packBtn);
  pack.append(packRow);
  const packHost = el('div');
  pack.append(packHost);
  wrap.append(pack);

  let packNotes = [];
  try { const raw = localStorage.getItem(LS_PACK); if (raw) packNotes = JSON.parse(raw); } catch { packNotes = []; }
  const humanNotes = (() => { try { return JSON.parse(localStorage.getItem(LS_HUMAN) || '{}'); } catch { return {}; } })();
  const nodeName = (() => {
    try {
      let n = localStorage.getItem(LS_NODE);
      if (!n) { n = `wolf-${Math.floor(Math.random() * 4096).toString(16)}`; localStorage.setItem(LS_NODE, n); }
      return n;
    } catch { return 'wolf-anon'; }
  })();

  function renderPack() {
    packHost.innerHTML = '';
    if (!packNotes.length) {
      packHost.append(el('div', 'wolf-empty', 'no foreign notes yet — when another wolf sends one, its every number gets re-derived here before it is believed'));
      return;
    }
    for (const n of packNotes.slice(0, 12)) {
      const row = el('div', 'wolf-pack-note');
      const head = el('div', 'wolf-pack-head');
      head.append(
        el('b', null, n.symbol),
        el('span', 'wolf-pack-verified', '✓ re-derived'),
        el('span', 'wolf-port-meta', `${n.habit} — test ${(n.claimed.testReturn * 100).toFixed(2)}% · from ${n.node}`),
      );
      row.append(head);
      if (n.humanNote) row.append(el('div', 'wolf-pack-humans', `their read: “${n.humanNote}”`));
      const myNote = humanNotes[n.symbol];
      if (myNote) row.append(el('div', 'wolf-pack-humans mine', `your read: “${myNote}”`));
      const d = packDisagreement(studies, n);
      if (d) row.append(el('div', 'wolf-pack-dis', `the pack disagrees on ${d.symbol}: you learned “${d.mine.habit}”, ${n.node} learned “${d.theirs.habit}”. Disagreement is information — two tapes, two truths, zero averaging.`));
      packHost.append(row);
    }
  }
  renderPack();

  packBtn.addEventListener('click', () => {
    let parsed;
    try { parsed = JSON.parse(packIn.value); } catch { note('that is not a pack note — paste the whole JSON', false); return; }
    packBtn.disabled = true; packBtn.textContent = 're-deriving…';
    setTimeout(() => {
      const v = verifyPackNote(parsed);
      if (v.ok) {
        packNotes.unshift(parsed);
        if (packNotes.length > 24) packNotes.pop();
        try { localStorage.setItem(LS_PACK, JSON.stringify(packNotes)); } catch { /* full */ }
        note(`pack note verified — every number re-derived on this node ✓ (${parsed.node} told the truth)`, true);
        packIn.value = '';
      } else {
        note(`pack note REFUSED: ${v.reason}`, false);
      }
      packBtn.disabled = false; packBtn.textContent = 'verify & keep';
      renderPack();
    }, 30);
  });

  // ---- THE MIND: a reasoning session, retold from its receipts ----
  // The driver (scripts/wolf-mind-auto.ts) writes JSONL receipts; a human
  // carries them here by paste — the same consent-by-copy transport as pack
  // notes. Two voices, kept separate on purpose: harness numbers are exact
  // accounting; the mind's words are what it THOUGHT, not what was true.
  wrap.append(el('div', 'wolf-label', 'The Mind — a reasoning session, retold from its receipts · paste a run.jsonl from the mind driver'));
  const mindBox = el('div', 'wolf-pack');
  const mindRow = el('div', 'wolf-den-row');
  const mindIn = el('textarea', 'wolf-mind-in');
  mindIn.placeholder = 'paste the whole run.jsonl here — only PAPER + BACKTEST receipts are accepted…';
  mindIn.rows = 3;
  const mindBtn = el('button', 'wolf-den-run', 'read the story');
  mindRow.append(mindIn, mindBtn);
  mindBox.append(mindRow);
  const mindHost = el('div');
  mindBox.append(mindHost);
  wrap.append(mindBox);

  const actionLabel = (a) => {
    const n = Number(String(a).replace(/^ACTION/i, ''));
    const m = WOLF_ACTION_MEANING[n];
    return m ? m.split(' — ')[0].split(':')[0] : String(a);
  };

  function renderStory(story) {
    mindHost.innerHTML = '';
    const card = el('div', 'wolf-mind-story');

    const head = el('div', 'wolf-mind-head');
    head.append(
      el('b', null, story.symbol),
      el('span', `wolf-mind-state ${story.state === 'STOPPED_OUT' ? 'bad' : ''}`, story.state),
      el('span', 'wolf-port-meta', `seed ${story.seed} · ${story.sessionTicks} ticks · ${story.modelTurns} model turns + ${story.planMoves} plan moves`),
    );
    card.append(head);
    card.append(el('div', 'wolf-mind-verdict', storyVerdict(story)));
    card.append(el('div', 'wolf-port-meta', `mind: ${story.mind} · tokens ${story.promptTokens}+${story.completionTokens} · ${story.mode}`));

    const eqCv = el('canvas', 'wolf-mind-eq');
    card.append(eqCv);
    requestAnimationFrame(() => sparkline(eqCv, story.equitySeries.map((p) => p.equity), '212,175,55'));

    const beats = el('div', 'wolf-mind-beats');
    for (const b of story.beats) {
      if (b.kind === 'ride') {
        const broke = b.broken
          ? ` · guard BROKE at ${money(b.broken.close)} (wanted ${b.broken.expect}) — control returned to the mind`
          : ' · all guards held';
        beats.append(el('div', `wolf-mind-ride ${b.broken ? 'broke' : ''}`,
          `rode a plan — ${b.steps} tick${b.steps === 1 ? '' : 's'} on ${b.expects.join(', ')}${broke}`));
        continue;
      }
      if (b.kind === 'reset') { beats.append(el('div', 'wolf-mind-ride broke', `SAME TAPE RESET — retry ${b.resets} (deterministic replay; the stop-out is the teacher)`)); continue; }
      if (b.kind === 'stopped_out') { beats.append(el('div', 'wolf-mind-ride broke', 'STOPPED OUT — the harness ended the session at the loss cap')); continue; }
      const t = el('div', 'wolf-mind-turn');
      const bar = el('button', 'wolf-mind-turn-bar');
      bar.append(
        el('span', 'wolf-chev', '›'),
        el('span', 'wolf-mind-act', actionLabel(b.action)),
        el('span', 'wolf-port-meta', `t${b.tick} · ${money(b.close)} · equity ${money(b.equity)}${b.fill ? ` · ${b.fill.kind} fill, fee ${money(b.fill.fee)}` : ''}`),
      );
      const body = el('div', 'wolf-mind-turn-body');
      const say = (k, v) => { if (v) { const d = el('div', 'wolf-mind-say'); d.append(el('b', null, k), el('span', null, v)); body.append(d); } };
      say('sees', b.whatISee);
      say('hypothesis', b.hypothesis);
      say('acts because', b.reason);
      say('predicts', b.prediction);
      if (b.fill) say('the book says', `${b.fill.kind} ${b.fill.qty.toFixed(4)} at ${money(b.fill.execPx)}, fee ${money(b.fill.fee)}${b.fill.realized != null ? `, realized ${money(b.fill.realized)}` : ''} — harness accounting, exact`);
      let open = false;
      bar.addEventListener('click', () => { open = !open; t.classList.toggle('open', open); });
      t.append(bar, body);
      beats.append(t);
    }
    card.append(beats);
    card.append(el('div', 'wolf-mind-honest', 'Two voices, kept separate: the numbers (fills, equity, guard checks) are harness accounting. The words inside each turn are the mind’s own — receipts show what it thought, not that it was right. Backtest on simulated paper money; results promise nothing.'));
    mindHost.append(card);
  }

  function renderCurve(curve) {
    mindHost.innerHTML = '';
    const card = el('div', 'wolf-mind-story');
    const head = el('div', 'wolf-mind-head');
    head.append(
      el('b', null, curve.symbol),
      el('span', 'wolf-mind-state', 'LEARNING CURVE'),
      el('span', 'wolf-port-meta', `${curve.sessions.length} session(s), oldest first — from this instrument's episodic memory`),
    );
    card.append(head);
    const beats = el('div', 'wolf-mind-beats');
    curve.sessions.forEach((s, i) => {
      const row = el('div', 'wolf-mind-turn open');
      const bar = el('div', 'wolf-mind-turn-bar');
      bar.append(
        el('span', 'wolf-mind-act', `#${i + 1}`),
        el('span', 'wolf-port-meta', `${s.at.slice(0, 10)} · seed ${s.seed} · ${s.ticks} ticks · ${s.state} · P&L ${s.pnlPct >= 0 ? '+' : ''}${s.pnlPct.toFixed(2)}% · dd ${s.maxDrawdownPct.toFixed(2)}% · ${s.trades} trades`),
      );
      if (s.sameTape) bar.append(el('span', 'wolf-mind-sametape', 'SAME TAPE — memorization, not generalization'));
      const body = el('div', 'wolf-mind-turn-body');
      const d = el('div', 'wolf-mind-say');
      d.append(el('b', null, 'lesson carried'), el('span', null, s.memo));
      body.append(d);
      row.append(bar, body);
      beats.append(row);
    });
    card.append(beats);
    card.append(el('div', 'wolf-mind-honest', 'Session-over-session numbers from the mind’s own episodic memory. A repeated seed replays a tape the mind has already lived — improvement there proves memory works, not that a strategy works. Only fresh tapes test generalization. Backtest on simulated paper money; results promise nothing.'));
    mindHost.append(card);
  }

  mindBtn.addEventListener('click', () => {
    const text = mindIn.value;
    // one paste box, two documents: an episodic memory file is a single JSON
    // object with .entries; run receipts are JSONL. Try the file shape first.
    const c = parseEpisodicMemory(text);
    if (c.ok) {
      renderCurve(c.curve);
      note(`learning curve read — ${c.curve.sessions.length} session(s) from episodic memory ✓ (nothing stored)`, true);
      mindIn.value = '';
      return;
    }
    const r = parseMindReceipts(text);
    if (!r.ok) { note(`story refused: ${r.reason}`, false); return; }
    renderStory(r.story);
    note(`story read — ${r.story.modelTurns} turns retold from receipts ✓ (nothing stored; the receipts stay wherever you keep them)`, true);
    mindIn.value = '';
  });

  // ---- the portal stack: the honest tour, the finance case, the road ahead ----
  const para = (h, t) => { const d = el('div', 'wolf-about-block'); d.append(el('b', null, h), el('span', null, t)); return d; };
  const fold = (title, blocks) => {
    const box = el('div', 'wolf-about');
    const bar = el('button', 'wolf-about-bar');
    bar.append(el('span', 'wolf-chev', '›'), el('span', null, title));
    const body = el('div', 'wolf-about-body');
    for (const b of blocks) body.append(b);
    let open = false;
    bar.addEventListener('click', () => { open = !open; box.classList.toggle('open', open); });
    box.append(bar, body);
    wrap.append(box);
  };

  fold('How the Wolf works — and how to join the pack', [
    para('This is a test, and proud of it.', 'Every dollar here is paper. The five instruments are fictional Aukora lore — RUT, LUM, KNV, GRT, PLS — not real assets. The optional Live Tape watches one real market (BTC-USD) through public, keyless, read-only data — it can see prices, and it can do nothing else. Nothing you do here touches a broker, a wallet, or an order book. This screen is a demo and a research surface for how a sovereign node can watch, decide, and keep receipts.'),
    para('Where the prices come from.', 'A deterministic random walk, seeded on this node, computed locally — pure arithmetic. Every price carries its provenance (source, seed, tick, timestamp), and every fill on your timeline repeats it. A price without a receipt is a rumor; the Wolf does not deal in rumors, even fake ones.'),
    para('What it will never do.', 'No real money. No brokerage keys or secrets — never send any. No buy/sell advice. No automated orders. The live public data that exists today is exactly what was promised: read-only, named, timestamped on both clocks, off by default, and checked against a second independent source. The learning that exists today is offline backtesting and receipted research sessions you can inspect line by line — labeled signals, never recommendations.'),
    para('Join the pack.', 'This is open — the lane lives in the aukora-symbiote repo under issue #270 (branch fable/paper-trading-lab, log docs/mesh/handoff/TRADING.md). Ideas, instruments, chart styles, backtest benches: bring them. The fence stays; everything else is play.'),
  ]);

  fold('For the finance people — the controls, mapped', [
    para('The receipts ARE the book.', 'Press “audit the book” and the app re-derives cash, positions and realized P&L from the receipt stream alone, then proves the running book matches — push-button reconciliation, no overnight batch, no trusting the screen. In your world this is the audit trail and the reconstruction, except it is not a policy: it is the data structure.'),
    para('Market-data lineage, native.', 'Every price is stamped with its source, seed, tick and timestamp, and every fill repeats the stamp verbatim. That is best-execution evidence and CAT-style lifecycle reconstruction as a property of the type, not a compliance project bolted on afterward.'),
    para('Deterministic reconstruction.', 'Same seed, same market, bit for bit — a dispute here ends with a replay, not a meeting. The audit trail regulators dream of reconstructing is simply how this thing runs.'),
    para('Segregation of duties — enforced by CI.', 'The pricing and book engines import nothing and cannot reach a network; a test FAILS if anyone ever adds a way. Your auditors read control policies; here the control is code they can run.'),
    para('The human line.', 'In the wider Aukora node, every change travels propose → owner signs → apply — maker-checker with cryptographic receipts, and nothing self-applies. The Wolf inherits that culture: it will never place, route or recommend anything. Evidence never authorizes.'),
  ]);

  fold('Just the beginning — where the Wolf runs with Aukora', [
    para('Today.', 'A paper world with perfect receipts: deterministic market, provenanced fills, push-button audit, everything local to this node. It is small on purpose — the shape is the point.'),
    para('Next.', 'Optional live public prices — keyless, read-only, named and timestamped, off by default. Then an offline backtest bench over recorded runs, and clearly-labeled research signals you can inspect line by line. Signals study; they never order and never advise.'),
    para('Then the pack.', 'Many sovereign Aukora nodes, each running its own Wolf on its own receipts, comparing books in the open — a swarm that learns together without any node surrendering its data or its authority. Receipted competition instead of black-box confidence.'),
    para('Why Aukora makes this different.', 'Your node, your data — nothing exports without the owner. Receipts on every claim, provenance on every price, a hard human line no automation crosses, and an app registry that let this whole thing land without touching the shell. The Wolf is a demo of a discipline, and the discipline is the product.'),
  ]);

  // ---- provenance footer ----
  wrap.append(el('div', 'wolf-prov', `every price: ${SIM_SOURCE} · seed ${seed} · this node only — nothing exports`));

  function persist() {
    try { localStorage.setItem(LS_LEDGER, JSON.stringify(ledger.toJSON())); } catch { /* storage full — paper survives in memory */ }
  }

  function render() {
    const quotes = market.quotes();
    const priceBy = Object.fromEntries(quotes.map((q) => [q.symbol, q.price]));
    if (live.price) priceBy[LIVE_PRODUCT] = live.price; // live mark, when we have one
    vCash.textContent = money(ledger.cash);
    vEquity.textContent = money(ledger.equity(priceBy));
    const un = ledger.unrealizedPnl(priceBy);
    vUnreal.textContent = money(un);
    vUnreal.className = un >= 0 ? 'up' : 'down';
    vReal.textContent = money(ledger.realizedPnl);
    vReal.className = ledger.realizedPnl >= 0 ? 'up' : 'down';

    for (const q of quotes) {
      const c = cards.get(q.symbol);
      if (!c) continue;
      c.pxV.textContent = money(q.price);
      const d = q.prev ? ((q.price - q.prev) / q.prev) * 100 : 0;
      c.pxD.textContent = `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}%`;
      c.pxD.className = 'wolf-delta ' + (d >= 0 ? 'up' : 'down');
      sparkline(c.cv, q.history, q.hue);
      const pos = ledger.positions[q.symbol];
      const has = pos && pos.qty > 0;
      c.held.textContent = has ? `holding ${pos.qty.toFixed(4)} @ ${money(pos.costBasis)} avg` : '';
      c.sellQ.disabled = !has;
      c.sellAll.disabled = !has;
    }

    posHost.innerHTML = '';
    const entries = Object.entries(ledger.positions);
    if (!entries.length) posHost.append(el('div', 'wolf-empty', 'nothing held — the paper is burning a hole in your pocket'));
    for (const [sym, p] of entries) {
      const px = priceBy[sym] ?? p.costBasis;
      const u = p.qty * (px - p.costBasis);
      const open = openPorts.has(sym);
      const port = el('div', 'wolf-port' + (open ? ' open' : ''));
      const bar = el('button', 'wolf-port-bar');
      bar.append(
        el('span', 'wolf-chev', '›'),
        el('b', null, sym),
        el('span', 'wolf-port-meta', `${p.qty.toFixed(4)} units · avg ${money(p.costBasis)}`),
        el('span', 'wolf-port-val', money(p.qty * px)),
        el('span', 'wolf-delta ' + (u >= 0 ? 'up' : 'down'), `${u >= 0 ? '+' : ''}${money(u)}`),
      );
      bar.addEventListener('click', () => {
        openPorts.has(sym) ? openPorts.delete(sym) : openPorts.add(sym);
        render();
      });
      port.append(bar);
      if (open) {
        const body = el('div', 'wolf-port-body');
        const fills = ledger.timeline.filter((t) => t.symbol === sym);
        const realized = fills.filter((t) => t.kind === 'sell').reduce((a, t) => a + (t.realized || 0), 0);
        const bought = fills.filter((t) => t.kind === 'buy').reduce((a, t) => a + t.dollars, 0);
        const sum = el('div', 'wolf-port-sum');
        sum.append(
          el('span', null, `paper in: ${money(bought)}`),
          el('span', null, `mark now: ${money(px)}`),
          el('span', 'wolf-delta ' + (realized >= 0 ? 'up' : 'down'), `realized here: ${realized >= 0 ? '+' : ''}${money(realized)}`),
        );
        body.append(sum);
        for (const f of fills.slice(0, 12)) {
          const fr = el('div', 'wolf-port-fill kind-' + f.kind);
          fr.append(
            el('span', 'wolf-tl-when', new Date(f.at).toLocaleTimeString()),
            el('span', null, f.kind === 'buy'
              ? `bought ${f.qty.toFixed(4)} @ ${money(f.price)}`
              : `sold ${f.qty.toFixed(4)} @ ${money(f.price)} (${(f.realized || 0) >= 0 ? '+' : ''}${money(f.realized || 0)})`),
            el('span', 'wolf-tl-prov', f.provenance ? (f.provenance.tick != null ? `SIM t#${f.provenance.tick}` : `LIVE · ${(f.provenance.source || '').split(' ')[0]}`) : ''),
          );
          body.append(fr);
        }
        port.append(body);
      }
      posHost.append(port);
    }

    tlHost.innerHTML = '';
    for (const t of ledger.timeline.slice(0, 30)) {
      const row = el('div', 'wolf-tl-row kind-' + t.kind);
      const when = new Date(t.at).toLocaleTimeString();
      let text;
      if (t.kind === 'buy') text = `bought ${t.qty.toFixed(4)} ${t.symbol} @ ${money(t.price)} (${money(t.dollars)}${t.fee ? ` · fee ${money(t.fee)}` : ''})`;
      else if (t.kind === 'sell') text = `sold ${t.qty.toFixed(4)} ${t.symbol} @ ${money(t.price)} → ${money(t.dollars)}${t.fee ? ` after ${money(t.fee)} fee` : ''} (${t.realized >= 0 ? '+' : ''}${money(t.realized)} realized)`;
      else text = t.note;
      row.append(el('span', 'wolf-tl-when', when), el('span', 'wolf-tl-text', text));
      if (t.provenance) row.append(el('span', 'wolf-tl-prov', t.provenance.tick != null ? `${t.provenance.source.split(' ·')[0]} t#${t.provenance.tick}` : `LIVE · ${(t.provenance.source || '').split(' ')[0]} ${t.provenance.fetchedAt ? new Date(t.provenance.fetchedAt).toLocaleTimeString() : ''}`));
      tlHost.append(row);
    }
  }

  render();
  const timer = setInterval(() => {
    if (!wrap.isConnected) { clearInterval(timer); return; }
    market.step();
    render();
  }, 1000);

  return { unmount() { clearInterval(timer); totem.destroy(); } };
}
