// Aukora Spatial — The Forge organ: a PREVIEW of the two-person AURA bond.
//
// HONESTY (hard): everything here is a local mock. There is no second human and
// no chain yet, so nothing here mints, witnesses, or awards — drafting a forge
// earns ZERO aura. The partner shown is labelled "example human · not real." A
// real forge is a co-signed, witnessed act on the governed receipt chain, with
// the anti-collusion guarantees spelled out below as HARD requirements the chain
// must meet before any forged bond is real. This organ teaches the shape of the
// bond; it does not create one.

import { createGlyph, signatureSpectrum, combineSpectra, consonance } from '/app/coherence-glyph.js';
import { tuningState } from '/app/tuning.js';

// Same per-device signature the AURA page uses — your figure here IS your
// figure there (one identity, one voice). Provisional like everything local.
function nodeSignature() {
  try {
    let id = localStorage.getItem('aukora-node-glyph-id');
    if (!id) { id = (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2))); localStorage.setItem('aukora-node-glyph-id', id); }
    return id;
  } catch { return 'aukora'; }
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function section(hue, title, sub) {
  const wrap = el('div', `forge-sec hue-${hue}`);
  const bar = el('div', 'forge-sec-bar');
  bar.append(el('div', 'forge-sec-title', title));
  if (sub) bar.append(el('div', 'forge-sec-sub', sub));
  wrap.append(bar);
  const body = el('div', 'forge-sec-body');
  wrap.append(body);
  return { wrap, body };
}

const STATES = [
  ['proposed', 'You point at another human and say: this one is real.'],
  ['accepted', 'They point back. Both of you co-sign the bond.'],
  ['forged', 'An independent, already-trusted human witnesses it. Now it holds.'],
  ['tempered', 'Over time it strengthens with real shared acts — or decays if abandoned.'],
];

export function mountForge(root) {
  injectStyle();
  const app = el('div', 'forge-app');

  // header
  const head = el('div', 'forge-head');
  const brand = el('div', 'forge-brand');
  brand.append(el('div', 'forge-glyph', '⧗'));
  const bt = el('div');
  bt.append(el('div', 'forge-name', 'The Forge'), el('div', 'forge-tag', 'two people · one witnessed bond'));
  brand.append(bt);
  head.append(brand);
  const badge = el('div', 'forge-preview-badge', 'preview · nothing here is real yet');
  head.append(badge);
  app.append(head);

  const scroll = el('div', 'forge-scroll');
  app.append(scroll);

  // ---- what a forge is ----
  const a = section('l', 'What a forge is', 'a bond, not a transaction');
  a.body.append(el('p', null,
    'A forge is the moment two real humans point at each other and say “this one is real,” and the chain remembers it — a consented, co-signed attestation between two identities. What it proves is exactly that and no more: two keys made this attestation together. It does not prove either of you is human, honest, or in sole control of a key — and it never grants authority.'));
  scroll.append(a.wrap);

  // ---- the live (mock) bond demo — two figures, one chord ----
  // Your coherence glyph and the placeholder partner's, with the BOND FIGURE
  // between them: both spectra ringing together. Its clarity rises as the
  // stages advance — a bond coming into tune as it is witnessed. Consonance
  // drives the figure internally and is never shown as a number (spec §12).
  const d = section('c', 'The bond', 'walk it through — this partner is a placeholder');
  const stage = el('div', 'forge-stage');
  const you = el('div', 'forge-node you');
  const youCnv = document.createElement('canvas'); youCnv.className = 'forge-fig';
  you.append(youCnv, el('div', 'forge-node-label', 'you'));
  const mid = el('div', 'forge-node mid');
  const bondCnv = document.createElement('canvas'); bondCnv.className = 'forge-fig bond';
  mid.append(bondCnv, el('div', 'forge-node-label bond-label', 'the bond — not yet rung'));
  const them = el('div', 'forge-node them');
  const themCnv = document.createElement('canvas'); themCnv.className = 'forge-fig';
  them.append(themCnv, el('div', 'forge-node-label', 'example human · not real'));
  stage.append(you, mid, them);
  d.body.append(stage);

  const yourModes = signatureSpectrum(nodeSignature(), tuningState().modes);
  const theirModes = signatureSpectrum('example-human-not-real', 4);
  const bondModes = combineSpectra(yourModes, theirModes);
  const cons = consonance(yourModes, theirModes);        // internal only — read from the figure, never printed
  let yourCoh = 0.62, theirCoh = 0.5, bondCoh = 0.06;
  const gYou = createGlyph(youCnv, { spectrum: yourModes, coherence: () => yourCoh });
  const gThem = createGlyph(themCnv, { spectrum: theirModes, coherence: () => theirCoh });
  const gBond = createGlyph(bondCnv, { spectrum: bondModes, coherence: () => bondCoh });
  const bondLabel = mid.querySelector('.bond-label');

  const stepper = el('div', 'forge-stepper');
  const stepEls = STATES.map(([name], i) => {
    const s = el('div', 'forge-step');
    s.append(el('div', 'forge-step-dot', String(i + 1)), el('div', 'forge-step-name', name));
    stepper.append(s);
    return s;
  });
  d.body.append(stepper);

  const desc = el('div', 'forge-state-desc', 'A forge starts when you propose one. Walk the stages →');
  d.body.append(desc);

  // DETOKENIZED: no shared numeric bond value — the bond FIGURE carries its own
  // state (its clarity rises as the stages advance); a bond is read, never scored.

  let cur = -1;
  const btnRow = el('div', 'forge-btn-row');
  const advance = el('button', 'forge-btn primary', 'Propose a forge');
  const reset = el('button', 'forge-btn ghost', 'reset');
  btnRow.append(advance, reset);
  d.body.append(btnRow);

  // the bond figure comes into tune stage by stage; only witnessing (stage 3)
  // lets the two spectra's real consonance carry it, and tempering lifts it
  const BOND_COH = [0.28, 0.48, Math.max(0.55, cons), Math.min(0.95, Math.max(0.55, cons) + 0.2)];
  const BOND_LABELS = ['the bond — proposed, barely audible', 'the bond — accepted, finding pitch', 'the bond — forged: the chord rings', 'the bond — tempered by real shared acts'];
  function paint() {
    stepEls.forEach((s, i) => s.classList.toggle('on', i <= cur));
    bondCoh = cur < 0 ? 0.06 : BOND_COH[Math.min(cur, 3)];
    bondLabel.textContent = cur < 0 ? 'the bond — not yet rung' : BOND_LABELS[Math.min(cur, 3)];
    if (cur >= 0) gBond.pulseNow();
    if (cur < 0) { desc.textContent = 'A forge starts when you propose one. Walk the stages →'; advance.textContent = 'Propose a forge'; }
    else { desc.textContent = STATES[cur][1]; advance.textContent = cur >= STATES.length - 1 ? 'bond complete (mock)' : 'Advance →'; }
    advance.disabled = cur >= STATES.length - 1;
  }
  advance.addEventListener('click', () => { if (cur < STATES.length - 1) { cur++; paint(); } });
  reset.addEventListener('click', () => { cur = -1; paint(); });
  paint();
  scroll.append(d.wrap);

  // ---- what it yields ----
  const y = section('r', 'What it yields', 'a witnessed pattern, not a score');
  y.body.append(el('p', null,
    'A bond is a pattern, not a purse. Your own coherence figure is yours and forging cannot damage it. The bond has its own figure: it comes into tune through real shared, witnessed acts, and it detunes if the bond is abandoned or one of you turns out to be lying. That asymmetry is the point — truth clarifies the figure, a lie muddies it, and nothing here is a balance anyone can drain or inflate.'));
  scroll.append(y.wrap);

  // ---- anti-collusion (stated openly) ----
  const c = section('l', 'How it resists gaming', 'the attacks, named — not hidden');
  c.body.append(el('p', 'forge-fine',
    'A two-person mechanic invites two-account gaming. We say the attacks out loud, because a defense you can’t name isn’t a defense:'));
  const attacks = [
    ['Self-forge', 'You make two accounts and forge them together.', 'A forge only holds once an independent, already-trusted human witnesses it — and a witness must be far from both forgers in the trust graph, or it counts for nothing.'],
    ['Sybil ring', 'A cluster of fake accounts vouch for each other in a loop.', 'A bond can carry no more trust than its distance to the nearest real, trusted anchor allows. Ring loops with one real seam can’t launder trust past that line; dense clusters get detected and frozen.'],
    ['Temper farming', 'Grind cheap acts to deepen a bond.', 'Only independently-witnessed acts deepen a bond, and neglect outpaces cheap growth — an unattended bond fades; it never deepens on its own.'],
    ['Disposable identities', 'Burn accounts that certify fakes.', 'Proposing and witnessing put the witness’s own coherence behind the bond, and a bond that proves false marks its witness too — so certifying a fake costs someone who has something to lose.'],
  ];
  for (const [name, how, defense] of attacks) {
    const row = el('div', 'forge-attack');
    row.append(el('div', 'forge-attack-name', name));
    row.append(el('div', 'forge-attack-how', how));
    row.append(el('div', 'forge-attack-def', defense));
    c.body.append(row);
  }
  c.body.append(el('p', 'forge-fine',
    'None of this is enforceable on your device — it lives on the governed chain, which is where a forge becomes real. Here it is only described.'));
  scroll.append(c.wrap);

  // ---- draft a forge (mock, awards 0) ----
  const f = section('c', 'Draft a forge', 'this saves a draft — it does not create a bond');
  const form = el('div', 'forge-form');
  const input = el('input', 'forge-input');
  input.type = 'text';
  input.placeholder = 'a name or handle for the human you’d forge with';
  const draftBtn = el('button', 'forge-btn primary', 'Save draft');
  const draftMsg = el('div', 'forge-draft-msg');
  form.append(input, draftBtn);
  f.body.append(form);
  f.body.append(draftMsg);
  f.body.append(el('div', 'forge-coming', 'coming — needs a second human and an independent witness on the chain. A draft is a note, not a bond; it awards nothing and proves nothing.'));

  let drafts = [];
  try { drafts = JSON.parse(localStorage.getItem('aukora-forge-drafts')) ?? []; } catch { drafts = []; }
  function renderDrafts() {
    draftMsg.innerHTML = '';
    if (!drafts.length) return;
    draftMsg.append(el('div', 'forge-draft-count', `${drafts.length} draft${drafts.length === 1 ? '' : 's'} saved locally (not sent, not witnessed):`));
    for (const dr of drafts.slice(-5)) {
      const chip = el('div', 'forge-draft-chip');
      chip.append(el('span', null, dr.who), el('span', 'forge-draft-status', dr.status));
      draftMsg.append(chip);
    }
  }
  draftBtn.addEventListener('click', () => {
    const who = input.value.trim();
    if (!who) { input.focus(); return; }
    drafts.push({ who, status: 'draft-coming', code: 'FORGE-' + Math.abs(hashStr(who + drafts.length)).toString(36).slice(0, 6).toUpperCase() });
    try { localStorage.setItem('aukora-forge-drafts', JSON.stringify(drafts)); } catch { /* quota */ }
    input.value = '';
    renderDrafts();
  });
  renderDrafts();
  scroll.append(f.wrap);

  // ---- honest status ----
  const h = section('r', 'Where it stands', 'honest status');
  h.body.append(el('p', null,
    'The chain that would witness a forge is real and running; the two-person forge lifecycle on top of it is not built yet. So this whole page is a preview — the shape of the bond and the defenses, shown before the machinery exists. When it’s real, a forge will be a co-signed, witnessed receipt like every other governed act, and the bond shown here will come from the chain, not from this device.'));
  scroll.append(h.wrap);

  root.append(app);
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h * 33) ^ s.charCodeAt(i)) | 0);
  return h;
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .forge-app { position:absolute; inset:0; display:flex; flex-direction:column; color:var(--text); font-size:14px; overflow:hidden; }
  .forge-head { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding:16px 20px 12px; border-bottom:1px solid rgba(255,255,255,0.06);
    background:linear-gradient(100deg, rgba(var(--hue-l),0.08), rgba(var(--hue-r),0.06) 60%, transparent); }
  .forge-brand { display:flex; align-items:center; gap:12px; }
  .forge-glyph { width:38px; height:38px; display:grid; place-items:center; font-size:20px; border-radius:11px;
    color:#fff; background:linear-gradient(135deg, rgba(var(--hue-l),0.9), rgba(var(--hue-r),0.9));
    box-shadow:0 0 18px rgba(var(--hue-c),0.3); }
  .forge-name { font-size:17px; font-weight:700; letter-spacing:0.04em; }
  .forge-tag { font-size:12px; color:var(--dim); margin-top:1px; }
  .forge-preview-badge { font-size:10.5px; letter-spacing:0.06em; text-transform:uppercase; color:rgba(var(--hue-r),0.95);
    padding:4px 10px; border-radius:20px; border:1px solid rgba(var(--hue-r),0.3); background:rgba(var(--hue-r),0.08); white-space:nowrap; }

  .forge-scroll { flex:1; overflow-y:auto; padding:18px max(16px, calc((100% - 720px)/2)) 60px;
    scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.12) transparent; }

  .forge-sec { margin:16px 0; }
  .forge-sec.hue-l { --ac:var(--hue-l); } .forge-sec.hue-c { --ac:var(--hue-c); } .forge-sec.hue-r { --ac:var(--hue-r); }
  .forge-sec-bar { padding:11px 15px; border-radius:13px 13px 0 0; border:1px solid rgba(var(--ac),0.28); border-bottom:none;
    background:linear-gradient(100deg, rgba(var(--ac),0.18), rgba(var(--ac),0.04) 70%, transparent); }
  .forge-sec-title { font-size:14.5px; font-weight:650; color:#fff; }
  .forge-sec-sub { font-size:11.5px; color:var(--dim); margin-top:2px; }
  .forge-sec-body { padding:14px 15px 16px; border-radius:0 0 13px 13px; border:1px solid rgba(var(--ac),0.16); border-top:none; background:rgba(var(--ac),0.02); }
  .forge-sec-body p { margin:0 0 10px; line-height:1.62; font-size:13.5px; color:rgba(255,255,255,0.86); }
  .forge-sec-body p:last-child { margin-bottom:0; }
  .forge-fine { font-size:12.5px !important; color:var(--dim) !important; }

  .forge-stage { display:flex; align-items:center; justify-content:center; gap:6px; padding:10px 0 18px; }
  .forge-node { display:flex; flex-direction:column; align-items:center; gap:8px; width:130px; }
  .forge-node.mid { width:150px; }
  .forge-fig { display:block; width:104px; height:104px; }
  .forge-fig.bond { width:134px; height:134px; }
  .forge-node-label.bond-label { color:rgba(255,201,92,0.85); }
  .forge-orb { width:52px; height:52px; border-radius:50%;
    background:radial-gradient(circle at 35% 30%, rgba(var(--hue-l),0.9), rgba(var(--hue-l),0.25));
    box-shadow:0 0 20px rgba(var(--hue-l),0.5); }
  .forge-orb.mock { background:radial-gradient(circle at 35% 30%, rgba(var(--hue-r),0.55), rgba(var(--hue-r),0.12));
    box-shadow:0 0 14px rgba(var(--hue-r),0.3); border:1px dashed rgba(var(--hue-r),0.5); }
  .forge-node-label { font-size:11px; color:var(--dim); text-align:center; }
  .forge-link { flex:1; max-width:160px; height:2px; background:rgba(255,255,255,0.12); position:relative; transition:all 0.4s ease; }
  .forge-link.lit { background:linear-gradient(90deg, rgba(var(--hue-l),0.8), rgba(var(--hue-r),0.8)); box-shadow:0 0 10px rgba(var(--hue-c),0.4); }
  .forge-link.forged { height:3px; box-shadow:0 0 16px rgba(var(--hue-c),0.7); }

  .forge-stepper { display:flex; justify-content:space-between; gap:6px; margin:6px 0 12px; }
  .forge-step { flex:1; display:flex; flex-direction:column; align-items:center; gap:5px; opacity:0.4; transition:opacity 0.3s ease; }
  .forge-step.on { opacity:1; }
  .forge-step-dot { width:24px; height:24px; border-radius:50%; display:grid; place-items:center; font-size:11px;
    border:1px solid rgba(var(--hue-c),0.4); color:var(--dim); background:rgba(var(--hue-c),0.06); }
  .forge-step.on .forge-step-dot { color:#fff; border-color:rgba(var(--hue-c),0.9); background:rgba(var(--hue-c),0.2); box-shadow:0 0 10px rgba(var(--hue-c),0.4); }
  .forge-step-name { font-size:10.5px; color:var(--dim); text-transform:capitalize; }
  .forge-state-desc { text-align:center; font-size:12.5px; color:rgba(255,255,255,0.8); min-height:34px; line-height:1.5; padding:0 8px; }

  .forge-btn-row { display:flex; gap:8px; margin-top:14px; }
  .forge-btn { font:inherit; font-size:13px; padding:9px 16px; border-radius:10px; cursor:pointer;
    border:1px solid rgba(var(--hue-c),0.3); background:rgba(var(--hue-c),0.1); color:var(--text); transition:all 0.16s ease; }
  .forge-btn.primary { border-color:rgba(var(--hue-r),0.4); background:rgba(var(--hue-r),0.16); }
  .forge-btn.ghost { background:transparent; }
  .forge-btn:hover:not(:disabled) { border-color:rgba(var(--hue-r),0.7); }
  .forge-btn:disabled { opacity:0.45; cursor:default; }

  .forge-attack { display:grid; grid-template-columns:1fr; gap:3px; padding:9px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
  .forge-attack:last-of-type { border-bottom:none; }
  .forge-attack-name { font-size:13px; font-weight:640; color:rgba(var(--hue-r),0.95); }
  .forge-attack-how { font-size:12px; color:var(--dim); font-style:italic; }
  .forge-attack-def { font-size:12.5px; color:rgba(255,255,255,0.82); line-height:1.5; }

  .forge-form { display:flex; gap:8px; margin-bottom:10px; }
  .forge-input { flex:1; font:inherit; font-size:13px; padding:9px 12px; border-radius:10px;
    border:1px solid rgba(var(--hue-c),0.25); background:rgba(255,255,255,0.03); color:var(--text); outline:none; min-width:0; }
  .forge-input:focus { border-color:rgba(var(--hue-c),0.6); }
  .forge-input::placeholder { color:var(--faint); }
  .forge-draft-msg { display:flex; flex-direction:column; gap:6px; }
  .forge-draft-count { font-size:11.5px; color:var(--dim); }
  .forge-draft-chip { display:flex; justify-content:space-between; gap:10px; font-size:12px; padding:6px 11px; border-radius:8px;
    border:1px solid rgba(var(--hue-c),0.16); background:rgba(var(--hue-c),0.04); }
  .forge-draft-status { color:var(--faint); font-family:ui-monospace,monospace; font-size:10.5px; }
  .forge-coming { margin-top:10px; font-size:11.5px; color:rgba(var(--hue-r),0.9); font-style:italic; }
  `;
  const tag = document.createElement('style');
  tag.id = 'forge-organ-style';
  tag.textContent = css;
  document.head.append(tag);
}
