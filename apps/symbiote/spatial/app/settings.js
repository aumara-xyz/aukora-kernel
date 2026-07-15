// Aukora Spatial — Settings.
//
// A small, honest settings surface for your sovereign node. Its one real job: let you add your OWN
// OpenRouter API key so you can talk to Auma without touching a terminal. The key is machine-local — the
// chat door writes it to a file OUTSIDE the repo (never committed, never synced) and never sends it back to
// this page. This is only the model API key the runtime spends; it is NOT an AUMLOK signing key and grants
// no authority.
//
// Talks to the chat door (:7091). GET reports presence only (no key bytes ever reach the browser).

const DOOR = 'http://127.0.0.1:7091';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const CONTRIBUTION_STEPS = `# contribute from this node
git checkout -b your-name/your-change
# …build the thing, run the gate…
bash scripts/test.sh
git add <your files> && git commit
git push -u origin your-name/your-change
# then open a pull request on GitHub — the owner reviews and merges by hand`;

async function getKeyStatus() {
  try {
    const r = await fetch(DOOR + '/api/settings/openrouter', { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('door status ' + r.status);
    return await r.json();
  } catch (e) {
    return { present: false, source: null, error: String(e && e.message || e) };
  }
}

export async function mountSettings(root) {
  injectStyle();
  const app = el('div', 'set-app');
  const scroll = el('div', 'set-scroll');
  app.append(scroll);

  scroll.append(el('div', 'set-h1', 'Settings'));
  scroll.append(el('div', 'set-tag', 'this node — your keys stay on your machine'));

  // ── OpenRouter key card ──
  const card = el('div', 'set-card');
  card.append(el('div', 'set-card-t', 'OpenRouter API key'));
  card.append(el('div', 'set-card-s',
    'Add your own key to talk to Auma and run the models. It is saved locally on your machine only — never committed, never synced, never shown back here.'));

  const createKey = el('a', 'set-btn set-link-btn', 'Create an OpenRouter account and key');
  createKey.href = 'https://openrouter.ai/keys'; createKey.target = '_blank'; createKey.rel = 'noopener noreferrer';
  card.append(createKey);

  const statusRow = el('div', 'set-status', 'checking…');
  card.append(statusRow);

  const row = el('div', 'set-row');
  const input = el('input', 'set-input');
  input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false;
  input.placeholder = 'sk-or-v1-…  (paste your key)';
  const saveBtn = el('button', 'set-btn', 'Save key');
  const clearBtn = el('button', 'set-btn set-btn-ghost', 'Clear');
  row.append(input, saveBtn, clearBtn);
  card.append(row);

  const msg = el('div', 'set-msg');
  card.append(msg);

  const hint = el('div', 'set-hint');
  hint.append(document.createTextNode('No key yet? Create one at '));
  const a = el('a', null, 'openrouter.ai/keys'); a.href = 'https://openrouter.ai/keys'; a.target = '_blank'; a.rel = 'noopener noreferrer';
  hint.append(a);
  hint.append(document.createTextNode('. Prefer the terminal? Put OPENROUTER_API_KEY in core/.env instead — either works.'));
  card.append(hint);

  scroll.append(card);

  // ── Memory brain truth card — read-only, stated plainly (/api/brain + /api/aumlok).
  // Shows what is actually true right now: whether the local Convex brain answers, whether
  // shadow-capture is armed and how its last write attempt went (env-gated, default off),
  // where live recall really comes from (Kira JSON until R5b), and whether this node has its
  // own AUMLOK key. Changes nothing; shows no key bytes.
  const aumlokP = fetch('/api/aumlok').then((r) => r.json()).catch(() => null);
  const brainCard = el('div', 'set-card');
  brainCard.append(el('div', 'set-card-t', 'Memory brain'));
  brainCard.append(el('div', 'set-card-s', 'What is true on this node right now. Read-only — nothing here changes anything.'));
  const bGrid = el('div', 'set-id');
  const bRow = (k) => { const r = el('div', 'set-id-row'); const v = el('div', 'set-id-v', '…'); r.append(el('div', 'set-id-k', k), v); bGrid.append(r); return v; };
  const bConvex = bRow('convex brain');
  const bCapture = bRow('capture');
  const bRecall = bRow('recall source');
  const bAumlok = bRow('aumlok key');
  brainCard.append(bGrid);
  const bindHint = el('div', 'set-hint');
  bindHint.style.display = 'none';
  brainCard.append(bindHint);
  scroll.append(brainCard);

  fetch('/api/brain').then((r) => r.json()).then((b) => {
    bConvex.textContent = b && b.convex && b.convex.running
      ? 'running locally (loopback only)'
      : 'not running — start it with: bun run brain';
    // The wired boolean alone can't tell "armed and healthy" from "armed but every write is
    // refusing" — the note (shadowCapture.captureTruth) carries last-attempt health, so render it.
    // The card must never lie.
    bCapture.textContent = b && b.capture && b.capture.wired
      ? 'shadow-capture armed — governed writes attempted (see note)'
      : 'not armed — chat turns are not written into Convex';
    if (b && b.capture && b.capture.note) bCapture.append(el('div', 'set-hint', b.capture.note));
    bRecall.textContent = (b && b.recall && b.recall.note) || 'unknown';
  }).catch(() => { bConvex.textContent = 'unknown — read surface unreachable'; bCapture.textContent = 'unknown'; bRecall.textContent = 'unknown'; });
  aumlokP.then((v) => {
    const present = !!(v && v.status && v.status.keyPresent);
    bAumlok.textContent = present ? 'present — this node can sign locally' : 'not present — this node is unbound';
    const cmd = v && v.commands && v.commands.keygen;
    if (!present && cmd) {
      bindHint.style.display = '';
      bindHint.append(document.createTextNode('Bind this node with AUMLOK: run '));
      bindHint.append(el('code', null, cmd));
      bindHint.append(document.createTextNode(' in a terminal at the repo folder (on Windows: Git Bash). The key is created locally with owner-only permissions, grants authority only over this node, and never leaves your machine.'));
    }
  });

  // ── node identity card: name · mode · commit · key status. All reads, all local. ──
  const idCard = el('div', 'set-card');
  idCard.append(el('div', 'set-card-t', 'This node'));
  const idGrid = el('div', 'set-id');
  const idRow = (k, vEl) => { const r = el('div', 'set-id-row'); r.append(el('div', 'set-id-k', k), vEl); idGrid.append(r); return vEl; };
  let nodeName = ''; try { nodeName = localStorage.getItem('aukora-node-name') || ''; } catch { /* private mode */ }
  const nameVal = idRow('name', el('div', 'set-id-v', nodeName || 'unnamed'));
  const modeVal = idRow('mode', el('div', 'set-id-v', 'checking…'));
  const shaVal = idRow('commit', el('div', 'set-id-v mono', '…'));
  const keyVal = idRow('model key', el('div', 'set-id-v', '…'));
  idCard.append(idGrid);
  aumlokP.then((v) => {
    if (!v) { modeVal.textContent = 'unknown'; return; }
    const owner = !!(v && v.status && v.status.keyPresent);
    modeVal.textContent = owner ? 'sovereign — bound to your key' : 'unbound — generate your key to become sovereign';
  });
  fetch('/api/node').then((r) => r.json()).then((v) => {
    shaVal.textContent = (v && typeof v.sha === 'string' && v.sha !== 'unknown') ? v.sha.slice(0, 12) : 'unknown';
  }).catch(() => { shaVal.textContent = 'unknown'; });
  getKeyStatus().then((s) => { keyVal.textContent = s.present ? 'active' : 'not set'; });

  const idBtns = el('div', 'set-row');
  const copySteps = el('button', 'set-btn set-btn-ghost', 'Copy contribution steps');
  copySteps.onclick = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(CONTRIBUTION_STEPS); } catch { /* clipboard blocked */ }
    copySteps.textContent = 'copied'; setTimeout(() => { copySteps.textContent = 'Copy contribution steps'; }, 1600);
  };
  idBtns.append(copySteps);
  idCard.append(idBtns);
  scroll.append(idCard);

  // ── honest "what this node is" note ──
  const note = el('div', 'set-note');
  note.append(el('div', 'set-note-t', 'About this node'));
  note.append(el('p', null,
    'This is your sovereign node — the complete Aukora, running fully on your machine. Generate your own AUMLOK key (`bash scripts/aumlok-authority.sh keygen`) and it can modify itself under your hand: Auma proposes, you sign, it applies live, with a receipt. Share your work back to the shared repo as a normal branch/PR for review. The only things not in a download are the founder’s personal key and memory — you make your own.'));
  scroll.append(note);

  const render = (s) => {
    statusRow.className = 'set-status ' + (s.present ? 'ok' : 'off');
    if (s.error) { statusRow.textContent = 'could not reach the local door on :7091 — is the chat server running?'; }
    else if (s.present) { statusRow.textContent = 'Connected — a key is active' + (s.source ? ' (from ' + s.source + ')' : '') + '.'; }
    else { statusRow.textContent = 'No key set yet — add one below to talk to Auma.'; }
    clearBtn.style.display = s.savedInApp ? '' : 'none';
  };

  render(await getKeyStatus());

  saveBtn.onclick = async () => {
    const key = input.value.trim();
    if (!key) { msg.className = 'set-msg err'; msg.textContent = 'Paste a key first.'; return; }
    saveBtn.disabled = true; msg.className = 'set-msg'; msg.textContent = 'saving…';
    try {
      const r = await fetch(DOOR + '/api/settings/openrouter', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }),
      });
      const d = await r.json();
      if (r.ok && d.ok) { msg.className = 'set-msg ok'; msg.textContent = 'Saved locally. Auma can hear you now.'; input.value = ''; render(await getKeyStatus()); }
      else { msg.className = 'set-msg err'; msg.textContent = d.error || 'could not save'; }
    } catch (e) { msg.className = 'set-msg err'; msg.textContent = 'could not reach the local door: ' + (e && e.message || e); }
    finally { saveBtn.disabled = false; }
  };

  clearBtn.onclick = async () => {
    clearBtn.disabled = true; msg.className = 'set-msg'; msg.textContent = 'clearing…';
    try {
      const r = await fetch(DOOR + '/api/settings/openrouter', { method: 'DELETE' });
      const d = await r.json();
      msg.className = 'set-msg'; msg.textContent = d.present ? 'Removed the in-app key (another source is still active).' : 'Key cleared.';
      render(await getKeyStatus());
    } catch (e) { msg.className = 'set-msg err'; msg.textContent = 'could not reach the local door: ' + (e && e.message || e); }
    finally { clearBtn.disabled = false; }
  };

  root.append(app);
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .set-app { position:absolute; inset:0; display:flex; flex-direction:column; color:var(--text); font-size:14px; overflow:hidden; }
  .set-scroll { flex:1; overflow-y:auto; padding:22px max(16px, calc((100% - 720px)/2)) 60px; scrollbar-width:thin; }
  .set-h1 { font-size:18px; font-weight:750; letter-spacing:0.16em; }
  .set-tag { font-size:11.5px; color:var(--dim); margin:2px 0 20px; }
  .set-card { border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:18px 18px 16px; margin-bottom:16px;
    background:rgba(255,255,255,0.02); }
  .set-card-t { font-size:14px; font-weight:650; color:#fff; }
  .set-card-s { font-size:12px; line-height:1.55; color:var(--dim); margin:5px 0 14px; }
  .set-status { font-size:12.5px; padding:8px 11px; border-radius:9px; margin-bottom:12px; border:1px solid rgba(255,255,255,0.08); }
  .set-status.ok { color:rgba(var(--hue-l),1); border-color:rgba(var(--hue-l),0.35); background:rgba(var(--hue-l),0.08); }
  .set-status.off { color:rgba(255,200,140,0.95); border-color:rgba(255,200,140,0.3); background:rgba(255,200,140,0.06); }
  .set-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .set-input { flex:1; min-width:220px; font:inherit; font-size:13px; padding:9px 12px; border-radius:10px; color:var(--text);
    border:1px solid rgba(255,255,255,0.14); background:#000; letter-spacing:0.02em; }
  .set-input:focus { outline:none; border-color:rgba(var(--hue-c),0.6); }
  .set-btn { flex:none; font:inherit; font-size:12.5px; font-weight:600; padding:9px 16px; border-radius:10px; cursor:pointer; color:#fff;
    border:1px solid rgba(var(--hue-c),0.6); background:rgba(var(--hue-c),0.18); transition:all 0.15s ease; }
  .set-link-btn { display:inline-block; width:max-content; margin:0 0 14px; text-decoration:none; }
  .set-btn:hover { border-color:rgba(var(--hue-c),0.9); background:rgba(var(--hue-c),0.28); }
  .set-btn:disabled { opacity:0.5; cursor:not-allowed; }
  .set-btn-ghost { color:var(--dim); border-color:rgba(255,255,255,0.14); background:transparent; }
  .set-msg { font-size:12px; min-height:16px; margin-top:10px; color:var(--dim); }
  .set-msg.ok { color:rgba(var(--hue-l),1); } .set-msg.err { color:rgba(255,150,150,0.95); }
  .set-hint { font-size:11.5px; line-height:1.55; color:var(--faint); margin-top:12px; }
  .set-hint a { color:rgba(var(--hue-c),0.95); }
  .set-id { display:flex; flex-direction:column; gap:7px; margin-bottom:14px; }
  .set-id-row { display:flex; align-items:baseline; gap:14px; }
  .set-id-k { flex:none; width:88px; font-size:9.5px; letter-spacing:0.14em; text-transform:uppercase; color:var(--faint); }
  .set-id-v { font-size:12.5px; color:rgba(255,255,255,0.85); }
  .set-id-v.mono { font-family:ui-monospace,monospace; font-size:11.5px; color:var(--dim); }
  .set-note { border:1px solid rgba(255,255,255,0.07); border-radius:14px; padding:15px 16px; background:rgba(255,255,255,0.015); }
  .set-note-t { font-size:10.5px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:var(--faint); margin-bottom:9px; }
  .set-note p { margin:0; font-size:12.5px; line-height:1.6; color:rgba(255,255,255,0.8); }
  `;
  const tag = document.createElement('style');
  tag.id = 'settings-screen-style';
  tag.textContent = css;
  document.head.append(tag);
}
