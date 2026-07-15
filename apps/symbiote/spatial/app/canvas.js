// Aukora Spatial — DEV CANVAS: a blank center surface a thread drives (owner-directed 2026-07-08).
//
// This is intentionally EMPTY. Nothing renders here until a thread on the left drives it. The DEV
// thread (pinned, top of the chats lane) controls this space: you type, the center changes. Later
// this same surface is how every thread renders — with your approval — and how her governed changes
// preview before they reach the AUMLOK gate. For now: one blank stage, one voice driving it.
//
// It listens for a single window event, `aukora:canvas`, carrying { html }. It renders that html in
// a sandboxed iframe (no same-origin, scripts contained) — pixels on a preview surface, never files,
// never authority. The governed self-mod path stays exactly where it belongs: AUMLOK.

const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

let frameEl = null;
let emptyEl = null;

// LONG-HORIZON: the last build survives a reload (localStorage, this browser only). The DEV thread
// reads window.__aukoraCanvasLast to evolve the build turn over turn — losing it on refresh would
// reset her whole app mid-build. Pixels only, same as ever: never files, never authority.
const CANVAS_STORE = 'aukora-canvas-last';
try { if (!window.__aukoraCanvasLast) window.__aukoraCanvasLast = localStorage.getItem(CANVAS_STORE) || ''; } catch { /* storage blocked */ }

export function mountCanvas(root) {
  injectStyle();
  const app = el('div', 'cv-app');
  const stage = el('div', 'cv-stage');
  emptyEl = el('div', 'cv-empty');           // a bare stage — literally nothing until driven
  stage.append(emptyEl);
  app.append(stage);
  root.append(app);

  // render whatever the driving thread sends
  const onCanvas = (e) => renderHtml(stage, (e.detail && e.detail.html) || '');
  window.addEventListener('aukora:canvas', onCanvas);

  // if a directive arrived before this organ was mounted, honor the last one
  if (window.__aukoraCanvasLast) renderHtml(stage, window.__aukoraCanvasLast);
}

function renderHtml(stage, html) {
  window.__aukoraCanvasLast = html;
  try { localStorage.setItem(CANVAS_STORE, html); } catch { /* storage blocked or full — in-memory still works */ }
  if (emptyEl) emptyEl.remove();
  if (!frameEl) {
    frameEl = document.createElement('iframe');
    frameEl.className = 'cv-frame';
    frameEl.setAttribute('sandbox', 'allow-scripts'); // scripts run but cannot reach this origin
    stage.append(frameEl);
  }
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{color-scheme:dark} html,body{margin:0;height:100%;background:transparent;
      color:#f4f6ff;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}
    body{display:flex;align-items:center;justify-content:center;overflow:auto;}
    *{box-sizing:border-box}
  </style></head><body>${html}</body></html>`;
  frameEl.srcdoc = doc;
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .cv-app { position:absolute; inset:0; }
  .cv-stage { position:absolute; inset:0; }
  .cv-frame { width:100%; height:100%; border:0; background:transparent; display:block; }
  .cv-empty { position:absolute; inset:0; }  /* blank by design — no text, no chrome */
  `;
  document.head.append(s);
}
