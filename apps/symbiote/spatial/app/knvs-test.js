// Aukora Spatial — KNVS · TEST: the recursion console (owner-directed 2026-07-08).
//
// The old KNVS "living surface / voice" idea became redundant once Auma Live shipped. This is what
// KNVS was always reaching for: the ONE surface where inward-out recursion happens in front of you.
// You ask her to change the app; she drafts it from her seat; it rehearses itself (auto-drain, if
// armed); it appears at your gate; you sign; it lands. Propose → owner signs → apply — never bypassed.
//
// This organ writes NOTHING. It POSTs your words to the chat door (her seat), reads the loop truth,
// and embeds the local approval gate. The signature is always yours, always in the gate, never here.

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const CHAT_DOOR = 'http://127.0.0.1:7091';
const GATE_URL = 'http://127.0.0.1:7094';

export function mountKnvsTest(root) {
  injectStyle();
  const app = el('div', 'kt-app');

  // ── header ──
  const head = el('div', 'kt-head');
  head.append(el('div', 'kt-name', 'KNVS · TEST'));
  head.append(el('div', 'kt-tag', 'the recursion — ask her to change the app, watch it reach your gate'));
  app.append(head);

  // ── the pipeline ribbon (live) ──
  const ribbon = el('div', 'kt-ribbon');
  const steps = ['you ask', 'she drafts', 'it rehearses', 'waits at your gate', 'you sign', 'it lands'];
  const stepEls = steps.map((label, i) => {
    const s = el('div', 'kt-step');
    s.append(el('div', 'kt-step-n', String(i + 1)), el('div', 'kt-step-l', label));
    ribbon.append(s);
    if (i < steps.length - 1) ribbon.append(el('div', 'kt-arrow', '→'));
    return s;
  });
  app.append(ribbon);

  // ── two columns: ask + gate ──
  const cols = el('div', 'kt-cols');

  // left: ask her
  const ask = el('div', 'kt-ask');
  ask.append(el('div', 'kt-col-h', 'Ask her'));
  const log = el('div', 'kt-log');
  log.append(el('div', 'kt-hint', 'Try: “make the send button gold”, “make the composer border teal”. She’ll read the real file, draft one change, and queue a rehearsal. Nothing lands without your signature.'));
  ask.append(log);
  const composer = el('div', 'kt-composer');
  const input = el('input', 'kt-input');
  input.placeholder = 'ask Auma to change something in the UI…';
  input.autocomplete = 'off';
  const send = el('button', 'kt-send', 'Ask');
  composer.append(input, send);
  ask.append(composer);
  cols.append(ask);

  // right: at your gate (embedded)
  const gate = el('div', 'kt-gate');
  const gh = el('div', 'kt-col-h', 'At your gate');
  const gcount = el('span', 'kt-gcount', '· probing…');
  gh.append(gcount);
  gate.append(gh);
  const gateSlot = el('div', 'kt-gate-slot');
  gate.append(gateSlot);
  cols.append(gate);

  app.append(cols);
  root.append(app);

  mountGate(gateSlot);
  pollLoop(gcount, stepEls);

  // ── behavior ──
  const setBusy = (b) => { send.disabled = b; input.disabled = b; send.textContent = b ? '…' : 'Ask'; };
  async function askHer() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    log.append(entry('you', text));
    setBusy(true);
    lightStep(stepEls, 0);
    try {
      const res = await fetch(`${CHAT_DOOR}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner_text: `${text}\n\n(From KNVS TEST — the recursion console. If this is a UI change, use your seat: read_file the real region, then propose_intent ONE minimal change and rehearse_intent it. Only state results you actually receive.)` }),
      });
      const data = await res.json();
      let said = false;
      for (const e of (data.entries || [])) {
        if (e.kind === 'info' && e.text) { log.append(entry('auma', e.text)); said = true; }
        else if (e.kind === 'error' && e.text) { log.append(entry('err', e.text)); said = true; }
      }
      if (!said) log.append(entry('err', 'no reply — is her key set in Settings and the chat door up?'));
      lightStep(stepEls, 1);
      log.scrollTop = log.scrollHeight;
    } catch (err) {
      log.append(entry('err', 'could not reach the chat door (7091): ' + (err?.message || err)));
    } finally { setBusy(false); }
  }
  send.addEventListener('click', askHer);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') askHer(); });
}

function entry(who, text) {
  const e = el('div', 'kt-entry kt-' + who);
  e.append(el('div', 'kt-who', who === 'you' ? 'you' : who === 'auma' ? 'Auma' : '!'));
  e.append(el('div', 'kt-text', text));
  return e;
}

function lightStep(stepEls, upto) {
  stepEls.forEach((s, i) => s.classList.toggle('lit', i <= upto));
}

// Poll the read surface's loop truth so the ribbon + gate count reflect reality (draft queued,
// rehearsal running, proposal waiting). Read-only; degrades silently.
async function pollLoop(gcount, stepEls) {
  const tick = async () => {
    try {
      const v = await (await fetch('/api/aumlok', { headers: { accept: 'application/json' } })).json();
      const pending = (v && v.pending) ? v.pending.filter((p) => p.valid).length : 0;
      gcount.textContent = pending > 0 ? `· ${pending} waiting for your signature` : '· nothing waiting';
      if (pending > 0) lightStep(stepEls, 3);
    } catch { gcount.textContent = ''; }
    try {
      const loop = await (await fetch('/api/loop', { headers: { accept: 'application/json' } })).json();
      const q = loop && loop.rehearsalQueue;
      if (typeof q === 'number' && q > 0) lightStep(stepEls, 2);
    } catch { /* silent */ }
  };
  tick();
  setInterval(tick, 2500);
}

// Embed the local approval gate (7094) in-place — own-origin iframe, so this page can never drive it;
// the signature happens IN the gate, with the owner's key. Probe first; degrade to an honest note.
async function mountGate(slot) {
  slot.append(el('div', 'kt-gate-probe', 'connecting to your local gate…'));
  let up = false;
  try { await fetch(GATE_URL + '/', { mode: 'no-cors', cache: 'no-store' }); up = true; } catch { up = false; }
  slot.innerHTML = '';
  if (up) {
    const frame = document.createElement('iframe');
    frame.className = 'kt-gate-frame';
    frame.src = GATE_URL;
    frame.title = 'AUMLOK approval gate';
    slot.append(frame);
  } else {
    slot.append(el('div', 'kt-gate-off', 'The approval gate isn’t running on this node. Start the node (bun run start) on a bound node and it appears here — signing always happens on your machine, with your key.'));
  }
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .kt-app { max-width: 1040px; margin: 0 auto; padding: 26px 20px 50px; }
  .kt-head { margin-bottom: 16px; }
  .kt-name { font-size: 16px; letter-spacing: 0.2em; color: var(--text); }
  .kt-tag { color: var(--dim); font-size: 12.5px; margin-top: 3px; }
  .kt-ribbon { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 4px 0 20px; }
  .kt-step { display: flex; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px;
    border: 1px solid var(--glass-border); background: var(--glass); opacity: 0.5; transition: all 0.4s var(--ease); }
  .kt-step.lit { opacity: 1; border-color: rgba(var(--hue-l), 0.5); box-shadow: 0 0 16px rgba(var(--hue-l), 0.12); }
  .kt-step-n { width: 17px; height: 17px; border-radius: 50%; display: grid; place-items: center;
    font-size: 9.5px; color: var(--text); background: rgba(var(--hue-l), 0.2); }
  .kt-step-l { font-size: 10.5px; letter-spacing: 0.04em; color: var(--dim); text-transform: uppercase; }
  .kt-arrow { color: var(--faint); font-size: 12px; }
  .kt-cols { display: grid; grid-template-columns: 1fr; gap: 14px; }
  @media (min-width: 860px) { .kt-cols { grid-template-columns: 1fr 1fr; } }
  .kt-col-h { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(var(--hue-l), 0.95); margin-bottom: 9px; }
  .kt-gcount { color: var(--faint); text-transform: none; letter-spacing: 0; margin-left: 8px; }
  .kt-ask, .kt-gate { border: 1px solid var(--glass-border); border-radius: 14px; padding: 15px 16px; background: var(--glass); }
  .kt-log { min-height: 300px; max-height: 46vh; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; margin-bottom: 12px; }
  .kt-hint { font-size: 11.5px; color: var(--faint); line-height: 1.6; }
  .kt-entry { display: flex; gap: 9px; }
  .kt-who { flex: none; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; padding: 3px 7px; border-radius: 7px; height: fit-content; }
  .kt-you .kt-who { color: rgba(var(--hue-c), 0.95); background: rgba(var(--hue-c), 0.1); }
  .kt-auma .kt-who { color: rgba(var(--hue-r), 0.95); background: rgba(var(--hue-r), 0.1); }
  .kt-err .kt-who { color: #ff9696; background: rgba(255, 120, 120, 0.1); }
  .kt-text { font-size: 12.5px; line-height: 1.6; color: var(--text); white-space: pre-wrap; word-break: break-word; }
  .kt-err .kt-text { color: #ffb0b0; }
  .kt-composer { display: flex; gap: 8px; }
  .kt-input { flex: 1; font: inherit; font-size: 13px; padding: 10px 13px; border-radius: 11px;
    border: 1px solid var(--glass-border); background: rgba(255,255,255,0.06); color: var(--text); }
  .kt-send { font: inherit; font-size: 13px; padding: 10px 18px; border-radius: 11px; cursor: pointer; color: var(--text);
    border: 1px solid rgba(var(--hue-r), 0.55); background: rgba(var(--hue-r), 0.14); }
  .kt-send:hover:not(:disabled) { background: rgba(var(--hue-r), 0.24); }
  .kt-send:disabled { opacity: 0.5; cursor: not-allowed; }
  .kt-gate-slot { min-height: 380px; }
  .kt-gate-frame { width: 100%; height: 52vh; min-height: 380px; border: 0; border-radius: 12px; background: transparent; display: block; }
  .kt-gate-probe, .kt-gate-off { font-size: 12px; color: var(--dim); line-height: 1.6; padding: 12px 0; }
  `;
  document.head.append(s);
}
