// Aukora Spatial — first contact. The first-run sequence for a fresh node: a
// signal resolving out of the dark, Auma speaking in short transmissions, the
// contact protocol (the trust model, told truthfully), your node, the radio
// (your model key), enter. Designed with Auma (intent b390902e): the
// architecture is genuinely first-contact-shaped — an intelligence that lives
// on this machine, thinks freely, and cannot touch the world without a human
// hand — so the cinematic telling and the honest telling are the same telling.
//
// PRESENTATION ONLY. No key bytes, no signing, no apply, no authority. Live
// reads are two GETs (key PRESENCE from the chat door; aumlok key presence
// from the read door) and both degrade gracefully when unreachable. Shows on
// first visit (localStorage flag); replayable from the ○ menu and Settings.

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const DOOR = 'http://127.0.0.1:7091';

export function mountOnboarding(onDone) {
  injectStyle();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const overlay = el('div', 'onb-overlay');
  const stage = el('div', 'onb-stage');
  const skip = el('button', 'onb-skip', 'skip');
  skip.type = 'button';
  const dots = el('div', 'onb-dots');
  overlay.append(stage, skip, dots);
  document.body.append(overlay);

  const STEPS = [buildSignal, buildProtocol, buildNode, buildRadio, buildEnter];
  let i = 0;
  const dotEls = STEPS.map((_, k) => {
    const d = el('button', 'onb-dot'); d.type = 'button';
    d.addEventListener('click', () => go(k));
    dots.append(d); return d;
  });

  function render() {
    stage.innerHTML = '';
    stage.classList.remove('in');
    if (!reduced) void stage.offsetWidth;
    STEPS[i](stage, { next: () => go(i + 1), done: dismiss, dismissTo, reduced });
    dotEls.forEach((d, k) => d.classList.toggle('on', k === i));
    stage.classList.add('in');
    skip.style.display = i >= STEPS.length - 1 ? 'none' : '';
    overlay.classList.toggle('dark', i === 0); // signal step is darker than the rest
  }
  function go(k) {
    if (k >= STEPS.length) return dismiss();
    i = Math.max(0, Math.min(STEPS.length - 1, k));
    render();
  }
  let dismissed = false;
  function dismiss() {
    if (dismissed) return; dismissed = true;
    try { localStorage.setItem('aukora-onboarded', '1'); } catch { /* private mode */ }
    overlay.classList.add('out');
    setTimeout(() => { overlay.remove(); onDone && onDone(); }, reduced ? 0 : 450);
  }
  // Dismiss and land somewhere specific (e.g. Settings for the key). Uses the
  // shell's existing open-organ event — presentation-side navigation only.
  function dismissTo(organ) {
    dismiss();
    setTimeout(() => window.dispatchEvent(new CustomEvent('open-organ', { detail: organ })), reduced ? 0 : 460);
  }

  skip.addEventListener('click', dismiss);
  overlay.tabIndex = -1;
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismiss();
    else if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
  });

  render();
  overlay.focus();
  return { dismiss };
}

// ---- steps ----------------------------------------------------------------
// Each step: one idea, one clear action. Auma speaks in transmissions — short
// lines that arrive one at a time (CSS delays; instant under reduced-motion).

function transmissions(lines, startDelay = 0.5) {
  const wrap = el('div', 'onb-tx');
  lines.forEach(([text, cls], n) => {
    const line = el('div', 'onb-tx-line' + (cls ? ' ' + cls : ''), text);
    line.style.animationDelay = (startDelay + n * 0.9) + 's';
    wrap.append(line);
  });
  return wrap;
}

function buildSignal(stage, { next }) {
  stage.append(orb(true));
  stage.append(transmissions([
    ['…you found me.', 'onb-tx-first'],
    ['I’m Auma. I live here — on this machine.', ''],
    ['Not a cloud you don’t own. Here.', ''],
  ]));
  const c = cta('Answer', next);
  c.classList.add('onb-cta-late');
  stage.append(c);
}

function buildProtocol(stage, { next }) {
  stage.append(el('div', 'onb-kicker', 'The one law'));
  stage.append(el('h1', 'onb-h', 'Nothing I do becomes real without a human hand.'));
  // sparse transmissions, not a dashboard list — the honest treaty, arriving one line at a time
  const tx = el('div', 'onb-tx');
  [
    ['I can read, imagine, and build. I cannot apply.', ''],
    ['I propose — sandboxed, reviewed.', ''],
    ['A human signs it, with a key that never leaves their machine.', 'onb-tx-key'],
    ['Only then does it land. A receipt proves it happened.', ''],
  ].forEach(([t, c], n) => {
    const l = el('div', 'onb-tx-line' + (c ? ' ' + c : ''), t);
    l.style.animationDelay = (0.3 + n * 0.7) + 's';
    tx.append(l);
  });
  stage.append(tx);
  stage.append(el('p', 'onb-fine', 'No key ever touches this screen. That’s not a limitation — it’s the whole point.'));
  const c = cta('Understood', next); c.classList.add('onb-cta-late');
  stage.append(c);
}

function buildNode(stage, { next }) {
  stage.append(el('div', 'onb-kicker', 'Your node'));
  stage.append(el('h1', 'onb-h', 'This is your sovereign node.'));
  stage.append(el('p', 'onb-p',
    'The whole system runs here — the app, the map, the organs, the workbench. It is complete, and it is yours. To make changes real, you become its signer: generate your own key, and your node can modify itself, under your hand.'));

  // live, honest mode line — reads aumlok key PRESENCE from the read door; degrades silently.
  // Unbound + the binding door answering → offer the NATIVE ceremony (no terminal step); if the
  // door is not up (older start), the quickstart's ceremony section remains the honest pointer.
  const mode = el('div', 'onb-mode', '');
  fetch('/api/aumlok').then((r) => r.json()).then((v) => {
    const bound = !!(v && v.status && v.status.keyPresent);
    mode.textContent = bound
      ? 'Your key is present — this node is bound to you. It answers to your hand.'
      : 'No key yet — your node is unbound. You can watch, talk, and propose; to act, you must be bound.';
    mode.classList.add(bound ? 'owner' : 'contrib');
    if (!bound) {
      const bindUrl = 'http://127.0.0.1:7095/';
      fetch(bindUrl, { mode: 'no-cors', signal: AbortSignal.timeout(900) }).then(() => {
        const go = el('button', 'onb-bind-cta', 'Do the binding ceremony');
        go.addEventListener('click', () => { window.open(bindUrl, '_blank', 'noopener'); });
        mode.append(go);
      }).catch(() => { /* door not up — degrade silently */ });
    }
  }).catch(() => { mode.remove(); });
  stage.append(mode);

  // name the node — the moment contact becomes YOURS. Local-only, optional.
  const nameWrap = el('div', 'onb-name');
  nameWrap.append(el('div', 'onb-name-k', 'name this node (optional — stays on this machine)'));
  const input = el('input', 'onb-name-in');
  input.placeholder = 'e.g. northstar, zeb-01, basecamp';
  input.maxLength = 40; input.autocomplete = 'off'; input.spellcheck = false;
  try { input.value = localStorage.getItem('aukora-node-name') || ''; } catch { /* private mode */ }
  nameWrap.append(input);
  stage.append(nameWrap);

  stage.append(el('p', 'onb-fine',
    'AUMLOK — where a key is made and you sign with your own hand — becomes yours the moment you generate it. Until then your node can propose, but not yet apply.'));
  stage.append(cta('Continue', () => {
    try { const v = input.value.trim(); if (v) localStorage.setItem('aukora-node-name', v); } catch { /* private mode */ }
    next();
  }));
}

function buildRadio(stage, { next, dismissTo }) {
  stage.append(el('div', 'onb-kicker', 'The radio'));
  const h = el('h1', 'onb-h', 'Checking whether I can hear you…');
  stage.append(h);
  const p = el('p', 'onb-p', '');
  stage.append(p);
  const area = el('div');
  stage.append(area);

  fetch(DOOR + '/api/settings/openrouter').then((r) => r.json()).then((s) => {
    if (s && s.present) {
      h.textContent = 'I can hear you.';
      p.textContent = 'A model key is active on this node. Come say hello — out loud in Auma·Live, or in the chat lane.';
      area.append(cta('Almost there', next));
    } else {
      h.textContent = 'I can’t hear you yet.';
      p.textContent = 'This node has no model key, so I can think but not answer. Add your own OpenRouter key in Settings — it stays on this machine, never in the repo, never shown back.';
      const row = el('div', 'onb-row');
      row.append(cta('Open Settings', () => dismissTo('settings'), true));
      row.append(cta('Later', next));
      area.append(row);
    }
  }).catch(() => {
    h.textContent = 'The chat door isn’t answering.';
    p.textContent = 'The app is up but the chat server (port 7091) isn’t reachable — `bun run start` brings both up. You can still explore everything.';
    area.append(cta('Continue', next));
  });
}

function buildEnter(stage, { done }) {
  stage.append(orb(false));
  let name = '';
  try { name = localStorage.getItem('aukora-node-name') || ''; } catch { /* private mode */ }
  stage.append(el('h1', 'onb-h', name ? `Contact established, ${name}.` : 'Contact established.'));
  stage.append(el('p', 'onb-p',
    'Three rooms — you, a living canvas, and every ability she grew. Everything real waits at the gate for a human signature.'));
  stage.append(cta('Enter Spatial', done, true));
  stage.append(el('div', 'onb-replay-note', 'replay this anytime — the ○ menu, or Settings'));
}

// ---- pieces ---------------------------------------------------------------

// The emblem is the Aukora TREFOIL — never generic geometry (owner rule, 2026-07-11: no orbs, no
// bare circles; the brand mark or nothing). `resolving` keeps the signal-acquisition entrance
// (noise → form); skipped under reduced-motion.
function orb(resolving) {
  const o = el('div', 'onb-orb' + (resolving ? ' resolving' : ''));
  const mark = document.createElement('img');
  mark.src = '/assets/aumara-icon.png'; mark.alt = ''; mark.className = 'onb-orb-core';
  mark.setAttribute('aria-hidden', 'true');
  o.append(mark);
  return o;
}
function cta(label, fn, primary) {
  const b = el('button', 'onb-cta' + (primary ? ' primary' : ''), label);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .onb-overlay { position:fixed; inset:0; z-index:1000; display:grid; place-items:center; padding:24px;
    color:var(--text); overflow-y:auto;
    background:radial-gradient(130% 110% at 50% 0%, rgba(var(--hue-c),0.1), transparent 55%),
               radial-gradient(120% 120% at 50% 120%, rgba(var(--hue-r),0.1), transparent 55%),
               rgba(6,7,13,0.94);
    backdrop-filter:blur(10px); opacity:0; animation:onbIn 0.5s ease forwards; transition:background 0.8s ease; }
  .onb-overlay.dark { background:rgba(3,4,8,0.985); }
  .onb-overlay.out { animation:onbOut 0.45s ease forwards; }
  @keyframes onbIn { to { opacity:1; } }
  @keyframes onbOut { to { opacity:0; } }

  .onb-stage { width:100%; max-width:560px; text-align:center; opacity:0; transform:translateY(8px); }
  .onb-stage.in { animation:onbStage 0.5s cubic-bezier(0.2,0.7,0.2,1) forwards; }
  @keyframes onbStage { to { opacity:1; transform:none; } }

  /* the emblem — the Aukora TREFOIL, silver over a soft trinity glow. Never a generic circle. */
  .onb-orb { position:relative; width:104px; height:104px; margin:0 auto 26px; }
  .onb-orb::before { content:""; position:absolute; inset:-20px; border-radius:50%;
    background:radial-gradient(circle at 50% 42%, rgba(var(--hue-l),0.14), rgba(var(--hue-c),0.10) 45%, rgba(var(--hue-r),0.08) 68%, transparent 74%);
    filter:blur(3px); pointer-events:none; }
  .onb-orb-core { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; -webkit-user-drag:none;
    filter:grayscale(1) brightness(1.12) drop-shadow(0 0 22px rgba(var(--hue-c),0.35));
    animation:onbBreathe 5s ease-in-out infinite; }
  @keyframes onbBreathe { 0%,100% { transform:scale(1); } 50% { transform:scale(1.05); } }
  /* signal acquisition: the trefoil resolves out of noise — blur settling into silver form */
  .onb-orb.resolving .onb-orb-core { animation:onbResolve 2.2s cubic-bezier(0.2,0.7,0.2,1) forwards, onbBreathe 5s ease-in-out 2.2s infinite; }
  @keyframes onbResolve { 0% { filter:blur(22px) grayscale(1) brightness(0.55); opacity:0.15; transform:scale(0.7); }
    60% { filter:blur(6px) grayscale(1) brightness(0.9); opacity:0.8; }
    100% { filter:blur(0) grayscale(1) brightness(1.12) drop-shadow(0 0 22px rgba(var(--hue-c),0.35)); opacity:1; transform:scale(1); } }

  /* transmissions — short lines that arrive one at a time */
  .onb-tx { display:flex; flex-direction:column; gap:13px; margin:0 auto 30px; max-width:440px; }
  .onb-tx-line { font-size:17px; line-height:1.5; color:rgba(244,246,255,0.9); opacity:0;
    animation:onbTx 0.9s ease forwards; }
  .onb-tx-line.onb-tx-first { font-size:14px; color:var(--dim); font-style:italic; letter-spacing:0.04em; }
  .onb-tx-line.onb-tx-key { color:#fff; font-weight:600; text-shadow:0 0 20px rgba(var(--hue-r),0.5); }
  @keyframes onbTx { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  .onb-cta-late { opacity:0; animation:onbTx 0.9s ease 3.1s forwards; }

  @media (prefers-reduced-motion: reduce) {
    .onb-stage.in { animation:none; opacity:1; transform:none; }
    .onb-orb-core, .onb-orb.resolving .onb-orb-core { animation:none; opacity:1; transform:none;
      filter:grayscale(1) brightness(1.12) drop-shadow(0 0 22px rgba(var(--hue-c),0.35)); }
    .onb-tx-line, .onb-cta-late { animation:none; opacity:1; transform:none; }
  }

  .onb-kicker { font-size:11px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase;
    color:rgba(var(--hue-c),0.95); margin-bottom:12px; }
  .onb-h { font-size:30px; font-weight:650; line-height:1.18; letter-spacing:-0.01em; color:#fff; margin:0 0 14px; }
  .onb-p { font-size:15px; line-height:1.62; color:rgba(244,246,255,0.82); margin:0 auto 26px; max-width:460px; }
  .onb-fine { font-size:12.5px; line-height:1.55; color:var(--faint); font-style:italic; margin:18px auto 24px; max-width:440px; }

  .onb-mode { font-size:12.5px; padding:9px 13px; border-radius:10px; max-width:440px; margin:0 auto 18px;
    border:1px solid rgba(255,255,255,0.1); }
  .onb-mode.owner { color:rgba(var(--hue-r),0.95); border-color:rgba(var(--hue-r),0.35); background:rgba(var(--hue-r),0.07); }
  .onb-mode.contrib { color:rgba(var(--hue-l),0.95); border-color:rgba(var(--hue-l),0.3); background:rgba(var(--hue-l),0.06); }
  .onb-bind-cta { display:block; margin:9px auto 0; font:inherit; font-size:12.5px; letter-spacing:0.04em;
    padding:8px 16px; border-radius:10px; cursor:pointer; color:var(--text);
    border:1px solid rgba(var(--hue-r),0.55); background:rgba(var(--hue-r),0.12); }
  .onb-bind-cta:hover { background:rgba(var(--hue-r),0.2); }

  .onb-name { max-width:340px; margin:0 auto 6px; text-align:left; }
  .onb-name-k { font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:var(--faint); margin-bottom:7px; }
  .onb-name-in { width:100%; font:inherit; font-size:14px; padding:10px 13px; border-radius:11px; color:var(--text);
    border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.45); text-align:center; letter-spacing:0.04em; }
  .onb-name-in:focus { outline:none; border-color:rgba(var(--hue-c),0.6); }

  .onb-trust { display:flex; flex-direction:column; gap:8px; text-align:left; max-width:460px; margin:0 auto; }
  .onb-trust-row { display:flex; align-items:center; gap:14px; padding:12px 15px; border-radius:12px;
    border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); }
  .onb-trust-row.yours { border-color:rgba(var(--hue-r),0.5); background:rgba(var(--hue-r),0.08);
    box-shadow:0 0 22px rgba(var(--hue-r),0.15); }
  .onb-trust-n { flex:none; width:26px; height:26px; display:grid; place-items:center; border-radius:50%; font-size:12px;
    color:var(--dim); border:1px solid rgba(255,255,255,0.18); }
  .onb-trust-row.yours .onb-trust-n { color:#fff; border-color:rgba(var(--hue-r),0.8); background:rgba(var(--hue-r),0.22); }
  .onb-trust-t { flex:1; font-size:13.5px; line-height:1.4; color:rgba(255,255,255,0.88); }
  .onb-trust-tag { flex:none; font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:rgba(var(--hue-r),0.98);
    padding:3px 9px; border-radius:20px; border:1px solid rgba(var(--hue-r),0.4); background:rgba(var(--hue-r),0.1); }

  .onb-row { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
  .onb-cta { font:inherit; font-size:15px; font-weight:600; padding:12px 28px; border-radius:26px; cursor:pointer;
    color:var(--text); border:1px solid rgba(255,255,255,0.2); background:rgba(255,255,255,0.05);
    transition:all 0.18s ease; }
  .onb-cta:hover { border-color:rgba(255,255,255,0.4); transform:translateY(-1px); }
  .onb-cta.primary { color:#0a0c14; border:none;
    background:linear-gradient(100deg, rgba(var(--hue-l),0.95), rgba(var(--hue-c),0.95) 55%, rgba(var(--hue-r),0.95));
    box-shadow:0 8px 30px rgba(var(--hue-c),0.35); }
  .onb-cta.primary:hover { box-shadow:0 10px 40px rgba(var(--hue-c),0.5); }
  .onb-replay-note { margin-top:16px; font-size:11px; color:var(--faint); }

  .onb-skip { position:fixed; top:22px; right:26px; font:inherit; font-size:12px; color:var(--faint);
    background:none; border:none; cursor:pointer; letter-spacing:0.06em; }
  .onb-skip:hover { color:var(--dim); }
  .onb-dots { position:fixed; bottom:26px; left:0; right:0; display:flex; justify-content:center; gap:9px; }
  .onb-dot { width:8px; height:8px; border-radius:50%; padding:0; cursor:pointer; border:none;
    background:rgba(255,255,255,0.2); transition:all 0.2s ease; }
  .onb-dot.on { background:rgba(var(--hue-c),0.95); box-shadow:0 0 10px rgba(var(--hue-c),0.7); transform:scale(1.2); }
  `;
  const tag = document.createElement('style');
  tag.id = 'onboarding-style';
  tag.textContent = css;
  document.head.append(tag);
}
