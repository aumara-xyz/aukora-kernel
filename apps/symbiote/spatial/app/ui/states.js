// Aukora Spatial — shared visual-state system for governed proposals.
//
// PRESENTATION ONLY. These are display chips over mock / read-only state. They
// describe where a proposal sits in the governed lifecycle:
//   locked → ready → pending → signed → applied
// Nothing here signs, applies, or mutates anything.

export const STATE_META = {
  locked:  { label: 'locked',         tone: 'grey',   note: 'in the sandbox · council reviewing — nothing to sign yet' },
  ready:   { label: 'ready to sign',  tone: 'blue',   note: 'gates passed — nothing lands without your signature' },
  pending: { label: 'awaiting apply', tone: 'amber',  note: 'signed in your terminal · the governed apply is landing' },
  signed:  { label: 'signed',         tone: 'purple', note: 'your signature is verified' },
  applied: { label: 'applied',        tone: 'green',  note: 'governed apply landed · receipt written' },
};
export const STATE_ORDER = ['locked', 'ready', 'pending', 'signed', 'applied'];

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

export function stateChip(state) {
  injectStatesStyle();
  const m = STATE_META[state] || STATE_META.locked;
  const chip = el('span', 'ui-chip ui-chip-' + m.tone);
  chip.append(el('span', 'ui-chip-dot'), el('span', null, m.label));
  return chip;
}

let styled = false;
export function injectStatesStyle() {
  if (styled) return; styled = true;
  const css = `
  .ui-chip { display:inline-flex; align-items:center; gap:6px; font-size:10.5px; font-weight:600; letter-spacing:0.04em;
    padding:4px 10px; border-radius:20px; white-space:nowrap;
    border:1px solid var(--cc, rgba(255,255,255,0.25)); color:var(--ct, var(--dim)); background:var(--cb, rgba(255,255,255,0.04)); }
  .ui-chip-dot { width:6px; height:6px; border-radius:50%; background:currentColor; box-shadow:0 0 7px currentColor; }
  .ui-chip-grey   { --cc:rgba(255,255,255,0.2);   --ct:var(--faint);            --cb:rgba(255,255,255,0.03); }
  .ui-chip-blue   { --cc:rgba(var(--hue-c),0.4);  --ct:rgba(var(--hue-c),0.98); --cb:rgba(var(--hue-c),0.08); }
  .ui-chip-amber  { --cc:rgba(255,205,150,0.45);  --ct:rgba(255,205,150,0.98);  --cb:rgba(255,205,150,0.08); }
  .ui-chip-purple { --cc:rgba(var(--hue-r),0.45); --ct:rgba(var(--hue-r),0.98); --cb:rgba(var(--hue-r),0.08); }
  .ui-chip-green  { --cc:rgba(var(--hue-l),0.45); --ct:rgba(var(--hue-l),0.98); --cb:rgba(var(--hue-l),0.08); }
  `;
  const tag = document.createElement('style');
  tag.id = 'ui-states-style';
  tag.textContent = css;
  document.head.append(tag);
}
