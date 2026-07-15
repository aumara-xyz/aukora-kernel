// Aukora Spatial — AUMLOK screen: the gate, where your signature lands.
//
// OBSERVER / HELPER ONLY. This screen can SHOW you what is waiting and hand you
// the command to run — it can NEVER sign, apply, hold your key, or mutate state.
// There is no key field, no phrase field, and no live apply button anywhere here,
// by design. Signing happens in your terminal, on your machine, with your key.
// The device-local signing gate (#105b) now exists as a SEPARATE, gated-off-by-default
// door (127.0.0.1:7094) so this observer keeps its "no write lane" invariant intact;
// this screen only POINTS to that gate, it never becomes it.
//
// Data is MOCK (spatial/app/mock/aumlok.js). loadAumlokState() is the single seam
// engineering swaps for a read of the real READ-ONLY GET /api/aumlok.

import { AUMLOK, PROPOSALS } from '/app/mock/aumlok.js'; // FALLBACK ONLY — used if the live endpoint is unreachable
import { stateChip, STATE_META } from '/app/ui/states.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// #105 read layer: fetch the REAL read-only AUMLOK view (GET /api/aumlok → buildAumlokAssistantView).
// This grants nothing — the endpoint reads pending proposals + status and returns the exact terminal
// commands; it can never sign, apply, or hold a key. On any failure we fall back to the mock, clearly
// labelled, so the screen never lies about whether it is showing live data.
async function loadAumlokView() {
  const res = await fetch('/api/aumlok', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('endpoint status ' + res.status);
  const view = await res.json();
  if (!view || view.error || view.schema !== 'aumlok-signing-assistant-v1') throw new Error('unexpected view');
  return view;
}

// Map the real status snapshot → the fields the vault crest renders.
function mapStatus(st) {
  return {
    keyPresent: !!st.keyPresent,
    keyId: st.keyId || '—',
    publicRootPinned: !!st.publicRootPinned,
    signerVerifierSplitIntact: !!st.signerVerifierSplitIntact,
    livePromotionUnlocked: false, // literal — never a blanket unlock
    appliedCount: st.appliedProposalCount ?? 0,
    rehearsalReceipts: st.rehearsalReceiptCount ?? 0,
  };
}

// Map a real pending proposal → the card's render shape. A pending artifact is signature-ready ('ready')
// unless it failed validation ('locked' — do not sign).
function mapProposal(p) {
  return {
    hash: (p.proposalHash || '').slice(0, 12),
    fullHash: p.proposalHash || '',
    goal: p.goal || '(no goal)',
    files: Array.isArray(p.files) ? p.files.length : 0,
    fileSafeties: Array.isArray(p.files) ? p.files : [], // per-file shrink verdicts (#91)
    state: p.valid ? 'ready' : 'locked',
    riskHint: p.riskHint || '',
    invalidReason: p.invalidReason || null,
    anyShrinkWarning: !!p.anyShrinkWarning,
    preview: Array.isArray(p.preview) ? p.preview : [],
    signCommand: p.signCommand || '',
    applyHint: p.applyHint || '',
    author: 'Auma',
  };
}

// house hue by position (green → blue → purple), matching the rest of the site.
const hueByIndex = (i) => (i <= 1 ? 'l' : i <= 3 ? 'c' : 'r');

// a padlock sigil drawn in SVG (gradient/colour via CSS currentColor) — not an emoji.
function lockSVG(locked) {
  const shackle = locked
    ? '<path d="M15 21v-6a9 9 0 0 1 18 0v6"/>'
    : '<path d="M15 21v-6a9 9 0 0 1 15.6-6.4"/>';
  return `<svg viewBox="0 0 48 46" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shackle}<rect x="11" y="21" width="26" height="19" rx="4.5"/><circle cx="24" cy="29.5" r="2.6" fill="currentColor" stroke="none"/><path d="M24 32.2v4"/></svg>`;
}

// The steps, compact and colored (owner directive 2026-07-08): green → blue → purple → amber.
// Reads-then-proposes folded into one step; "You approve" is the owner's move and carries the glow.
const TRUST = [
  ['l', 'Auma proposes'],
  ['c', 'You approve'],
  ['r', 'Your key signs'],
  ['o', 'Alive — receipted'],
];

export async function mountAumlok(root) {
  injectStyle();
  let s, proposals, live = true;
  try {
    const view = await loadAumlokView();
    s = mapStatus(view.status || {});
    proposals = (view.pending || []).map(mapProposal);
  } catch (e) {
    // endpoint unreachable → fall back to the mock, and SAY SO (never pretend mock is live)
    live = false;
    s = { ...AUMLOK };
    proposals = PROPOSALS.slice().map((p) => ({ ...p, signCommand: '', applyHint: '', preview: [] }));
  }
  const app = el('div', 'aum-app');

  // ---- header (slim; wordmark only, no icon) ----
  const head = el('div', 'aum-head');
  const brand = el('div', 'aum-brand');
  brand.append(el('div', 'aum-name', 'AUMLOK'), el('div', 'aum-tag', 'the gate — where your signature lands'));
  head.append(brand);
  head.append(el('div', 'aum-observer', live ? 'observer only · live' : 'observer only · offline (sample data)'));
  app.append(head);

  const scroll = el('div', 'aum-scroll');
  app.append(scroll);

  // ---- the vault crest: status + the SHAPE of the key (design-only; never the secret) ----
  const locked = !s.livePromotionUnlocked;   // sealed by default
  const vault = el('div', 'aum-vault ' + (locked ? 'locked' : 'unlocked'));

  const vtop = el('div', 'aum-vault-top');
  const lock = el('div', 'aum-lock'); lock.innerHTML = lockSVG(locked);
  vtop.append(lock);
  const vstat = el('div', 'aum-vstat');
  vstat.append(
    el('div', 'aum-vstate', locked ? 'LOCKED' : 'UNLOCKED'),
    el('div', 'aum-vsub', locked ? 'sealed — nothing signs without your key' : 'an authorized session is open'),
  );
  vtop.append(vstat);
  const vkey = el('div', 'aum-vkey');
  vkey.append(
    el('div', 'aum-vkey-k', s.keyPresent ? 'key present' : 'no key yet'),
    el('div', 'aum-vkey-f', s.keyPresent ? s.keyId : '—'),
  );
  vtop.append(vkey);
  vault.append(vtop);

  // Unbound node → the NATIVE binding ceremony, IN-PLACE (owner directive 2026-07-08: no separate
  // tab, no URL change — the ceremony renders inside this organ). Same posture as the approval-gate
  // embed below: the bind door (:7095) runs in its OWN origin inside the iframe, so this read-only
  // observer never gains a write lane; the frame simply IS the ceremony. Probed first — a node whose
  // door is down (older start / already closed after binding) degrades to an honest note.
  if (!s.keyPresent) {
    const bindWrap = el('div', 'aum-bind');
    bindWrap.setAttribute('data-operate-forbid', ''); // FENCE: the binding/keygen ceremony is never operable
    const bindUrl = 'http://127.0.0.1:7095/';
    fetch(bindUrl, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(900) })
      .then(() => {
        bindWrap.append(el('div', 'aum-gate-h', 'The binding ceremony'));
        bindWrap.append(el('div', 'aum-bind-sub',
          'A key is born on this machine, you receive your phrase, you speak it back — and this node becomes yours. Right here.'));
        const frame = document.createElement('iframe');
        frame.className = 'aum-bind-frame';
        frame.src = bindUrl;
        frame.title = 'AUMLOK binding ceremony';
        bindWrap.append(frame);
      })
      .catch(() => {
        bindWrap.append(el('div', 'aum-bind-sub',
          'The binding door is not up on this node — restart the node (bun run start) and the ceremony appears here.'));
      });
    vault.append(bindWrap);
  }

  // Your signing phrase — the ONE ceremony (create + rotate), embedded from the binding door (:7095).
  // The old decorative masked-dot slots are gone (they did nothing). This panel actually creates and
  // rotates your phrase — the human face of your key — like resetting a password, on your machine.
  const phraseWrap = el('div', 'aum-phrase-wrap');
  phraseWrap.setAttribute('data-operate-forbid', ''); // FENCE: Auma's operate_ui hands never touch the phrase surface
  phraseWrap.append(el('div', 'aum-crest-k', 'your signing phrase'));
  const phraseSlot = el('div', 'aum-phrase-slot');
  phraseWrap.append(phraseSlot);
  vault.append(phraseWrap);
  mountPhrasePanel(phraseSlot);

  // honest security ticks, kept compact under the crest
  const ticks = el('div', 'aum-ticks');
  ticks.append(
    tick(s.publicRootPinned, 'public root pinned'),
    tick(s.signerVerifierSplitIntact, 'signer / verifier split intact'),
    tick(!s.livePromotionUnlocked, 'live promotion locked'),
  );
  vault.append(ticks);

  scroll.append(vault);

  // ---- trust rail ----
  const trust = el('div', 'aum-trust');
  trust.append(el('div', 'aum-trust-label', 'How a change becomes real'));
  const steps = el('div', 'aum-steps');
  TRUST.forEach(([hue, label], i) => {
    const st = el('div', 'aum-step s-' + hue + (hue === 'c' ? ' yours' : ''));
    st.append(el('div', 'aum-step-n', String(i + 1)), el('div', 'aum-step-l', label));
    steps.append(st);
  });
  trust.append(steps);
  scroll.append(trust);

  // ---- the approval panel: the SEPARATE local gate (:7094), embedded here as the SINGLE approval
  // surface. (Owner directive 2026-07-08: the old duplicate observer cards below it are GONE — the same
  // proposal was showing twice, once here and once in the embedded gate. One surface now.)
  // The observer (this page, :7090) can NEVER approve — its door refuses writes, by design. Approving
  // happens on the gate at :7094, which runs in its OWN origin inside this iframe: this page cannot read
  // into it or drive its approve API (cross-origin isolation), so the "no write lane" invariant holds.
  const readyCount = proposals.filter((p) => p.state === 'ready').length;
  const gate = el('div', 'aum-gate');
  gate.setAttribute('data-operate-forbid', ''); // FENCE: the approval surface is never operable by Auma's hands
  gate.append(el('div', 'aum-gate-h', proposals.length
    ? 'At the gate · ' + proposals.length + ' waiting' + (readyCount ? ', ' + readyCount + ' ready for you' : '')
    : 'At the gate · nothing waiting on you'));
  gate.append(el('div', 'aum-gate-note',
    'Each waiting change is a portal button below — open it, read it, and type the short phrase to sign. Your key signs locally, on your machine; this page only shows it, it can never sign for you.'));
  const gateSlot = el('div', 'aum-gate-slot');
  gate.append(gateSlot);
  scroll.append(gate);
  mountGatePanel(gateSlot);

  // ---- the history rail: four full-width portal rows, read-only, content-free ----
  const history = el('div', 'aum-history');
  history.setAttribute('data-operate-forbid', ''); // FENCE: a read-only record surface, never operable
  const hHead = el('div', 'aum-history-head');
  hHead.append(el('div', 'aum-history-title', 'The record'));
  const hRefresh = el('button', 'aum-history-refresh', 'refresh');
  hHead.append(hRefresh);
  history.append(hHead);
  const historySlot = el('div', 'aum-history-slot');
  history.append(historySlot);
  scroll.append(history);
  mountHistoryPanel(historySlot);
  hRefresh.addEventListener('click', () => mountHistoryPanel(historySlot));

  // ---- closing honesty ----
  const foot = el('div', 'aum-foot');
  foot.append(el('p', null,
    'This screen is an observer. It shows you what’s waiting — it can never sign, apply, or hold your key. Approving happens on your local gate (the button above); your key signs there, on your machine, alone.'));
  foot.append(el('p', 'aum-foot-dim',
    'The gate is a separate local door (127.0.0.1:7094) so this observer can never become the thing that signs. One proposal, one phrase, one signature — nothing here can shortcut it.'));
  scroll.append(foot);

  root.append(app);
}

// The record — four full-width portal rows (Awaiting / Applied / Rejected / Archived) sourced from the
// read-only GET /api/aumlok/history projection. This surface NEVER signs, applies, or exposes any phrase
// or key material; a row telescopes open to show ONLY the bounded metadata the endpoint already returns
// (short hash, date, and — for awaiting — goal + file count; for applied — commit/receipt). Re-reads
// truth on refresh; a missing/empty category shows an honest empty state.
const HISTORY_META = [
  ['awaiting', 'l', 'Awaiting', 'drafted and rehearsed — waiting for your signature'],
  ['applied', 'o', 'Applied', 'signed by your key and live'],
  ['rejected', 'r', 'Rejected', 'you declined these — archived, never signed'],
  ['archived', 'c', 'Archived', 'shelved or superseded by a later draft'],
];

async function mountHistoryPanel(slot) {
  slot.innerHTML = '';
  slot.append(el('div', 'aum-history-loading', 'reading the record…'));
  let h;
  try {
    const res = await fetch('/api/aumlok/history', { headers: { accept: 'application/json' } });
    h = await res.json();
    if (!h || h.error || h.schema !== 'aumlok-history-v1') throw new Error('unexpected');
  } catch {
    slot.innerHTML = '';
    slot.append(el('div', 'aum-history-empty', 'the record isn’t reachable — start the node (bun run start) to see your proposal history.'));
    return;
  }
  slot.innerHTML = '';
  if (Array.isArray(h.notes)) for (const n of h.notes) slot.append(el('div', 'aum-history-note', n));
  for (const [key, hue, label, sub] of HISTORY_META) {
    const rows = Array.isArray(h[key]) ? h[key] : [];
    // a true full-width portal row on hairlines (owner rule: no cards/boxes inside the frame) —
    // the crest's own spine grammar: square hue tile with masked dot · label+sub · restrained count
    const row = el('div', 'aum-hrow h-' + hue);
    const bar = el('div', 'aum-hrow-bar');
    const tile = el('div', 'aum-hrow-tile');
    tile.append(el('span', 'aum-hrow-dot', '•'));
    bar.append(tile);
    const text = el('div', 'aum-hrow-text');
    text.append(el('div', 'aum-hrow-label', label));
    text.append(el('div', 'aum-hrow-sub', sub));
    bar.append(text);
    bar.append(el('div', 'aum-hrow-count', String((h.counts && h.counts[key]) || rows.length || 0)));
    bar.append(el('span', 'aum-hrow-fold', '▸'));
    row.append(bar);
    const detail = el('div', 'aum-hrow-detail');
    if (!rows.length) {
      detail.append(el('div', 'aum-hrow-none', 'none yet'));
    } else {
      for (const r of rows) {
        const item = el('div', 'aum-hitem');
        const line1 = el('div', 'aum-hitem-top');
        line1.append(el('code', 'aum-hitem-hash', r.shortHash || ''));
        if (r.at) line1.append(el('span', 'aum-hitem-at', String(r.at).slice(0, 10)));
        if (r.valid === false) line1.append(el('span', 'aum-hitem-flag', 'tampered — do not sign'));
        item.append(line1);
        if (r.goal) item.append(el('div', 'aum-hitem-goal', r.goal));
        const meta = [];
        if (typeof r.fileCount === 'number') meta.push(r.fileCount + ' file' + (r.fileCount === 1 ? '' : 's'));
        if (r.commitSha) meta.push('commit ' + String(r.commitSha).slice(0, 12));
        if (r.receiptHash) meta.push('receipt ' + String(r.receiptHash).slice(0, 12));
        if (r.subKind) meta.push(r.subKind);
        if (meta.length) item.append(el('div', 'aum-hitem-meta', meta.join(' · ')));
        detail.append(item);
      }
    }
    row.append(detail);
    // telescope: the bar toggles the bounded detail open; nothing here signs or applies
    let open = false;
    bar.style.cursor = 'pointer';
    bar.addEventListener('click', () => { open = !open; detail.classList.toggle('on', open); row.classList.toggle('open', open); });
    slot.append(row);
  }
}

function tick(ok, label) {
  const t = el('div', 'aum-tick ' + (ok ? 'ok' : 'warn'));
  t.append(el('span', 'aum-tick-m', ok ? '✓' : '!'), el('span', null, label));
  return t;
}

const GATE_URL = 'http://127.0.0.1:7094';   // the APPROVAL gate — proposal signing only (untouched)
const BIND_URL = 'http://127.0.0.1:7095';   // the BINDING door — the ONE phrase ceremony (create + rotate)

// Content-driven ceremony frame height (visual only — bind-visual-repair round). The bind page posts a
// content-free {type,height} as its steps change; we accept it ONLY when it comes from the bind door's
// origin AND from the embedded frame itself, and clamp hard, so the framed ceremony never shows a dead
// vertical field — and a hostile message can never blow the layout up. Nothing is read back into the frame.
window.addEventListener('message', (e) => {
  if (e.origin !== BIND_URL) return;
  const d = e.data;
  if (!d || d.type !== 'aumlok-bind-size' || typeof d.height !== 'number' || !Number.isFinite(d.height)) return;
  const h = Math.max(220, Math.min(780, Math.ceil(d.height)));
  for (const f of document.querySelectorAll('.aum-bind-frame, .aum-phrase-frame')) {
    if (f.contentWindow !== e.source) continue;
    f.style.height = h + 'px';
    const slot = f.closest('.aum-mini-ceremony');
    if (slot && slot.classList.contains('on')) slot.style.maxHeight = (h + 24) + 'px';
  }
});

// The signing-phrase crest (owner directive 2026-07-08: kill the blank space; show the SHAPE).
// A COMPACT masked mini-acrostic — the vertical anchor spine + dotted words (green·green / blue·blue /
// purple·purple = ROOT·UNITE·RISE) — representing your phrase WITHOUT ever holding it (the real words
// live only on the ceremony door). Plus the phrase status. Canonical-ceremony round (#242): the
// create/rotate ceremony is the binding door at :7095 (the retired :7094/phrase panel is gone). Posture
// drives the label — unbound → Create, sovereign → Rotate. The tall iframe telescopes open ONLY when you
// tap the button, so the crest stays tight.
async function mountPhrasePanel(slot) {
  // masked shape — pure decoration, never the real phrase
  const spine = el('div', 'aum-mini-spine');
  const hueRow = (i) => (i < 2 ? 'l' : i < 4 ? 'c' : 'r');
  const wordLen = [4, 5, 5, 6, 4, 5];
  for (let i = 0; i < 6; i++) {
    const row = el('div', 'aum-mini-row h-' + hueRow(i));
    const tile = el('div', 'aum-mini-tile'); tile.append(el('span', 'aum-mini-dot', '•'));
    row.append(tile);
    const word = el('div', 'aum-mini-word');
    for (let d = 0; d < wordLen[i]; d++) word.append(el('i', 'aum-mini-cell'));
    row.append(word);
    spine.append(row);
  }
  const statusEl = el('div', 'aum-mini-status', 'checking your phrase…');
  const actionWrap = el('div', 'aum-mini-action');
  const btn = el('button', 'aum-mini-btn', 'Refresh my phrase');
  actionWrap.append(btn);
  const ceremonySlot = el('div', 'aum-mini-ceremony');
  // two columns: masked spine LEFT-justified, status + refresh on the RIGHT (fills the floating space)
  const layout = el('div', 'aum-mini-layout');
  const rightCol = el('div', 'aum-mini-right');
  rightCol.append(statusEl, actionWrap);
  layout.append(spine, rightCol);
  slot.append(layout);
  slot.append(ceremonySlot);

  // read POSTURE only (never the phrase) from the binding door — sovereign = a phrase stands.
  try {
    const st = await fetch(BIND_URL + '/api/bind/status').then((r) => r.json());
    if (st && st.posture === 'sovereign') {
      statusEl.textContent = 'your phrase is set — rotate it any time (you’ll speak the current one first)';
      btn.textContent = 'Rotate my phrase';
      // #288 bridge — the standing AURA footprint, read-only and content-free: the same silver
      // trefoil + the NAMED state from the door's origin-checked genesis endpoint. It reads no
      // phrase/key/fingerprint/KDF/attempt material and renders no number, reference, score, or
      // humanity claim — and on any failure it simply does not render (honest absence).
      try {
        const g = await fetch(BIND_URL + '/api/bind/genesis').then((r) => r.json());
        if (g && g.present === true && g.base && g.base.state === 'silver') {
          const foot = el('div', 'aum-genesis-foot');
          const mark = document.createElement('img');
          mark.src = '/assets/aumara-icon-96.png'; mark.alt = ''; mark.className = 'aum-genesis-mark';
          foot.append(mark, el('span', 'aum-genesis-word', 'silver · genesis'));
          rightCol.prepend(foot);
        }
      } catch { /* honest absence */ }
    } else {
      statusEl.textContent = 'no phrase set yet — create one to say “yes, this is me” and bind this node';
      btn.textContent = 'Create my phrase';
      spine.classList.add('empty');
    }
  } catch {
    statusEl.textContent = 'the binding door isn’t up — start the node (bun run start) to create or rotate your phrase';
    btn.disabled = true;
  }

  // telescope the real ceremony open on demand (only then does the tall iframe mount).
  // The binding door (:7095) auto-detects posture: unbound → the first-binding flow; sovereign → the
  // current-phrase → new-acrostic → type-back rotation flow. The retired :7094/phrase page is never used.
  let open = false;
  btn.addEventListener('click', async () => {
    if (open) { ceremonySlot.innerHTML = ''; ceremonySlot.classList.remove('on'); ceremonySlot.style.maxHeight = ''; open = false; btn.classList.remove('active'); return; }
    let up = false;
    try { await fetch(BIND_URL + '/', { mode: 'no-cors', cache: 'no-store' }); up = true; } catch { up = false; }
    if (!up) { statusEl.textContent = 'the binding door isn’t running — start the node (bun run start) and try again'; return; }
    const frame = document.createElement('iframe');
    frame.className = 'aum-phrase-frame';
    frame.src = BIND_URL + '/';
    frame.title = 'AUMLOK phrase ceremony';
    ceremonySlot.append(frame);
    ceremonySlot.classList.add('on'); open = true; btn.classList.add('active');
  });
}

// Embed the local gate (:7094) in-place after a reachability probe. The iframe runs at the gate's OWN
// origin — this observer page cannot read into it or drive its approve API, so it stays read-only; the
// frame simply IS the gate, shown here instead of a new tab. A node without the gate degrades to a note.
async function mountGatePanel(slot) {
  slot.append(el('div', 'aum-gate-probe', 'connecting to your local gate…'));
  let up = false;
  try { await fetch(GATE_URL + '/', { mode: 'no-cors', cache: 'no-store' }); up = true; } catch { up = false; }
  slot.innerHTML = '';
  if (up) {
    const frame = document.createElement('iframe');
    frame.className = 'aum-gate-frame';
    frame.src = GATE_URL;
    frame.title = 'AUMLOK approval gate';
    slot.append(frame);
    const openNew = el('a', 'aum-gate-open', 'open in its own tab ↗');
    openNew.href = GATE_URL; openNew.target = '_blank'; openNew.rel = 'noopener noreferrer';
    slot.append(openNew);
  } else {
    const off = el('div', 'aum-gate-off');
    off.append(el('div', null, 'The approval gate isn’t running on this node.'));
    off.append(el('div', 'aum-foot-dim', 'On an owner node, start the aumlok-approve server and reload. A contributor node has no approval gate, by design.'));
    slot.append(off);
  }
}

function proposalCard(p) {
  const meta = STATE_META[p.state] || STATE_META.locked;
  const card = el('div', 'aum-card tone-' + meta.tone);
  const top = el('div', 'aum-card-top');
  const left = el('div', 'aum-card-l');
  left.append(el('div', 'aum-card-goal', p.goal));
  left.append(el('div', 'aum-card-meta', '#' + p.hash + ' · ' + p.files + ' file' + (p.files === 1 ? '' : 's') +
    ' · authored by ' + (p.author || 'Auma')));
  top.append(left);
  top.append(stateChip(p.state));
  card.append(top);

  if (p.riskHint) card.append(el('div', 'aum-card-risk', p.riskHint));
  if (p.invalidReason) card.append(el('div', 'aum-card-risk warn', 'INVALID — ' + p.invalidReason + '. Do not sign.'));

  // #91 loud shrink warning — the stale-proposal tell. NEVER folded away, here or on the gate.
  const shrinks = (p.fileSafeties || []).filter((f) => f && f.shrinkWarning);
  if (shrinks.length) {
    const sb = el('div', 'aum-shrink');
    sb.append(el('div', 'aum-shrink-h', '⚠ Removes lines from an existing file'));
    for (const f of shrinks) {
      sb.append(el('div', 'aum-shrink-f', f.relPath + ':  ' + f.beforeLines + ' → ' + f.afterLines + ' lines  (removes ' + (f.beforeLines - f.afterLines) + ')'));
    }
    sb.append(el('div', 'aum-shrink-n', 'A small or comment-only change should not shrink a file — this is the shape of a stale proposal rewinding a file. Open the full change below before approving.'));
    card.append(sb);
  }

  const help = el('div', 'aum-card-help');
  if (p.state === 'ready') {
    // The in-shell gate above (the embedded approve panel) is the signing path now — click Approve
    // there and type the phrase. The terminal commands remain available as a fallback, tucked behind
    // a disclosure so they never read as a second required step (owner feedback 2026-07-08).
    help.append(el('div', 'aum-help-note', 'Ready for your signature — approve it at the gate above (click Approve, type the phrase). Your key signs there, on your machine.'));
    if (p.signCommand) {
      const det = document.createElement('details');
      det.className = 'aum-term-fallback';
      const sum = document.createElement('summary');
      sum.textContent = 'prefer the terminal? (optional fallback)';
      det.append(sum, ceremony(p));
      help.append(det);
    } else {
      help.append(el('div', 'aum-help-note aum-foot-dim', '(offline sample — the exact commands appear when the live gate is reachable)'));
    }
  } else {
    help.append(el('div', 'aum-help-note', (meta.note || 'in the sandbox') + '.'));
  }
  card.append(help);

  // the fold (owner directive 2026-07-08: the simple face shows no code) — the #105 bounded,
  // secret-scanned diff preview and the terminal ceremony live here, one tap away, never gone.
  const fold = el('details', 'aum-fold');
  fold.append(el('summary', null, 'open the full change — diff & terminal ceremony'));
  for (const pv of (p.preview || [])) {
    if (pv.refusedReason) { fold.append(el('div', 'aum-card-risk warn', 'preview withheld: ' + pv.refusedReason)); continue; }
    if (!pv.hunk) continue;
    fold.append(diffBlock(pv));
  }
  if (p.line && !(p.preview || []).length) fold.append(el('pre', 'aum-card-line', p.line)); // mock fallback
  if (p.state === 'ready') {
    if (p.signCommand) fold.append(ceremony(p));
    else fold.append(el('div', 'aum-help-note aum-foot-dim', '(offline sample — the exact commands appear when the live gate is reachable)'));
  }
  card.append(fold);
  return card;
}

// Render one bounded diff hunk, coloring +/- lines. The text is server-produced (secret-scanned, capped).
function diffBlock(pv) {
  const wrap = el('div', 'aum-diff');
  const pre = el('pre', 'aum-diff-pre');
  for (const raw of String(pv.hunk).split('\n')) {
    const cls = raw[0] === '+' ? 'add' : raw[0] === '-' ? 'del' : raw.startsWith('@@') ? 'hh' : 'ctx';
    pre.append(el('div', 'aum-diff-l ' + cls, raw));
  }
  wrap.append(pre);
  const notes = [];
  if (pv.truncated) notes.push('preview truncated');
  if (pv.secretRedacted) notes.push('a secret-shaped line was withheld');
  if (notes.length) wrap.append(el('div', 'aum-diff-note', notes.join(' · ')));
  return wrap;
}

// The ceremony helper: the REAL copyable terminal commands from the governed view. It copies text only —
// it does not sign, hold a key, or apply. Two steps: sign (in your terminal), then apply (in the workbench).
function cmdBox(cmd, label) {
  const wrap = el('div', 'aum-cmd-wrap');
  if (label) wrap.append(el('div', 'aum-cmd-tag', label));
  const box = el('div', 'aum-cmd');
  box.append(el('span', 'aum-cmd-prompt', '$'), el('code', 'aum-cmd-text', cmd));
  const btn = el('button', 'aum-cmd-copy', 'copy');
  btn.type = 'button';
  btn.addEventListener('click', () => {
    try { navigator.clipboard && navigator.clipboard.writeText(cmd); } catch { /* clipboard blocked */ }
    btn.textContent = 'copied'; btn.classList.add('done');
    setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('done'); }, 1600);
  });
  box.append(btn);
  wrap.append(box);
  return wrap;
}

function ceremony(p) {
  const wrap = el('div', 'aum-cmd-group');
  wrap.append(cmdBox(p.signCommand, '1 · sign it (in your terminal, with your key)'));
  if (p.applyHint) wrap.append(cmdBox('# then in the workbench:  ' + p.applyHint, '2 · apply after signing'));
  return wrap;
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .aum-app { position:absolute; inset:0; display:flex; flex-direction:column; color:var(--text); font-size:14px; overflow:hidden; }
  .aum-head { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding:13px 20px 11px; border-bottom:1px solid rgba(255,255,255,0.06); }
  .aum-brand { display:flex; flex-direction:column; gap:1px; }
  .aum-name { font-size:16px; font-weight:750; letter-spacing:0.22em; width:max-content;
    background:linear-gradient(100deg, rgba(var(--hue-l),1), rgba(var(--hue-c),1) 55%, rgba(var(--hue-r),1));
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .aum-tag { font-size:11px; color:var(--dim); }
  .aum-observer { font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:var(--faint);
    padding:4px 10px; border-radius:20px; border:1px solid rgba(255,255,255,0.12); white-space:nowrap; }

  .aum-scroll { flex:1; overflow-y:auto; padding:18px max(16px, calc((100% - 760px)/2)) 56px;
    scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.12) transparent; }

  /* ---- the vault crest ---- */
  .aum-vault { position:relative; padding:22px 22px 18px; border-radius:20px; margin-bottom:20px; overflow:hidden;
    border:1px solid rgba(var(--hue-c),0.26);
    background:
      radial-gradient(120% 150% at 0% 0%, rgba(var(--hue-l),0.13), transparent 58%),
      radial-gradient(120% 150% at 100% 0%, rgba(var(--hue-r),0.16), transparent 60%),
      radial-gradient(150% 120% at 50% 128%, rgba(var(--hue-c),0.12), transparent 64%),
      rgba(255,255,255,0.015); }
  .aum-vault.unlocked { border-color:rgba(255,205,150,0.42); }

  .aum-vault-top { display:flex; align-items:center; gap:15px; }
  .aum-lock { flex:none; width:62px; height:62px; display:grid; place-items:center; border-radius:17px; color:rgba(var(--hue-c),0.96);
    background:rgba(var(--hue-c),0.1); border:1px solid rgba(var(--hue-c),0.32); box-shadow:0 0 22px rgba(var(--hue-c),0.22); }
  .aum-vault.unlocked .aum-lock { color:rgba(255,205,150,0.98); background:rgba(255,205,150,0.12); border-color:rgba(255,205,150,0.42); box-shadow:0 0 22px rgba(255,205,150,0.24); }
  .aum-lock svg { width:34px; height:34px; }
  .aum-vstat { flex:1; min-width:0; }
  .aum-vstate { font-size:21px; font-weight:750; letter-spacing:0.16em; color:#fff; line-height:1.1; }
  .aum-vsub { font-size:11.5px; color:var(--dim); margin-top:3px; }
  .aum-vkey { flex:none; text-align:right; }
  .aum-vkey-k { font-size:9px; letter-spacing:0.16em; text-transform:uppercase; color:rgba(var(--hue-l),0.95); }
  .aum-vkey-f { font-size:11px; font-family:ui-monospace,monospace; color:var(--dim); margin-top:2px; }
  .aum-bind { margin-top:10px; text-align:center; }
  /* ceremony frames start compact and follow the page's measured height (see the message listener
     above) — a fixed tall height was the dead-vertical-field bug (owner screenshot, 2026-07-10). */
  .aum-bind-frame { width:100%; height:440px; border:0; border-radius:12px;
    background:transparent; display:block; margin-top:10px; }
  .aum-bind-btn { font:inherit; font-size:12.5px; letter-spacing:0.04em; padding:8px 16px; border-radius:10px;
    border:1px solid rgba(var(--hue-r),0.55); background:rgba(var(--hue-r),0.12); color:var(--text); cursor:pointer; }
  .aum-bind-btn:hover { background:rgba(var(--hue-r),0.2); }
  .aum-bind-sub { font-size:11px; color:var(--dim); margin-top:6px; line-height:1.5; max-width:420px; margin-left:auto; margin-right:auto; }

  .aum-crest-k { font-size:9.5px; letter-spacing:0.2em; text-transform:uppercase; color:var(--faint); margin:0 0 9px 2px; }
  .aum-anchor-wrap { margin-top:20px; }
  .aum-anchor { display:grid; grid-template-columns:repeat(6, 1fr); gap:9px; }
  .aum-cell, .aum-tie { --tc:var(--hue-c); }
  .aum-cell.h-l, .aum-tie.h-l { --tc:var(--hue-l); } .aum-cell.h-r, .aum-tie.h-r { --tc:var(--hue-r); }
  .aum-cell { aspect-ratio:1; max-height:56px; display:grid; place-items:center; border-radius:12px;
    border:1px solid rgba(var(--tc),0.36); background:rgba(var(--tc),0.09); box-shadow:inset 0 0 18px rgba(var(--tc),0.12); }
  .aum-mask { font-size:15px; color:rgba(var(--tc),0.9); text-shadow:0 0 10px rgba(var(--tc),0.55); }

  .aum-words-wrap { margin-top:20px; }
  .aum-words { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
  .aum-word { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px;
    border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); }
  .aum-word-n { flex:none; width:16px; font-size:10px; font-family:ui-monospace,monospace; color:var(--faint); }
  .aum-tie { flex:none; width:26px; height:26px; display:grid; place-items:center; border-radius:8px;
    border:1px solid rgba(var(--tc),0.42); background:rgba(var(--tc),0.1); }
  .aum-tie .aum-mask { font-size:12px; }
  .aum-word-dots { display:flex; gap:5px; flex:1; }
  .aum-dot { width:7px; height:7px; border-radius:50%; background:rgba(255,255,255,0.16); }

  .aum-vault-note { margin-top:18px; font-size:11px; line-height:1.6; color:var(--faint); }
  .aum-ticks { display:flex; flex-wrap:wrap; gap:8px 18px; margin-top:14px; }
  .aum-tick { display:inline-flex; align-items:center; gap:7px; font-size:11.5px; color:var(--dim); }
  .aum-tick-m { width:16px; height:16px; display:grid; place-items:center; border-radius:5px; font-size:10px; }
  .aum-tick.ok .aum-tick-m { color:rgba(var(--hue-l),1); background:rgba(var(--hue-l),0.14); border:1px solid rgba(var(--hue-l),0.35); }
  .aum-tick.warn .aum-tick-m { color:rgba(255,150,150,1); background:rgba(255,150,150,0.12); border:1px solid rgba(255,150,150,0.4); }

  .aum-trust { padding:12px 14px; border-radius:15px; margin-bottom:20px;
    border:1px solid rgba(255,255,255,0.07); background:rgba(255,255,255,0.02); }
  .aum-trust-label { font-size:10.5px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:var(--faint); margin-bottom:9px; }
  /* four colored squares across: green · blue · purple · amber (ROOT-ish → owner → key → alive) */
  .aum-steps { display:grid; grid-template-columns:repeat(4, 1fr); gap:9px; }
  .aum-step { --sc:255,255,255; display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; gap:10px;
    min-height:76px; padding:12px 13px; border-radius:13px; border:1px solid rgba(var(--sc),0.42); background:rgba(var(--sc),0.09);
    box-shadow:inset 0 0 18px rgba(var(--sc),0.08); }
  .aum-step.s-l { --sc:var(--hue-l); } .aum-step.s-c { --sc:var(--hue-c); }
  .aum-step.s-r { --sc:var(--hue-r); } .aum-step.s-o { --sc:255,180,110; }
  .aum-step.yours { border-color:rgba(var(--sc),0.72); box-shadow:0 0 16px rgba(var(--sc),0.26), inset 0 0 18px rgba(var(--sc),0.12); }
  .aum-step-n { width:22px; height:22px; display:grid; place-items:center; border-radius:7px; font-size:11px; color:#fff;
    background:rgba(var(--sc),0.34); border:1px solid rgba(var(--sc),0.75); }
  .aum-step-l { font-size:11.5px; color:rgba(255,255,255,0.9); line-height:1.25; }
  .aum-step.yours .aum-step-l { color:#fff; font-weight:650; }
  @media (max-width:520px){ .aum-steps { grid-template-columns:repeat(2, 1fr); } }

  .aum-qhead { display:flex; align-items:baseline; justify-content:space-between; gap:10px; flex-wrap:wrap; margin:0 2px 12px; }
  .aum-qhead-t { font-size:14px; font-weight:650; color:#fff; }
  .aum-qhead-s { font-size:11.5px; color:var(--dim); }

  /* the approval panel: the separate local gate, embedded in-place */
  /* The host is a quiet layout band, not a second card around the approval gate. Each proposal
     inside the gate is already a portal surface; framing both levels makes the review hierarchy muddy. */
  .aum-gate { margin:0 2px 20px; padding:0; border:0; background:transparent; }
  .aum-gate-h { font-size:13px; font-weight:650; color:#fff; }
  .aum-gate-note { max-width:66ch; font-size:11.5px; line-height:1.55; color:var(--dim); margin-top:6px; }
  .aum-gate-slot { margin-top:12px; min-height:56px; }
  .aum-gate-frame { width:100%; height:70vh; min-height:420px; border:0; border-radius:0;
    background:transparent; display:block; }
  .aum-gate-open { display:inline-block; margin-top:8px; font-size:11px; color:rgba(var(--hue-c),0.92); text-decoration:none; }
  .aum-gate-open:hover { text-decoration:underline; }
  .aum-phrase-wrap { margin-top:16px; }
  .aum-phrase-frame { width:100%; height:440px; border:0; border-radius:12px; background:transparent; display:block; }
  .aum-phrase-probe, .aum-phrase-off { font-size:12px; color:var(--dim); line-height:1.6; padding:10px 0; }
  /* masked mini-acrostic — the SHAPE of your phrase (spine + dotted words), never the words themselves */
  .aum-mini-layout { display:flex; align-items:center; gap:26px; padding:6px 6px 4px; }
  .aum-mini-right { flex:1; display:flex; flex-direction:column; align-items:flex-start; gap:13px; min-width:0; }
  .aum-mini-spine { display:flex; flex-direction:column; gap:7px; width:max-content; flex:none; }
  .aum-mini-row { display:flex; align-items:center; gap:10px; --tc:var(--hue-c); }
  .aum-mini-row.h-l { --tc:var(--hue-l); } .aum-mini-row.h-r { --tc:var(--hue-r); }
  .aum-mini-tile { flex:none; width:26px; height:26px; display:grid; place-items:center; border-radius:8px;
    border:1px solid rgba(var(--tc),0.42); background:rgba(var(--tc),0.1); box-shadow:inset 0 0 10px rgba(var(--tc),0.14); }
  .aum-mini-dot { font-size:11px; color:rgba(var(--tc),0.92); text-shadow:0 0 8px rgba(var(--tc),0.6); }
  .aum-mini-word { display:flex; gap:5px; }
  .aum-mini-cell { width:7px; height:7px; border-radius:50%; background:rgba(var(--tc),0.34); }
  .aum-mini-spine.empty .aum-mini-tile { border-color:rgba(255,255,255,0.14); background:rgba(255,255,255,0.03); box-shadow:none; }
  .aum-mini-spine.empty .aum-mini-dot { color:var(--faint); text-shadow:none; }
  .aum-mini-spine.empty .aum-mini-cell { background:rgba(255,255,255,0.1); }
  .aum-mini-status { text-align:left; font-size:12.5px; color:var(--dim); line-height:1.5; }
  /* #288 bridge — the standing AURA footprint: the same silver trefoil + the named state, read-only */
  .aum-genesis-foot { display:inline-flex; align-items:center; gap:8px; margin-bottom:2px; }
  .aum-genesis-mark { width:20px; height:20px; filter:grayscale(1) brightness(1.1); opacity:0.85; -webkit-user-drag:none; }
  .aum-genesis-word { font-family:ui-monospace,monospace; font-size:10.5px; letter-spacing:.08em; color:rgba(226,232,240,.6); }
  .aum-mini-action { text-align:left; }
  .aum-mini-btn { position:relative; font:inherit; font-size:12px; letter-spacing:0.04em; padding:8px 18px; border-radius:999px; cursor:pointer; color:var(--text);
    border:1px solid rgba(var(--hue-r),0.5); background:rgba(var(--hue-r),0.12); transition:all 0.2s cubic-bezier(0.22,1,0.36,1); }
  .aum-mini-btn:hover:not(:disabled) { background:rgba(var(--hue-r),0.22); box-shadow:0 0 18px rgba(var(--hue-r),0.28); }
  .aum-mini-btn:disabled { opacity:0.5; cursor:not-allowed; }
  .aum-mini-btn.active { background:rgba(var(--hue-r),0.24); box-shadow:0 0 18px rgba(var(--hue-r),0.28); }
  .aum-mini-ceremony { max-height:0; overflow:hidden; transition:max-height 0.45s cubic-bezier(0.22,1,0.36,1); }
  .aum-mini-ceremony.on { max-height:800px; margin-top:12px; } /* fallback; the size listener sets the exact height */
  .aum-gate-probe { font-size:12px; color:var(--faint); }
  .aum-gate-off { font-size:12.5px; color:var(--dim); line-height:1.6; }

  /* #91 shrink warning — the stale-proposal tell (matches the gate's own red banner) */
  .aum-shrink { margin:11px 0 0; padding:11px 13px; border-radius:11px;
    border:1px solid rgba(255,90,90,0.5); background:rgba(255,60,60,0.09); }
  .aum-shrink-h { font-size:12.5px; font-weight:750; color:rgba(255,150,150,1); }
  .aum-shrink-f { font-family:ui-monospace,monospace; font-size:11.5px; color:rgba(255,205,205,0.95); margin-top:5px; }
  .aum-shrink-n { font-size:11px; line-height:1.5; color:rgba(255,175,175,0.95); margin-top:7px; }

  .aum-card { padding:14px 15px; border-radius:14px; margin-bottom:10px; --tc:255,255,255;
    border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); }
  .aum-card.tone-blue   { --tc:var(--hue-c); } .aum-card.tone-amber  { --tc:255,205,150; }
  .aum-card.tone-purple { --tc:var(--hue-r); } .aum-card.tone-green  { --tc:var(--hue-l); }
  .aum-card { border-left:2px solid rgba(var(--tc),0.5); }
  .aum-card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .aum-card-l { flex:1; min-width:0; }
  .aum-card-goal { font-size:13.5px; font-weight:600; color:#fff; line-height:1.4; }
  .aum-card-meta { font-size:10.5px; font-family:ui-monospace,monospace; color:var(--faint); margin-top:3px; }
  .aum-card-line { margin:10px 0 0; padding:9px 11px; border-radius:9px; overflow-x:auto;
    font-size:11px; font-family:ui-monospace,monospace; line-height:1.5; color:rgba(255,255,255,0.78);
    background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.05); white-space:pre; }
  .aum-card-help { margin-top:11px; display:flex; flex-direction:column; gap:9px; }
  .aum-term-fallback { border:1px solid var(--glass-border); border-radius:9px; padding:2px 10px; }
  .aum-term-fallback summary { cursor:pointer; font-size:11px; color:var(--faint); padding:6px 0; letter-spacing:0.03em; }
  .aum-term-fallback[open] summary { color:var(--dim); margin-bottom:6px; }
  .aum-help-note { font-size:12px; line-height:1.5; color:var(--dim); }
  .aum-card-risk { font-size:11px; line-height:1.45; color:var(--faint); margin-top:8px; }
  .aum-card-risk.warn { color:rgba(255,180,120,0.95); }

  /* the fold — the simple face hides code; one tap brings it back */
  .aum-fold { margin-top:10px; }
  .aum-fold > summary { list-style:none; cursor:pointer; font-size:11px; letter-spacing:0.06em; color:var(--faint);
    display:inline-flex; align-items:center; gap:6px; padding:3px 2px; transition:color 0.2s ease; }
  .aum-fold > summary:hover { color:var(--dim); }
  .aum-fold > summary::before { content:"▸"; font-size:9px; transition:transform 0.25s ease; }
  .aum-fold[open] > summary::before { transform:rotate(90deg); }
  .aum-fold > summary::-webkit-details-marker { display:none; }

  /* #105 diff preview — the change you would be signing */
  .aum-diff { margin:10px 0 0; }
  .aum-diff-pre { margin:0; padding:9px 0; border-radius:9px; overflow-x:auto;
    background:rgba(0,0,0,0.30); border:1px solid rgba(255,255,255,0.05);
    font-size:11px; font-family:ui-monospace,monospace; line-height:1.55; }
  .aum-diff-l { padding:0 12px; white-space:pre; }
  .aum-diff-l.add { color:rgba(120,230,160,0.95); background:rgba(60,200,120,0.08); }
  .aum-diff-l.del { color:rgba(255,150,150,0.95); background:rgba(230,80,80,0.08); }
  .aum-diff-l.hh  { color:var(--faint); }
  .aum-diff-l.ctx { color:rgba(255,255,255,0.6); }
  .aum-diff-note { font-size:9.5px; letter-spacing:0.06em; text-transform:uppercase; color:rgba(255,190,120,0.85); margin-top:5px; }
  .aum-cmd-group { display:flex; flex-direction:column; gap:9px; }

  .aum-cmd-wrap { display:flex; flex-direction:column; gap:6px; }
  .aum-cmd-tag { font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:rgba(255,205,150,0.9); }
  .aum-cmd { display:flex; align-items:center; gap:9px; padding:9px 11px; border-radius:10px;
    border:1px solid rgba(var(--hue-r),0.3); background:rgba(var(--hue-r),0.06); }
  .aum-cmd-prompt { color:rgba(var(--hue-r),0.9); font-family:ui-monospace,monospace; font-size:12px; }
  .aum-cmd-text { flex:1; min-width:0; overflow-x:auto; white-space:nowrap; font-family:ui-monospace,monospace; font-size:12.5px; color:#fff; }
  .aum-cmd-copy { flex:none; font:inherit; font-size:11px; padding:5px 12px; border-radius:8px; cursor:pointer; color:var(--text);
    border:1px solid rgba(var(--hue-r),0.4); background:rgba(var(--hue-r),0.12); transition:all 0.15s ease; }
  .aum-cmd-copy:hover { border-color:rgba(var(--hue-r),0.7); }
  .aum-cmd-copy.done { color:rgba(var(--hue-l),1); border-color:rgba(var(--hue-l),0.5); background:rgba(var(--hue-l),0.12); }

  .aum-receipt { display:inline-flex; align-items:center; gap:8px; font-size:11px; padding:5px 11px; border-radius:8px; align-self:flex-start;
    border:1px solid rgba(var(--hue-l),0.3); background:rgba(var(--hue-l),0.07); }
  .aum-receipt-k { font-size:9px; letter-spacing:0.12em; text-transform:uppercase; color:var(--faint); }
  .aum-receipt code { font-family:ui-monospace,monospace; color:rgba(var(--hue-l),0.98); }

  .aum-foot { margin-top:20px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.06); }
  .aum-foot p { margin:0 0 8px; font-size:12.5px; line-height:1.6; color:rgba(255,255,255,0.8); }
  .aum-foot-dim { color:var(--faint) !important; font-style:italic; }
  /* the record — read-only history rail */
  .aum-history { margin-top:22px; }
  .aum-history-head { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:10px; }
  .aum-history-title { font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
  .aum-history-refresh { font:inherit; font-size:12px; padding:4px 14px; border-radius:999px; border:1px solid var(--glass-border); background:transparent; color:var(--dim); cursor:pointer; transition:color 0.2s ease, border-color 0.2s ease; }
  .aum-history-refresh:hover { color:var(--text); border-color:rgba(255,255,255,0.22); }
  .aum-history-loading, .aum-history-empty, .aum-history-note { font-size:12.5px; color:var(--faint); padding:8px 2px; }
  .aum-history-note { color:#ffc38a; }
  /* four true full-width portal rows on hairlines — a list inside the frame, never cards or pills
     (owner rule). Hue rides the crest-grammar tile + count text; the open state EXTENDS the row. */
  .aum-hrow { --hue:var(--hue-l); border-top:1px solid rgba(255,255,255,0.07); }
  .aum-hrow:last-child { border-bottom:1px solid rgba(255,255,255,0.07); }
  .aum-hrow.h-l { --hue:var(--hue-l); } .aum-hrow.h-c { --hue:var(--hue-c); } .aum-hrow.h-r { --hue:var(--hue-r); } .aum-hrow.h-o { --hue:255,180,110; }
  .aum-hrow-bar { display:flex; align-items:center; gap:12px; padding:13px 2px; }
  .aum-hrow-tile { flex:none; width:26px; height:26px; display:grid; place-items:center; border-radius:8px;
    border:1px solid rgba(var(--hue),0.42); background:rgba(var(--hue),0.1); box-shadow:inset 0 0 10px rgba(var(--hue),0.14); }
  .aum-hrow-dot { font-size:11px; color:rgba(var(--hue),0.92); text-shadow:0 0 8px rgba(var(--hue),0.6); }
  .aum-hrow-text { flex:1; min-width:0; }
  .aum-hrow-label { font-size:14px; color:var(--text); letter-spacing:.02em; }
  .aum-hrow-count { flex:none; font-family:ui-monospace,monospace; font-size:13px; color:rgba(var(--hue),0.95); }
  .aum-hrow-fold { flex:none; font-size:9px; color:var(--faint); transition:transform 0.25s ease; }
  .aum-hrow.open .aum-hrow-fold { transform:rotate(90deg); }
  .aum-hrow-sub { margin-top:2px; font-size:11.5px; color:var(--faint); }
  .aum-hrow-detail { display:none; padding:0 2px 13px 38px; }
  .aum-hrow-detail.on { display:block; }
  .aum-hrow-none { font-size:12px; color:var(--faint); font-style:italic; padding:2px 0; }
  .aum-hitem { padding:9px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
  .aum-hitem:first-child { padding-top:0; }
  .aum-hitem:last-child { border-bottom:none; padding-bottom:0; }
  .aum-hitem-top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .aum-hitem-hash { font-family:ui-monospace,monospace; font-size:12px; color:rgba(var(--hue),0.95); }
  .aum-hitem-at { font-size:11.5px; color:var(--faint); }
  .aum-hitem-flag { font-size:11px; font-weight:650; color:#ff9696; letter-spacing:0.03em; }
  .aum-hitem-goal { font-size:12.5px; color:rgba(255,255,255,0.82); margin-top:4px; line-height:1.5; }
  .aum-hitem-meta { font-size:11.5px; color:var(--faint); margin-top:4px; font-family:ui-monospace,monospace; }
  @media (max-width:430px){ .aum-hrow-detail { padding-left:2px; } }
  `;
  const tag = document.createElement('style');
  tag.id = 'aumlok-screen-style';
  tag.textContent = css;
  document.head.append(tag);
}
