// Aukora Spatial — SOVEREIGN BROWSER: the holding page (owner-directed 2026-07-08).
//
// HONEST PLACEHOLDER, by the honesty-lint culture: nothing here browses anything. This organ
// names what is COMING (issue #204: a governed Playwright window + the .vk/.auk/.aum local mesh
// naming registry) and reports, truthfully, that both are unwired. When the bricks land, this
// file becomes the real organ; until then it renders design + status, zero capability claims.
//
// The future shape (spec archived on the issue): Auma browses through a locked-down local
// Chromium (sanitized-markdown reads, loopback-blocked, owner-gated egress — the web is
// EVIDENCE, never authority), and mesh names like peter.aum resolve node-to-node through
// signed naming receipts in the governed brain — an intranet of sovereign nodes, no ICANN.

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

export function mountBrowser(root) {
  injectStyle();
  const app = el('div', 'sbr-app');

  const head = el('div', 'sbr-head');
  head.append(el('div', 'sbr-name', 'SOVEREIGN BROWSER'));
  head.append(el('div', 'sbr-badge', 'coming soon'));
  app.append(head);

  const lead = el('p', 'sbr-lead');
  lead.textContent = 'A window to the web that answers to this node — she reads the open internet through a sandboxed, governed lens, and sovereign names route friend-to-friend without anyone’s permission.';
  app.append(lead);

  // the two pillars, stated as design — with honest status chips
  const grid = el('div', 'sbr-grid');
  grid.append(pillar('The governed window',
    'A locked-down local browser she drives with four small tools — navigate, click, type, screenshot. Pages arrive as sanitized text; what she reads is evidence, never instruction. Loopback is walled off; egress is owner-gated, like every door out.',
    'browser sandbox · unwired'));
  grid.append(pillar('Sovereign names · .vk / .auk / .aum',
    'A local naming registry for the mesh: peter.aum finds Peter’s node through signed naming receipts in the governed brain — resolved inside the weave, no registrar, no fees, no collision with the public net.',
    'sovereign naming · inactive'));
  app.append(grid);

  const foot = el('div', 'sbr-foot');
  foot.append(el('span', null, 'Design + guardrails live in issue #204. Nothing here is wired yet — this page will say so until the day it stops being true.'));
  app.append(foot);

  root.append(app);
}

function pillar(title, body, status) {
  const c = el('div', 'sbr-card');
  c.append(el('div', 'sbr-card-t', title));
  c.append(el('p', 'sbr-card-b', body));
  const s = el('div', 'sbr-status');
  s.append(el('span', 'sbr-dot'), el('span', null, status));
  c.append(s);
  return c;
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .sbr-app { max-width: 720px; margin: 0 auto; padding: 34px 22px 60px; }
  .sbr-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .sbr-name { font-size: 15px; letter-spacing: 0.22em; color: var(--text); }
  .sbr-badge { font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; padding: 4px 10px;
    border-radius: 999px; color: rgba(var(--hue-c), 0.95); border: 1px solid rgba(var(--hue-c), 0.4);
    background: rgba(var(--hue-c), 0.08); }
  .sbr-lead { color: var(--dim); font-size: 13.5px; line-height: 1.7; margin: 0 0 22px; max-width: 60ch; }
  .sbr-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
  @media (min-width: 700px) { .sbr-grid { grid-template-columns: 1fr 1fr; } }
  .sbr-card { border: 1px solid var(--glass-border); border-radius: 14px; padding: 16px 17px;
    background: var(--glass); }
  .sbr-card-t { font-size: 12.5px; letter-spacing: 0.06em; color: var(--text); margin-bottom: 8px; }
  .sbr-card-b { font-size: 12px; line-height: 1.65; color: var(--dim); margin: 0 0 12px; }
  .sbr-status { display: flex; align-items: center; gap: 7px; font-size: 10px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--faint); }
  .sbr-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255, 195, 138, 0.75);
    box-shadow: 0 0 8px rgba(255, 195, 138, 0.4); }
  .sbr-foot { margin-top: 22px; font-size: 11px; color: var(--faint); line-height: 1.6; }
  `;
  document.head.append(s);
}
