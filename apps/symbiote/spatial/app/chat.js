// Aukora Spatial — the chats lane. Left lane is ALWAYS chats (owner's rule).
//
// Threads are client-side transcripts (localStorage) over ONE shared engine
// session: whatever any thread teaches the loop lands in the same Kira brain —
// one being, one memory. The Aukora threads speak the governed workbench
// grammar through the chat door (7091); friend-to-friend threads are a future
// organ (node-to-node messaging) and appear as soon-rows only.
//
// Nothing in this lane can apply anything: proposals halt for the AUMLOK
// signature engine-side.

import { award } from '/app/aura-core.js';

const CHAT_DOOR = 'http://127.0.0.1:7091';
const APP_LAB_ORGAN = 'app-lab';
const MAX_IMAGE_BYTES = 2_500_000;   // dataURL preview cap
const MAX_TEXT_BYTES = 256_000;      // inline-into-message cap
const MAX_ATTACHMENTS = 6;
const TEXT_EXT = /\.(ts|tsx|js|mjs|jsx|json|md|txt|css|html|svg|sh|py|rs|go|toml|yml|yaml|csv|log|xml|diff|patch|sql|ini|lock)$/i;

// ---------------------------------------------------------------------------
// Thread store.
// ---------------------------------------------------------------------------

const THREADS_KEY = 'aukora-threads-v1';

function defaultThreads() {
  return [
    { id: 'aukora-main', name: 'Aukora', gist: 'the seed — governed loop', live: true, pinned: true, unread: false, archived: false },
    { id: 'council', name: 'Fusion Council', gist: 'review threads', soon: true, pinned: false, unread: false, archived: false },
    { id: 'kira', name: 'Kira', gist: 'memory recall', soon: true, pinned: false, unread: false, archived: false },
  ];
}

let threads = [];
try {
  const raw = JSON.parse(localStorage.getItem(THREADS_KEY) ?? 'null');
  threads = Array.isArray(raw) && raw.length ? raw : defaultThreads();
} catch {
  threads = defaultThreads();
}
// Migration: retire the old DEV · Canvas thread into the archive. App Lab now rides through the main
// Aukora thread, so the playground no longer needs its own visible lane identity.
const legacyCanvas = threads.find((t) => t.id === 'dev-canvas');
if (legacyCanvas) {
  legacyCanvas.name = 'App Lab · legacy';
  legacyCanvas.gist = 'older playground transcript — kept for reference';
  legacyCanvas.pinned = false;
  legacyCanvas.archived = true;
  try { localStorage.setItem(THREADS_KEY, JSON.stringify(threads)); } catch { /* private mode */ }
}

function saveThreads() {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
}

function threadById(id) {
  return threads.find((t) => t.id === id);
}

function historyKey(id) {
  return `aukora-thread-${id}`;
}

function loadHistory(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(historyKey(id)) ?? '[]');
    // Drop legacy "[voice] …" meta-notes saved before they were folded into the
    // reply header — they should never render as their own bubble anymore.
    return Array.isArray(raw)
      ? raw.filter((m) => m && typeof m.text === 'string' && !m.text.startsWith('[voice]'))
      : [];
  } catch {
    return [];
  }
}

function saveHistory(id, history) {
  // Image dataURLs stay in-memory only — localStorage is ~5MB total.
  const slim = history.slice(-80).map((m) => ({
    ...m,
    attachments: m.attachments?.map((a) => ({ name: a.name, size: a.size, mime: a.mime, kind: a.kind })),
  }));
  try {
    localStorage.setItem(historyKey(id), JSON.stringify(slim));
  } catch { /* quota — drop persistence, keep the session */ }
}

// one-time adoption of the pre-threads transcript
try {
  const legacy = sessionStorage.getItem('aukora-chat-history');
  if (legacy && !localStorage.getItem(historyKey('aukora-main'))) {
    localStorage.setItem(historyKey('aukora-main'), legacy);
  }
  sessionStorage.removeItem('aukora-chat-history');
} catch { /* fine */ }

// ---------------------------------------------------------------------------
// Elements + view state.
// ---------------------------------------------------------------------------

const listView = document.getElementById('chat-list-view');
const openView = document.getElementById('chat-open-view');
const threadList = document.getElementById('thread-list');
const messagesEl = document.getElementById('chat-messages');
const composer = document.getElementById('composer');
const input = document.getElementById('composer-input');
const sendBtn = document.getElementById('composer-send');
const backCorner = document.getElementById('corner-chat-back');
const chatsMeta = document.getElementById('chats-meta');
const filtersEl = document.getElementById('toolbar-filters');
const newChatBar = document.getElementById('new-chat-bar');
const btnNew = document.getElementById('btn-new');
const attachRow = document.getElementById('attach-row');
const chatTitle = document.getElementById('chat-title');
const renameInput = document.getElementById('rename-input');

// Click-to-copy: click anywhere on a message bubble to copy its text. The only
// affordance is the hover accent bar (left edge for Aukora, right edge for you)
// — no copy button. A brief green flash confirms the copy.
messagesEl.addEventListener('click', (e) => {
  const wrap = e.target.closest('.msg');
  if (!wrap || !wrap.dataset.copy) return;
  // never hijack an intentional text selection inside this bubble
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && wrap.contains(sel.anchorNode)) return;
  const flash = () => {
    wrap.classList.add('copied');
    setTimeout(() => wrap.classList.remove('copied'), 900);
  };
  const text = wrap.dataset.copy;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(flash).catch(() => fallbackCopy(text, flash));
  } else {
    fallbackCopy(text, flash);
  }
});

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { /* clipboard unavailable */ }
  ta.remove();
}

let openThreadId = null;
let history = [];
let pending = false;
let newBarOpen = false;
const filters = { pin: false, unread: false, archive: false };
let attachments = [];
let activeOrganKey = window.__aukoraActiveOrgan || 'map';

window.addEventListener('aukora:organ', (e) => {
  activeOrganKey = e?.detail?.organ || 'map';
});

const ICONS = {
  pin: '<svg viewBox="0 0 16 16"><path d="M9.5 1.5 14.5 6.5 11 8l-1.5 4.5L4 7 8.5 5.5Z"/><path d="M5 11l-3 3"/></svg>',
  unread: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.6"/></svg>',
  archive: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3.4" rx="0.8"/><path d="M3.4 6.4V13h9.2V6.4"/><path d="M6.4 9h3.2"/></svg>',
  pencil: '<svg viewBox="0 0 16 16"><path d="M3 13l0.9-3.2 7.3-7.3 2.3 2.3-7.3 7.3Z"/></svg>',
};

// ---------------------------------------------------------------------------
// Thread list + toolbar.
// ---------------------------------------------------------------------------

export function isChatOpen() {
  return openThreadId !== null;
}

export function closeChat() {
  if (openThreadId === null) return;
  openThreadId = null;
  openView.hidden = true;
  backCorner.hidden = true;
  listView.hidden = false;
  renderThreads();
}

function visibleThreads() {
  let list = threads.filter((t) => (filters.archive ? t.archived : !t.archived));
  if (filters.pin) list = list.filter((t) => t.pinned);
  if (filters.unread) list = list.filter((t) => t.unread);
  return list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}

function renderThreads() {
  threadList.innerHTML = '';
  const list = visibleThreads();
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'idle-caption';
    empty.style.textAlign = 'center';
    empty.style.padding = '30px 10px';
    empty.textContent = filters.archive ? 'nothing archived' : 'no threads match the filter';
    threadList.append(empty);
  }
  for (const t of list) {
    const btn = document.createElement('button');
    btn.className = 'row inspector-row thread-row';
    const left = document.createElement('span');
    left.className = 'thread-left';
    const icon = document.createElement('img');
    icon.src = '/assets/aumara-icon-96.png';
    icon.className = 'thread-icon';
    icon.alt = '';
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.textContent = t.name;
    const gist = document.createElement('span');
    gist.className = 'row-gist';
    gist.textContent = t.gist;
    text.append(name, gist);
    left.append(icon, text);
    btn.append(left);

    const status = document.createElement('span');
    status.className = 'thread-status';
    if (t.soon) {
      const pill = document.createElement('span');
      pill.className = 'pill pill-green soon';
      pill.textContent = 'soon';
      status.append(pill);
      btn.disabled = true;
    }
    if (t.pinned && !t.soon) {
      const pin = document.createElement('span');
      pin.className = 'row-pin';
      pin.innerHTML = ICONS.pin;
      status.append(pin);
    }
    if (t.unread) {
      const dot = document.createElement('span');
      dot.className = 'unread-dot';
      status.append(dot);
    }
    btn.append(status);
    if (t.live) btn.addEventListener('click', () => openChat(t.id));
    threadList.append(btn);
  }
  if (chatsMeta) chatsMeta.textContent = `${threads.filter((t) => t.live && !t.archived).length} live`;
}

function setNewBar(open) {
  newBarOpen = open;
  btnNew.classList.toggle('open', open);
  filtersEl.hidden = open;
  newChatBar.hidden = !open;
}

btnNew.addEventListener('click', () => setNewBar(!newBarOpen));

filtersEl.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.filter;
    filters[key] = !filters[key];
    btn.classList.toggle('active', filters[key]);
    renderThreads();
  });
});

document.getElementById('btn-new-aukora').addEventListener('click', () => {
  const t = {
    id: 'aukora-' + Date.now().toString(36),
    name: 'Aukora',
    gist: 'new thread',
    live: true, pinned: false, unread: false, archived: false,
  };
  threads.unshift(t);
  saveThreads();
  setNewBar(false);
  openChat(t.id);
});

// ---------------------------------------------------------------------------
// Open thread view + tool buttons.
// ---------------------------------------------------------------------------

function openChat(id) {
  const t = threadById(id);
  if (!t || !t.live) return;
  openThreadId = id;
  t.unread = false;
  saveThreads();
  history = loadHistory(id);
  chatTitle.textContent = t.name;
  listView.hidden = true;
  openView.hidden = false;
  backCorner.hidden = false;
  syncOpenTools(t);
  renderMessages();
  input.focus();
}

function syncOpenTools(t) {
  document.getElementById('btn-pin').classList.toggle('active', !!t.pinned);
  document.getElementById('btn-unread').classList.toggle('active', !!t.unread);
  document.getElementById('btn-archive').classList.toggle('active', !!t.archived);
}

document.getElementById('btn-pin').addEventListener('click', () => {
  const t = threadById(openThreadId);
  if (!t) return;
  t.pinned = !t.pinned;
  saveThreads();
  syncOpenTools(t);
});
document.getElementById('btn-unread').addEventListener('click', () => {
  const t = threadById(openThreadId);
  if (!t) return;
  t.unread = !t.unread;
  saveThreads();
  syncOpenTools(t);
  if (t.unread) closeChat(); // marked unread = "come back to this later"
});
document.getElementById('btn-archive').addEventListener('click', () => {
  const t = threadById(openThreadId);
  if (!t) return;
  t.archived = !t.archived;
  saveThreads();
  syncOpenTools(t);
  if (t.archived) closeChat();
});
document.getElementById('btn-rename').addEventListener('click', () => {
  const t = threadById(openThreadId);
  if (!t) return;
  chatTitle.hidden = true;
  renameInput.hidden = false;
  renameInput.value = t.name;
  renameInput.focus();
  renameInput.select();
});
function commitRename() {
  const t = threadById(openThreadId);
  if (t && renameInput.value.trim()) {
    t.name = renameInput.value.trim();
    chatTitle.textContent = t.name;
    saveThreads();
  }
  renameInput.hidden = true;
  chatTitle.hidden = false;
}
renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
  if (e.key === 'Escape') { e.stopPropagation(); renameInput.hidden = true; chatTitle.hidden = false; }
});
renameInput.addEventListener('blur', commitRename);
backCorner.addEventListener('click', closeChat);

// ---------------------------------------------------------------------------
// Messages.
// ---------------------------------------------------------------------------

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}

function bubble(m) {
  const wrap = document.createElement('div');
  wrap.className = `msg msg-${m.role} ${m.kind ?? ''}`;
  if (m.text) wrap.dataset.copy = m.text;
  // Her actual speech gets a header: her name + a light, always-on status line
  // (model · advisory · time). Process notes/errors render bare.
  if (m.role === 'aukora' && !m.kind) {
    const head = document.createElement('div');
    head.className = 'msg-head';
    const speaker = document.createElement('span');
    speaker.className = 'msg-speaker';
    speaker.textContent = 'Auma';
    head.append(speaker);
    const meta = document.createElement('span');
    meta.className = 'msg-meta';
    const parts = [];
    if (m.model) parts.push(m.model);
    if (m.ts) parts.push(fmtTime(m.ts));
    meta.textContent = parts.join(' · ');
    head.append(meta);
    wrap.append(head);
  }
  const body = document.createElement('div');
  body.className = 'msg-body';
  if (m.text) body.textContent = m.text;
  if (m.attachments?.length) {
    const box = document.createElement('div');
    box.className = 'msg-attachments';
    for (const a of m.attachments) {
      if (a.kind === 'image' && a.dataUrl) {
        const img = document.createElement('img');
        img.src = a.dataUrl;
        img.alt = a.name;
        img.className = 'msg-image';
        box.append(img);
      } else {
        const chip = document.createElement('span');
        chip.className = 'attach-chip static';
        chip.textContent = `${a.kind === 'image' ? '🖼' : '📄'} ${a.name} · ${fmtSize(a.size)}`;
        box.append(chip);
      }
    }
    body.append(box);
  }
  wrap.append(body);
  return wrap;
}

function renderMessages() {
  messagesEl.innerHTML = '';
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    const line = document.createElement('p');
    line.className = 'idle-serif';
    line.textContent = 'The loop is listening. Say what’s alive for you.';
    const caption = document.createElement('p');
    caption.className = 'idle-caption';
    caption.textContent = 'She explores read-only, drafts in the sandbox, and halts for your signature.';
    const grammar = document.createElement('p');
    grammar.className = 'idle-caption';
    grammar.textContent = 'Try: help · status · map yourself · search <q> · agent: <goal> · run: <goal>';
    empty.append(line, caption, grammar);
    messagesEl.append(empty);
  }
  for (const m of history) messagesEl.append(bubble(m));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setTyping(on, opts = {}) {
  document.getElementById('typing-row')?.remove();
  if (councilGlyphTimer) { clearInterval(councilGlyphTimer); councilGlyphTimer = null; }
  if (!on) return;
  if (opts.council) { renderCouncilDeliberation(); return; }
  const row = document.createElement('div');
  row.id = 'typing-row';
  row.className = 'msg msg-aukora';
  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('span');
    d.style.animationDelay = `${i * 0.18}s`;
    dots.append(d);
  }
  row.append(dots);
  messagesEl.append(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// The Fusion Council's thinking indicator: the resolved council's real names in a
// ring, glyphs from the engine's actual vocabulary flying between them. This is a
// REPRESENTATION of the deliberation (the real packets stay server-side) — the
// caption says so; it never pretends to show live packet traffic.
const COUNCIL_GLYPHS = ['⊕', '⊖', '⊙', '⊘', '⊚', '⇈', '↑', '→', '↓', '⇊', '↗', '↘', '↙', '↖', '⇄'];
let councilGlyphTimer = null;

function renderCouncilDeliberation() {
  const row = document.createElement('div');
  row.id = 'typing-row';
  row.className = 'msg msg-aukora council-row';
  const title = document.createElement('div');
  title.className = 'council-title';
  title.textContent = '⚡ the Fusion Council is deliberating';
  const arena = document.createElement('div');
  arena.className = 'council-arena';
  const chips = fusionCouncilNames.map((name, i) => {
    const chip = document.createElement('span');
    chip.className = 'council-chip';
    chip.textContent = name;
    const angle = (i / fusionCouncilNames.length) * 2 * Math.PI - Math.PI / 2;
    chip.style.left = `${50 + 41 * Math.cos(angle)}%`;
    chip.style.top = `${50 + 38 * Math.sin(angle)}%`;
    arena.append(chip);
    return chip;
  });
  const sub = document.createElement('div');
  sub.className = 'council-sub';
  sub.textContent = `${fusionCouncilNames.length} seats exchanging structured semantic packets (this animation is a representation, not live traffic) — two concurrent waves, a reading takes a minute or two · advisory only`;
  row.append(title, arena, sub);
  messagesEl.append(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  councilGlyphTimer = setInterval(() => {
    if (!row.isConnected) { clearInterval(councilGlyphTimer); councilGlyphTimer = null; return; }
    if (chips.length < 2) return;
    const a = Math.floor(Math.random() * chips.length);
    let b = Math.floor(Math.random() * (chips.length - 1));
    if (b >= a) b += 1;
    const g = document.createElement('span');
    g.className = 'council-glyph';
    g.textContent = COUNCIL_GLYPHS[Math.floor(Math.random() * COUNCIL_GLYPHS.length)];
    g.style.left = chips[a].style.left;
    g.style.top = chips[a].style.top;
    arena.append(g);
    requestAnimationFrame(() => {
      g.classList.add('fly');
      g.style.left = chips[b].style.left;
      g.style.top = chips[b].style.top;
    });
    setTimeout(() => g.classList.remove('fly'), 1150); // fade out on arrival
    setTimeout(() => g.remove(), 1500);
  }, 340);
}

// ---------------------------------------------------------------------------
// Attachments: picker buttons + drag & drop onto the composer.
// ---------------------------------------------------------------------------

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function renderAttachRow() {
  attachRow.innerHTML = '';
  attachRow.hidden = attachments.length === 0;
  attachments.forEach((a, i) => {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    if (a.kind === 'image' && a.dataUrl) {
      const img = document.createElement('img');
      img.src = a.dataUrl;
      img.alt = '';
      img.className = 'attach-thumb';
      chip.append(img);
    }
    const label = document.createElement('span');
    label.textContent = `${a.name} · ${fmtSize(a.size)}`;
    chip.append(label);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'attach-x';
    x.textContent = '✕';
    x.title = 'remove';
    x.addEventListener('click', () => {
      attachments.splice(i, 1);
      renderAttachRow();
      syncSend();
    });
    chip.append(x);
    attachRow.append(chip);
  });
}

function readAs(file, mode) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (mode === 'dataUrl') r.readAsDataURL(file);
    else r.readAsText(file);
  });
}

function isPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function truncateToBytes(text, maxBytes) {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) return { text, truncated: false };
  // decode with fatal:false and ignoreBOM so a byte-boundary cut mid-character
  // doesn't throw — any partial trailing character becomes U+FFFD, which we
  // then strip so the truncated text never ends in a broken character.
  const slice = encoded.slice(0, maxBytes);
  let decoded = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  if (decoded.endsWith('�')) decoded = decoded.slice(0, -1);
  return { text: decoded, truncated: true };
}

async function addFiles(fileList) {
  for (const file of [...fileList]) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      noteInComposer(`attachment cap is ${MAX_ATTACHMENTS} — extras skipped`);
      break;
    }
    const isImage = file.type.startsWith('image/');
    const isText = file.type.startsWith('text/') || TEXT_EXT.test(file.name) || file.type === 'application/json';
    try {
      if (isImage) {
        if (file.size > MAX_IMAGE_BYTES) {
          noteInComposer(`${file.name}: image over ${fmtSize(MAX_IMAGE_BYTES)} — attached as reference only`);
          attachments.push({ name: file.name, size: file.size, mime: file.type, kind: 'image' });
        } else {
          const dataUrl = await readAs(file, 'dataUrl');
          attachments.push({ name: file.name, size: file.size, mime: file.type, kind: 'image', dataUrl });
        }
      } else if (isText && file.size <= MAX_TEXT_BYTES) {
        const text = await readAs(file, 'text');
        attachments.push({ name: file.name, size: file.size, mime: file.type || 'text/plain', kind: 'text', text });
      } else if (isText) {
        // Over the inline cap: still worth sending, so read the whole file
        // and truncate — the alternative (silently dropping to a name-only
        // "binary" reference) hides content the model could otherwise use.
        noteInComposer(`${file.name}: text over ${fmtSize(MAX_TEXT_BYTES)} — sending the first ${fmtSize(MAX_TEXT_BYTES)}`);
        const fullText = await readAs(file, 'text');
        const { text: clippedText, truncated } = truncateToBytes(fullText, MAX_TEXT_BYTES);
        attachments.push({
          name: file.name,
          size: file.size,
          mime: file.type || 'text/plain',
          kind: 'text',
          text: clippedText,
          truncated,
        });
      } else if (isPdfFile(file)) {
        noteInComposer(`${file.name}: PDF text extraction isn't built yet — convert to .txt/.md, or attach page screenshots to a vision voice (👁)`);
        attachments.push({ name: file.name, size: file.size, mime: file.type || 'application/pdf', kind: 'pdf-unsupported' });
      } else {
        attachments.push({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream', kind: 'binary' });
      }
    } catch {
      noteInComposer(`${file.name}: could not read`);
    }
  }
  renderAttachRow();
  syncSend();
}

function noteInComposer(text) {
  history.push({ role: 'aukora', text, kind: 'msg-note' });
  renderMessages();
}

const attachButton = document.getElementById('btn-attach');
const attachPop = document.getElementById('attach-pop');
const attachFileButton = document.getElementById('btn-attach-file');
const attachImageButton = document.getElementById('btn-attach-image');

function setAttachPop(open) {
  attachButton.setAttribute('aria-expanded', String(open));
  attachPop.hidden = !open;
}

attachButton.addEventListener('click', () => setAttachPop(attachPop.hidden));
attachFileButton.addEventListener('click', () => {
  setAttachPop(false);
  document.getElementById('file-input').click();
});
attachImageButton.addEventListener('click', () => {
  setAttachPop(false);
  document.getElementById('image-input').click();
});
document.getElementById('file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
document.getElementById('image-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

['dragover', 'dragenter'].forEach((ev) =>
  openView.addEventListener(ev, (e) => {
    e.preventDefault();
    composer.classList.add('drop-hot');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  openView.addEventListener(ev, (e) => {
    e.preventDefault();
    composer.classList.remove('drop-hot');
  })
);
openView.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------------------
// Voice switcher — which model speaks when input is free text (not grammar).
// Roster + live vision/pricing metadata come from the door (GET /api/models);
// a static fallback keeps the pill working even if the door is down. Grammar
// commands (agent:/run:/status/…) are unaffected by the selection.
// ---------------------------------------------------------------------------

const VOICE_KEY = 'aukora-voice-model';
const PROVIDER_HUES = {
  anthropic: '224, 140, 105', // claude terracotta
  'z-ai': '129, 212, 180', // trinity green
  deepseek: '150, 180, 255', // trinity blue
  moonshot: '196, 170, 255', // trinity purple
  aukora: '64, 214, 166', // Auma local endpoint
  fusion: '240, 195, 110', // Fusion Council — golden, the council of many minds
  openai: '170, 220, 210',
  google: '150, 170, 250',
  custom: '200, 205, 220',
};
const FALLBACK_MODELS = [
  { id: 'auma-vl-v3', name: 'Auma 32B', provider: 'aukora', vision: true },
  { id: 'fusion-council', name: 'Fusion Council', provider: 'fusion', vision: false },
  { id: 'openai/gpt-5.4-image-2', name: 'GPT-5.4 Image', provider: 'openai', vision: true, imageOut: true },
  { id: 'google/gemini-3.1-flash-image', name: 'Gemini 3.1 Image', provider: 'google', vision: true, imageOut: true },
  { id: 'anthropic/claude-fable-5', name: 'Fable 5', provider: 'anthropic', vision: true },
  { id: 'anthropic/claude-opus-4.8', name: 'Opus 4.8', provider: 'anthropic', vision: true },
  { id: 'anthropic/claude-sonnet-5', name: 'Sonnet 5', provider: 'anthropic', vision: true },
  { id: 'anthropic/claude-haiku-4.5', name: 'Haiku 4.5', provider: 'anthropic', vision: true },
  { id: 'z-ai/glm-5.2', name: 'GLM 5.2', provider: 'z-ai', vision: false },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek v4 Pro', provider: 'deepseek', vision: false },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek v4 Flash', provider: 'deepseek', vision: false },
  { id: 'moonshotai/kimi-k2.7-code', name: 'Kimi K2.7', provider: 'moonshot', vision: false },
];

const voicePill = document.getElementById('voice-pill');
const voicePop = document.getElementById('voice-pop');
const voiceDot = document.getElementById('voice-dot');
const voiceName = document.getElementById('voice-name');
const voiceEye = document.getElementById('voice-eye');

let voiceModels = FALLBACK_MODELS;
let voiceId = localStorage.getItem(VOICE_KEY) || 'anthropic/claude-fable-5';
// The real resolved council roster arrives from the door (/api/models fusionCouncil);
// this is only the static fallback so the deliberation animation never renders empty.
let fusionCouncilNames = ['DeepSeek-V4', 'Qwen-3.7', 'GLM-5.2', 'Llama-4', 'Kimi-K2.7'];

function voiceInfo() {
  return voiceModels.find((m) => m.id === voiceId) ?? voiceModels[0];
}

function hasImageAttachment() {
  return attachments.some((a) => a.kind === 'image' && a.dataUrl);
}

function renderVoicePill() {
  const m = voiceInfo();
  voiceName.textContent = m.imageOut ? `${m.name} 🎨` : m.name;
  voiceDot.style.background = `rgba(${PROVIDER_HUES[m.provider] ?? PROVIDER_HUES.custom}, 0.95)`;
  voiceDot.style.boxShadow = `0 0 8px rgba(${PROVIDER_HUES[m.provider] ?? PROVIDER_HUES.custom}, 0.55)`;
  // SVG elements don't reflect the `.hidden` IDL property — toggle the attribute.
  voiceEye.toggleAttribute('hidden', !m.vision);
  const blind = hasImageAttachment() && !m.vision;
  voicePill.classList.toggle('warn', blind);
  voicePill.title = blind
    ? `${m.name} can’t see images — pick a voice with the eye badge`
    : 'Her voice — click to switch models';
}

function fmtPerM(n) {
  if (n == null) return '';
  return n < 1 ? `$${n}` : `$${Math.round(n * 10) / 10}`;
}

function renderVoicePop() {
  voicePop.innerHTML = '';
  for (const m of voiceModels) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'voice-opt' + (m.id === voiceId ? ' selected' : '');
    opt.setAttribute('role', 'option');
    opt.setAttribute('aria-selected', String(m.id === voiceId));
    const dot = document.createElement('span');
    dot.className = 'voice-dot';
    dot.style.background = `rgba(${PROVIDER_HUES[m.provider] ?? PROVIDER_HUES.custom}, 0.95)`;
    const name = document.createElement('span');
    name.className = 'voice-opt-name';
    name.textContent = m.name;
    opt.append(dot, name);
    if (m.vision) {
      const eye = document.createElement('span');
      eye.className = 'voice-opt-eye';
      eye.innerHTML = '<svg viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.9"/></svg>';
      eye.title = 'can see images';
      opt.append(eye);
    }
    if (m.imageOut) {
      const paint = document.createElement('span');
      paint.className = 'voice-opt-paint';
      paint.textContent = '🎨';
      paint.title = 'can make images';
      opt.append(paint);
    }
    if (m.promptPerM != null) {
      const price = document.createElement('span');
      price.className = 'voice-opt-price';
      price.textContent = `${fmtPerM(m.promptPerM)}/${fmtPerM(m.completionPerM)} per MTok`;
      opt.append(price);
    }
    opt.addEventListener('click', () => {
      voiceId = m.id;
      localStorage.setItem(VOICE_KEY, voiceId);
      setVoicePop(false);
      renderVoicePill();
      renderVoicePop();
    });
    voicePop.append(opt);
  }
  const footer = document.createElement('p');
  footer.className = 'voice-pop-note';
  footer.textContent = 'her conversational voice · advisory only — 👁 = can see images · 🎨 = can make images';
  voicePop.append(footer);
}

function setVoicePop(open) {
  voicePill.setAttribute('aria-expanded', String(open));
  if (open) {
    renderVoicePop();
    voicePop.hidden = false;
    requestAnimationFrame(() => voicePop.classList.add('open'));
  } else {
    voicePop.classList.remove('open');
    setTimeout(() => { if (!voicePop.classList.contains('open')) voicePop.hidden = true; }, 180);
  }
}

voicePill.addEventListener('click', () => setVoicePop(voicePop.hidden));
document.addEventListener('click', (e) => {
  if (!voicePop.hidden && !voicePop.contains(e.target) && !voicePill.contains(e.target)) setVoicePop(false);
  if (!attachPop.hidden && !attachPop.contains(e.target) && !attachButton.contains(e.target)) setAttachPop(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !voicePop.hidden) setVoicePop(false);
  if (e.key === 'Escape' && !attachPop.hidden) setAttachPop(false);
});

(async function loadVoiceModels() {
  try {
    const res = await fetch(`${CHAT_DOOR}/api/models`);
    const data = await res.json();
    if (Array.isArray(data.models) && data.models.length) {
      voiceModels = data.models;
      if (!localStorage.getItem(VOICE_KEY) && data.default) voiceId = data.default;
    }
    if (Array.isArray(data.fusionCouncil) && data.fusionCouncil.length) {
      fusionCouncilNames = data.fusionCouncil;
    }
  } catch { /* door down — static fallback roster stands */ }
  if (!voiceModels.some((m) => m.id === voiceId)) voiceId = voiceModels[0].id;
  renderVoicePill();
})();

// ---------------------------------------------------------------------------
// Transport — the chat door. One engine session behind all threads: one being,
// one Kira memory.
// ---------------------------------------------------------------------------

function pushEntries(entries, targetHistory) {
  let lastReply = null;
  for (const e of entries) {
    if (!e || e.kind === 'command') continue;
    if (e.kind === 'error') {
      targetHistory.push({ role: 'aukora', text: e.text, kind: 'msg-error', ts: Date.now() });
    } else if (e.kind === 'tool_call' || e.kind === 'tool_result') {
      // Fold the voice meta-notes ("voice: Fable 5 · advisory …", truncation
      // debug) into her reply's status header instead of noisy standalone bubbles.
      if (e.tool === 'voice') {
        const model = /voice:\s*([^·\n]+?)\s*·/.exec(e.text)?.[1]?.trim();
        if (model && lastReply) lastReply.model = model;
        continue;
      }
      targetHistory.push({ role: 'aukora', text: (e.tool ? `[${e.tool}] ` : '') + e.text, kind: 'msg-note', ts: Date.now() });
    } else if (e.kind === 'image') {
      // A generated image (🎨 voices). Rides the reply bubble's existing attachment
      // rendering; saveHistory already strips dataURLs before persisting, so a big
      // image never lands in localStorage — same lifecycle as attached images.
      const img = { kind: 'image', dataUrl: e.text, name: 'generated image', size: e.text.length };
      if (lastReply) {
        (lastReply.attachments ??= []).push(img);
      } else {
        lastReply = { role: 'aukora', text: '', attachments: [img], ts: Date.now() };
        targetHistory.push(lastReply);
      }
    } else {
      lastReply = { role: 'aukora', text: e.text, ts: Date.now() };
      targetHistory.push(lastReply);
    }
  }
}

// The attachment frame is now built SERVER-SIDE (voiceLane.buildAttachmentFrames, issue #53): the
// client sends owner_text + the attachments channel raw, and the door assembles the trusted, escaped
// frame. The old client-side buildOutbound() was removed — a client-built frame is spoofable and let
// attachment content reach the grammar. The composer still renders attachment chips locally via
// renderAttachRow(); only the wire framing moved.

// DETOKENIZED (AURA lane round 1): no numeric aura toast — a real exchange pulses
// the coherence glyph via aura-core's numberless 'aura-changed' event; the app-wide
// glow + KNVS ripple carry the feel. AURA is a pattern, never a number.

// App Lab: when the lab organ is open, the normal Aukora thread drives the blank center surface instead
// of the governed loop. You type, the center changes — the "talk at the screen, the screen changes"
// surface. Three modes:
//   • direct   — text starting with '<' or 'html:' renders literally (works with NO model key — proof the pipe is live)
//   • ask her  — anything else asks Auma for an HTML fragment; the first ```html block (or raw html) renders.
//                LONG-HORIZON: her CURRENT build rides along in the prompt, so each turn EVOLVES the
//                canvas instead of starting over — she can grow a whole app across many messages.
//   • submit   — "submit" / "ship it" / "propose this" hands the finished build to her governed seat
//                to draft a proposal intent, so it lands at the AUMLOK gate for the owner's signature.
// The playground renders PIXELS on a preview surface (sandboxed iframe) — never files, never authority.
// Governed self-mod stays on the AUMLOK path; submit only DRAFTS, the gate still decides.
async function driveCanvas(text) {
  history.push({ role: 'you', text, attachments: [], ts: Date.now() });
  saveHistory(openThreadId, history);
  renderMessages();
  window.dispatchEvent(new CustomEvent('open-organ', { detail: APP_LAB_ORGAN }));

  const direct = text.trim();
  const paint = (html) => window.dispatchEvent(new CustomEvent('aukora:canvas', { detail: { html } }));
  if (direct.startsWith('<') || direct.toLowerCase().startsWith('html:')) {
    const html = direct.toLowerCase().startsWith('html:') ? direct.slice(5).trim() : direct;
    paint(html);
    history.push({ role: 'aukora', text: '▸ rendered to App Lab (direct).', kind: 'msg-info' });
    saveHistory(openThreadId, history); renderMessages();
    return;
  }

  const current = String(window.__aukoraCanvasLast || '');
  const submitMode = /^(submit|ship( it| this)?|propose( it| this)?)\b/i.test(direct);
  if (submitMode && !current) {
    history.push({ role: 'aukora', text: 'App Lab is blank — build something first, then say "submit" to send it to the gate.', kind: 'msg-info' });
    saveHistory(openThreadId, history); renderMessages();
    return;
  }

  setTyping(true); pending = true; sendBtn.disabled = true;
  try {
    // The design brief makes ask-mode render APP-NATIVE: whatever she draws on the canvas should look
    // like it grew here — the same trinity grammar as spatial/app/style.css, not generic white-page HTML.
    const designBrief = 'Render it in Aukora\'s own design language. The canvas sits on the app\'s soft gray-blue stage '
      + '(transparent background — never paint a solid page fill, and NEVER flat black). House hues as rgb triplets: green 129,212,180 · '
      + 'blue 150,180,255 · purple 196,170,255 — used as low-alpha rgba() accents, borders and glows, never solid brand fills. '
      + 'Their meaning: green is nature and ground (root), blue is connection between people (unite), purple is higher purpose (rise) — '
      + 'pick the hue that matches what an element is FOR. '
      + 'Surfaces are glass: rgba(255,255,255,0.03-0.06) fills with 1px rgba(255,255,255,0.08-0.14) borders, '
      + 'border-radius 10-14px, soft outer glows like 0 0 18px rgba(150,180,255,0.25). '
      + 'Text rgba(244,246,255,0.92), dim text rgba(228,232,248,0.6); ui-sans-serif/system-ui, ui-monospace for numbers and code. '
      + 'Buttons are telescoping portals: pill-shaped glass, hue border, faint outer rings that appear on hover — corners are verbs. '
      + 'Build it as carefully as a native organ of the app.';
    let ownerText;
    if (submitMode) {
      // hand the build to her governed seat — she drafts the intent, rehearsal + gate stay in charge
      ownerText = 'Owner directive from the Canvas playground: the build below is ready to leave the playground. '
        + 'Use your governed tools to draft a proposal intent (propose_intent) that adds it to the app, '
        + 'so it lands at the AUMLOK gate for my signature. State the goal in plain words. The build:\n'
        + '```html\n' + current.slice(0, 20000) + '\n```\n'
        + 'Owner\'s words: "' + text + '"';
    } else {
      const contextBlock = current
        ? 'The canvas CURRENTLY holds your previous build:\n```html\n' + current.slice(0, 12000) + '\n```\n'
          + 'EVOLVE it — keep what works, change what the owner asks, and return the ENTIRE updated fragment (never a diff, never a partial). '
        : 'The canvas is blank — this is the first stroke. ';
      ownerText = 'You are building INSIDE the owner\'s app, Aukora, on its canvas playground. This is LONG-HORIZON work: '
        + 'you may be asked to grow this into a whole app over many turns, so structure your markup and <script> state to be grown. '
        + designBrief + ' ' + contextBlock
        + 'The owner now says: "' + text + '". Reply with ONE complete self-contained HTML fragment '
        + '(a <style> tag and <script> allowed; keep state in JS variables) inside a single ```html code block. No explanation outside the block.';
    }
    const res = await fetch(`${CHAT_DOOR}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_text: ownerText, model: voiceId }),
    });
    const data = await res.json();
    const reply = (Array.isArray(data.entries) ? data.entries : []).filter((e) => e.kind === 'info' && e.text).map((e) => e.text).join('\n');
    if (submitMode) {
      history.push({ role: 'aukora', text: reply || 'no answer came back from her seat — is the chat door up and your key set?', kind: 'msg-info' });
      history.push({ role: 'aukora', text: '▸ if she drafted the intent, it rehearses and then waits at the AUMLOK gate — nothing applies without your signature.', kind: 'msg-info' });
    } else {
      const m = reply.match(/```html\s*([\s\S]*?)```/i) || reply.match(/(<[\s\S]+>)/);
      if (m) {
        paint(m[1].trim());
        history.push({ role: 'aukora', text: '▸ rendered to App Lab' + (current ? ' (evolved from the last build).' : '.'), kind: 'msg-info' });
      } else {
        history.push({ role: 'aukora', text: reply || 'no App Lab content came back — try "html: <h1>hello</h1>" to prove the pipe, or set your key in Settings.', kind: 'msg-info' });
      }
    }
    saveHistory(openThreadId, history); renderMessages();
  } catch (err) {
    history.push({ role: 'aukora', text: 'App Lab could not reach the chat door: ' + (err && err.message || err), kind: 'msg-error' });
    saveHistory(openThreadId, history); renderMessages();
  } finally { setTyping(false); pending = false; sendBtn.disabled = false; }
}

async function send(text) {
  if (openThreadId === 'dev-canvas' || (openThreadId === 'aukora-main' && activeOrganKey === APP_LAB_ORGAN)) {
    await driveCanvas(text);
    return;
  }
  const threadId = openThreadId;
  const sentAttachments = attachments;
  attachments = [];
  renderAttachRow();

  history.push({ role: 'you', text, attachments: sentAttachments, ts: Date.now() });
  saveHistory(threadId, history);
  renderMessages();
  setTyping(true, { council: voiceId === 'fusion-council' });
  pending = true;
  sendBtn.disabled = true;
  let replies = [];
  try {
    // Typed turn envelope (issue #53): send the owner's typed text and the attachments as SEPARATE
    // channels — the door assembles the trusted, escaped frame server-side. The client no longer
    // pre-mixes owner text + attachment frames (that was spoofable and let a file reach the grammar).
    const images = sentAttachments
      .filter((a) => a.kind === 'image' && a.dataUrl)
      .map((a) => a.dataUrl);
    const fileAttachments = sentAttachments
      .filter((a) => a.kind !== 'image')
      .map((a) => ({ name: a.name, mime: a.mime, size: a.size, kind: a.kind, text: a.text, truncated: a.truncated }));
    const res = await fetch(`${CHAT_DOOR}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_text: text, attachments: fileAttachments, model: voiceId, images }),
    });
    const data = await res.json();
    if (Array.isArray(data.entries)) {
      pushEntries(data.entries, replies);
      // A real, door-acknowledged exchange registers as a qualifying act: aura-core
      // gates it (length/format, repeat, burst) and pulses the glyph — numberless.
      // A door reply is client-observed, NOT witnessed; nothing is counted.
      award('message', { text });
    } else {
      replies.push({ role: 'aukora', text: `the loop answered ${res.status} with no transcript`, kind: 'msg-error' });
    }
  } catch {
    replies.push({
      role: 'aukora',
      text: 'the chat door isn’t running. Start it in a terminal:\n  bun spatial/chat-serve.ts\nthen send that again.',
      kind: 'msg-error',
    });
  }
  pending = false;
  setTyping(false);
  // Land replies in the thread they belong to, even if the user navigated away.
  if (openThreadId === threadId) {
    history.push(...replies);
    saveHistory(threadId, history);
    renderMessages();
  } else {
    const other = loadHistory(threadId);
    other.push(...replies);
    saveHistory(threadId, other);
    const t = threadById(threadId);
    if (t) { t.unread = true; saveThreads(); renderThreads(); }
  }
  syncSend();
}

// ---------------------------------------------------------------------------
// Composer: autogrow (capped), Enter sends, Shift+Enter newline.
// ---------------------------------------------------------------------------

function syncSend() {
  sendBtn.disabled = pending || (input.value.trim() === '' && attachments.length === 0);
  renderVoicePill(); // image attached + blind voice → pill warns
}

function autogrow() {
  input.style.height = 'auto';
  const max = 150; // ~7 lines, then scroll
  input.style.height = Math.min(input.scrollHeight, max) + 'px';
  input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
}

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.replace(/^\n+|\s+$/g, '');
  if ((!text && attachments.length === 0) || pending) return;
  input.value = '';
  autogrow();
  sendBtn.disabled = true;
  send(text);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
input.addEventListener('input', () => {
  syncSend();
  autogrow();
});

// Programmatic ask from another lane (e.g. Luminara's "Ask Auma to read this").
// Rides the SAME governed path as a typed message: opens the live Aukora thread
// and sends through the door. This lane invents nothing, applies nothing, and only
// forwards text.
//
// TRUST BOUNDARY (named, not implicit): a send BILLS a real model call, so it must
// be owner-initiated. We require transient user-activation — the actual click that
// dispatched this event. A stray or scripted dispatch with no live user gesture is
// refused. Where the API is unavailable we fall back to same-origin trust (the whole
// page is our own code). This is defence-in-depth, not a same-origin escape hatch.
window.addEventListener('aukora:ask', (e) => {
  const text = e.detail && typeof e.detail.text === 'string' ? e.detail.text.trim() : '';
  if (!text || pending) return;
  const ua = navigator.userActivation;
  if (ua && ua.isActive === false) return; // no real user gesture behind this send
  openChat('aukora-main');           // land the reply in the live conversation
  if (openThreadId !== 'aukora-main') return; // no live thread to land in — do nothing
  send(text);
});

renderThreads();
