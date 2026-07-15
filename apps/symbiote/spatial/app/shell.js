// Aukora Spatial — trinity shell: lanes, hot corners, tabs, organs.
//
// Lane widths come from a pure state machine of two dividers (a, d) on a
// 3-unit track (0 <= a <= d <= 3): left = a/3, center = (d-a)/3, right = (3-d)/3.
// Every lane is always an exact multiple of one third. Corner rule (uniform):
// pressing a corner ALWAYS pushes its panel out a third — unless the panel is
// already at its far wall (full), in which case it pulls in a third.

import { mountMap, focusNode, deselectNode } from '/app/map/map.js';
import { mountCouncil, mountKira, mountStatus, loadEngineStatusCard } from '/app/organs.js';
import { mountAuma } from '/app/auma/auma.js';
import { mountAura } from '/app/aura.js';
import { mountMorph } from '/app/morph.js';
import { mountCanvas } from '/app/canvas.js';
import { mountForge } from '/app/forge.js';
import { mountAumlok } from '/app/aumlok.js';
import { mountAumaLive } from '/app/aumalive.js';
import { mountMedia } from '/app/media.js';
import { mountLuminara } from '/app/luminara.js';
import { mountGhp } from '/app/ghp.js';
import { mountGraticube } from '/app/graticube.js';
import { mountAukoraXyz } from '/app/aukora-xyz.js';
import { mountSettings } from '/app/settings.js';
import { mountArc3 } from '/app/arc3/arc3.js';
import { mountBrowser } from '/app/browser.js';
import { mountApp as mountWolf } from '/app/wolf/wolf.js';
import { materializeShellModel } from '/app/shell-registry.js';
import { isChatOpen, closeChat } from '/app/chat.js';
import '/app/operate.js'; // Auma's hands on the UI (advisory; self-installs window.aukoraOperate) — drives the shell, never crosses the gate

const state = { a: 1, d: 2 };

const laneL = document.getElementById('lane-threads');
const laneC = document.getElementById('lane-canvas');
const laneR = document.getElementById('lane-menu');
const sliverL = document.getElementById('sliver-l');
const sliverR = document.getElementById('sliver-r');

const mobileQuery = window.matchMedia('(max-width: 680px)');

function applyLanes() {
  const widths = [state.a, state.d - state.a, 3 - state.d];
  if (mobileQuery.matches) {
    // Mobile: one full-screen pane at a time, chosen by mobilePane (corners
    // navigate; the divider state machine is desktop-only).
    const primary = { threads: 0, canvas: 1, menu: 2 }[mobilePane] ?? 1;
    [laneL, laneC, laneR].forEach((lane, i) => {
      lane.classList.toggle('mobile-hidden', i !== primary);
      lane.classList.remove('collapsed');
      lane.style.flexGrow = '1';
    });
    sliverL.classList.remove('on');
    sliverR.classList.remove('on');
  } else {
    [laneL, laneC, laneR].forEach((lane, i) => {
      const w = widths[i];
      lane.classList.remove('mobile-hidden');
      lane.style.flexGrow = w > 0 ? String(w) : '0.0001';
      lane.classList.toggle('collapsed', w === 0);
    });
    sliverL.classList.toggle('on', widths[0] === 0);
    sliverR.classList.toggle('on', widths[2] === 0);
  }
  // The map canvas needs a resize after the 0.5s glide settles.
  setTimeout(() => window.dispatchEvent(new Event('lane-settled')), 520);
}
mobileQuery.addEventListener('change', applyLanes);

// Every transition must keep 0 <= a <= d <= 3 from all reachable states.
// SIDE corners PUSH: pressing a side corner grows that side lane by a third,
// the CENTER lane keeps its width, and the FAR side lane yields the third
// (from the default 1/1/1 this gives chat 2/3, app 1/3, menu 0 — never an
// overlap that collapses the center). Both side corners are mirror images.
// When a side lane is already full (occupies the whole track) the corner
// pulls back in by a third instead. CANVAS corners still simply widen the
// center by nudging one divider outward.
const corners = {
  // Left (threads/chat): push a & d right together so center width (d-a) is
  // preserved and the far (menu) lane yields; if already full-left, pull in.
  threads() { if (state.a === 3) { state.a -= 1; } else { state.a += 1; state.d = Math.min(3, state.d + 1); } },
  // Right (menu): mirror — push a & d left together so center width is
  // preserved and the far (chat) lane yields; if already full-right, pull in.
  menu() { if (state.d === 0) { state.d += 1; } else { state.d -= 1; state.a = Math.max(0, state.a - 1); } },
  canvasLeft() { if (state.a === 0) { state.a += 1; state.d = Math.max(state.d, state.a); } else state.a -= 1; },
  canvasRight() { if (state.d === 3) { state.d -= 1; state.a = Math.min(state.a, state.d); } else state.d += 1; },
};

// On mobile the corners become navigation between full-screen panes: the
// canvas corners lead to the side panes (in the destination's direction),
// each side pane's corner leads back to the canvas.
let mobilePane = 'canvas';

function corner(name, mobileDest) {
  if (mobileQuery.matches) mobilePane = mobileDest;
  else corners[name]();
  applyLanes();
}

document.getElementById('corner-threads').addEventListener('click', () => corner('threads', 'canvas'));
document.getElementById('corner-menu').addEventListener('click', () => corner('menu', 'canvas'));
document.getElementById('corner-canvas-l').addEventListener('click', () => corner('canvasLeft', 'threads'));
document.getElementById('corner-canvas-r').addEventListener('click', () => corner('canvasRight', 'menu'));

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key === '[') corner('threads', 'canvas');
  else if (e.key === ']') corner('menu', 'canvas');
  else if (e.key === ',') corner('canvasLeft', 'threads');
  else if (e.key === '.') corner('canvasRight', 'menu');
  else if (e.key === 'Escape') {
    if (isChatOpen()) closeChat();
    else deselectNode();
  }
});

// ---------------------------------------------------------------------------
// Menu: three tabs (triangle / square / circle), rows select the center organ.
// Everything listed is advisory — organs render engine state, never mutate it.
// ---------------------------------------------------------------------------

const ORGANS_BUILTIN = {
  map: { title: 'Spatial Map', sub: '', mount: mountMap },
  council: { title: 'Fusion Council', sub: 'advisory reviews · zero authority', mount: mountCouncil },
  kira: { title: 'Kira Memory', sub: 'recall receipts · hash-chained', mount: mountKira },
  aumlok: { title: 'AUMLOK', sub: 'the gate — where your signature lands', mount: mountAumlok },
  status: { title: 'Engine Status', sub: 'scripts/status.sh', mount: mountStatus },
  auma: { title: 'Auma · Lingwa', sub: 'learn her language — canon v15', mount: mountAuma },
  aura: { title: 'AURA', sub: 'a living coherence pattern', mount: mountAura },
  'app-lab': { title: 'App Lab', sub: 'grow screens from chat · preview before signature', mount: mountCanvas },
  forge: { title: 'The Forge', sub: 'two people · one witnessed bond (preview)', mount: mountForge },
  aumalive: { title: 'Auma · Live', sub: 'the direct channel — she answers out loud, in light', mount: mountAumaLive },
  media: { title: 'Media Portal', sub: 'connected creative surface — bring your own Higgsfield (seed)', mount: mountMedia },
  luminara: { title: 'Luminara', sub: 'The Auma Oracle - Draw Three Glyphs', mount: mountLuminara },
  ghp: { title: 'Golden Horizon', sub: 'the boundary research — proofs, nulls, and the machine that can’t flatter you', mount: mountGhp },
  graticube: { title: 'Graticube', sub: 'the signal array — tune the deep, share what’s true', mount: mountGraticube },
  wolf: { title: 'The Wolf', sub: 'paper-only market sim — fictional instruments, never advice', mount: mountWolf },
  'aukora-xyz': { title: 'Aukora · XYZ', sub: 'the public site’s data — visitors, chats, emails', mount: mountAukoraXyz },
  settings: { title: 'Settings', sub: 'your OpenRouter key — stays on your machine', mount: mountSettings },
  arc3: { title: 'AGI · ARC 3', sub: 'her general reasoning — live on the open benchmark', mount: mountArc3 },
  browser: { title: 'Sovereign Browser', sub: 'coming soon — a governed window to the web + mesh names', mount: mountBrowser },
};

// Triangle = the apps she grew · Square = System (the engine, gate & identity) ·
// Circle = your own workspace. Labels track the active tab (see #menu-micro).
const TAB_LABELS = { organs: 'Apps', system: 'System', yours: 'Yours' };
const TABS_BUILTIN = {
  organs: [
    { organ: 'luminara', label: 'Luminara', gist: 'the Auma oracle — cast three, read the weave' },
    { organ: 'aumalive', label: 'Auma · Live', gist: 'talk to her out loud — full duplex, local' },
    { organ: 'auma', label: 'Auma · Lingwa', gist: 'learn her language — a game she grew' },
    { organ: 'ghp', label: 'Golden Horizon', gist: 'the boundary research — honest experiments and scoreboard' },
    { organ: 'arc3', label: 'AGI · ARC 3', gist: 'her general reasoning — live on the open benchmark' },
    { organ: 'wolf', label: 'The Wolf', gist: 'paper-only market lab — fictional instruments, never advice' },
    { organ: 'media', label: 'Media Portal', gist: 'generate image & video — your Higgsfield key (seed)' },
    { organ: 'browser', label: 'Sovereign Browser', gist: 'coming soon — a governed window to the web' },
    { organ: 'graticube', label: 'Graticube', gist: 'the signal array — tune the deep, share what’s true' },
  ],
  system: [
    // #357: AUMLOK then AURA lead System — the identity gate, then the living figure it grows.
    { organ: 'aumlok', label: 'AUMLOK', gist: 'the gate — where your signature lands' },
    { organ: 'aura', label: 'AURA', gist: 'your coherence, taking shape — evidence, never authority' },
    { organ: 'settings', label: 'Settings', gist: 'add your OpenRouter key — talk to Auma' },
    { organ: 'aukora-xyz', label: 'Aukora · XYZ', gist: 'the public site — visitors, chats & emails' },
    { organ: 'map', label: 'Spatial Map', gist: 'the codebase as a physics grid' },
    { organ: 'council', label: 'Fusion Council', gist: 'multi-model review runs' },
    { organ: 'kira', label: 'Kira Memory', gist: 'atoms · receipts · recall' },
    { organ: 'forge', label: 'The Forge', gist: 'two people, one bond — preview' },
    { organ: 'status', label: 'Engine Status', gist: 'HEADLESS_READY check' },
    { organ: null, label: 'Receipts', gist: 'transaction chains', soon: true },
    { organ: null, label: 'Test Waves', gist: 'live sandbox events', soon: true },
  ],
  yours: [
    { organ: 'app-lab', label: '+ New App', gist: 'open the lab and grow a workspace from chat' },
  ],
};

const { organs: ORGANS, tabs: TABS } = materializeShellModel(ORGANS_BUILTIN, TABS_BUILTIN);

let activeTab = 'organs';
let activeOrgan = 'map';
const organHost = document.getElementById('organ-host');
const menuList = document.getElementById('menu-list');
const mounted = new Map(); // organ key -> root element, kept alive across switches

function renderMenu() {
  menuList.innerHTML = '';
  for (const item of TABS[activeTab]) {
    const btn = document.createElement('button');
    btn.className = 'row menu-row' + (item.organ === activeOrgan ? ' selected' : '');
    const label = document.createElement('span');
    label.textContent = item.label;
    const gist = document.createElement('span');
    gist.className = 'row-gist';
    gist.textContent = item.gist;
    const left = document.createElement('span');
    left.append(label, gist);
    btn.append(left);
    if (item.soon) {
      const pill = document.createElement('span');
      pill.className = 'pill pill-purple soon';
      pill.textContent = 'soon';
      btn.append(pill);
    }
    if (item.organ) btn.addEventListener('click', () => setOrgan(item.organ, { collapseMenu: true }));
    else btn.disabled = true;
    menuList.append(btn);
  }
}

function setOrgan(key, options = {}) {
  activeOrgan = key;
  window.__aukoraActiveOrgan = key;
  window.dispatchEvent(new CustomEvent('aukora:organ', { detail: { organ: key } }));
  const spec = ORGANS[key];
  document.getElementById('organ-title').textContent = spec.title;
  document.getElementById('organ-sub').textContent = spec.sub;
  // organs that render their own header hide the floating map chip/wordmark
  const ownsHeader = ['auma', 'aura', 'app-lab', 'forge', 'council', 'status', 'aumlok', 'aumalive', 'media', 'luminara', 'graticube', 'wolf', 'aukora-xyz', 'settings', 'arc3', 'browser'].includes(key);
  document.getElementById('organ-chip').style.display = ownsHeader ? 'none' : '';
  document.querySelector('#lane-canvas .wordmark').style.display = ownsHeader ? 'none' : '';
  for (const [k, el] of mounted) el.style.display = k === key ? '' : 'none';
  if (!mounted.has(key)) {
    const root = document.createElement('div');
    root.style.position = 'absolute';
    root.style.inset = '0';
    organHost.append(root);
    mounted.set(key, root);
    spec.mount(root);
  }
  renderMenu();
  // Selecting an app is a view switch, not an overlay state. Return from the menu to the
  // chat-plus-app composition so the selected organ immediately occupies the existing app lane.
  if (options.collapseMenu && !mobileQuery.matches && state.d < 3) {
    state.a = 2;
    state.d = 3;
    applyLanes();
  }
  window.dispatchEvent(new Event('lane-settled'));
}

async function routeInitialOrgan() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('setup') === 'openrouter') {
    url.searchParams.delete('setup');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    setOrgan('settings');
    return;
  }
  try {
    const response = await fetch('http://127.0.0.1:7091/api/settings/openrouter', { headers: { accept: 'application/json' } });
    const status = response.ok ? await response.json() : null;
    setOrgan(status && status.present ? 'map' : 'settings');
  } catch {
    setOrgan('map');
  }
}

// Organs can ask the shell to open another organ (e.g. the AURA page → The Forge).
window.addEventListener('open-organ', (e) => { if (ORGANS[e.detail]) setOrgan(e.detail); });

const menuMicro = document.getElementById('menu-micro');
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    if (menuMicro) menuMicro.textContent = TAB_LABELS[activeTab] ?? '';
    renderMenu();
  });
});

// ---------------------------------------------------------------------------
// Hint card + boot.
// ---------------------------------------------------------------------------

const hint = document.getElementById('hint-card');
if (localStorage.getItem('aukora-spatial-hint') === 'gone') hint.classList.add('gone');
document.getElementById('hint-dismiss').addEventListener('click', () => {
  hint.classList.add('gone');
  localStorage.setItem('aukora-spatial-hint', 'gone');
});

applyLanes();
renderMenu();
void routeInitialOrgan();
loadEngineStatusCard();

// AURA breath: each earn briefly warms the shell (wordmark glow). Reads the
// CustomEvent aura-core dispatches; purely cosmetic, never gates anything.
let glowRaf = 0;
window.addEventListener('aura-changed', () => {
  const root = document.documentElement;
  let g = 1;
  root.style.setProperty('--aura-glow', '1');
  cancelAnimationFrame(glowRaf);
  const decay = () => {
    g *= 0.94;
    if (g > 0.02) { root.style.setProperty('--aura-glow', g.toFixed(3)); glowRaf = requestAnimationFrame(decay); }
    else root.style.setProperty('--aura-glow', '0');
  };
  glowRaf = requestAnimationFrame(decay);
});

export { focusNode };
