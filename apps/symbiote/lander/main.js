// aukora.xyz — page brain. No dependencies, no requests, no tracking.
// Canvases pause offscreen/hidden; reduced-motion gets calm static renders.

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HUES = {
  green: [129, 212, 180],
  blue: [150, 180, 255],
  purple: [196, 170, 255],
  red: [255, 138, 138],
  amber: [255, 205, 150],
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------------------------------------------------------------------------
// reveals + nav
// ---------------------------------------------------------------------------

const revealObs = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
  { threshold: 0.12, rootMargin: '0px 0px -5% 0px' }
);
document.querySelectorAll('.reveal').forEach((el) => {
  if (el.getBoundingClientRect().top < innerHeight * 1.1) el.classList.add('in');
  else revealObs.observe(el);
});

const nav = document.getElementById('nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 40), { passive: true });

// ---------------------------------------------------------------------------
// SOON — public-release notify modal. The repo is private today, so every
// link that would otherwise point at github.com/aumara-xyz opens this instead
// of a dead/private-repo link. One deliberate, user-initiated POST on submit —
// nothing passive, no tracking.
// ---------------------------------------------------------------------------

const soonBackdrop = document.getElementById('soon-backdrop');
const soonModal = document.getElementById('soon-modal');
const soonForm = document.getElementById('soon-form');
const soonEmail = document.getElementById('soon-email');
const soonSend = document.getElementById('soon-send');
const soonStatus = document.getElementById('soon-status');

function openSoon() {
  if (!soonModal || !soonBackdrop) return;
  soonBackdrop.hidden = false; soonModal.hidden = false;
  requestAnimationFrame(() => { soonBackdrop.classList.add('show'); soonModal.classList.add('show'); });
  setTimeout(() => soonEmail && soonEmail.focus(), 60);
}
function closeSoon() {
  if (!soonModal || !soonBackdrop) return;
  soonBackdrop.classList.remove('show'); soonModal.classList.remove('show');
  setTimeout(() => { soonBackdrop.hidden = true; soonModal.hidden = true; }, 220);
}
// The modal only exists on pages that carry it; guard so main.js runs cleanly everywhere.
if (soonModal && soonBackdrop) {
  document.getElementById('soon-close')?.addEventListener('click', closeSoon);
  soonBackdrop.addEventListener('click', closeSoon);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !soonModal.hidden) closeSoon(); });
}

// Any link pointing at the (currently private) GitHub repo opens the modal instead of navigating —
// delegated on document so it also covers links added later without extra wiring. On a page with no
// modal the click is still swallowed (never sends a visitor to the private-repo 404).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href*="github.com/aumara-xyz"]');
  if (!a) return;
  e.preventDefault();
  openSoon();
});

soonForm && soonForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = soonEmail.value.trim();
  if (!email) return;
  soonSend.disabled = true; soonEmail.disabled = true;
  soonStatus.textContent = ''; soonStatus.className = '';
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      // 503 = the notify list isn't wired up yet server-side, not a broken submit — never
      // claim success (that would be dishonest), but don't alarm a real visitor over it either.
      soonStatus.textContent = res.status === 503
        ? 'This isn’t quite live yet — check back in a bit.'
        : 'Something went wrong — try again in a moment.';
      soonStatus.className = 'err';
      soonSend.disabled = false; soonEmail.disabled = false;
      return;
    }
    soonStatus.textContent = 'Done — we’ll email you the moment it’s public.';
    soonStatus.className = 'ok';
    soonForm.hidden = true;
  } catch {
    soonStatus.textContent = 'Something went wrong — try again in a moment.';
    soonStatus.className = 'err';
    soonSend.disabled = false; soonEmail.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// canvas helper: DPR sizing + visibility-aware rAF loop
// ---------------------------------------------------------------------------

function liveCanvas(canvas, draw) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, visible = false, raf = 0;
  const t0 = performance.now();

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(() => { resize(); frame(true); }).observe(canvas);

  function frame(force) {
    cancelAnimationFrame(raf);
    const tick = () => {
      draw(ctx, w, h, (performance.now() - t0) / 1000);
      if (!REDUCED && visible && !document.hidden) raf = requestAnimationFrame(tick);
    };
    if (force || (visible && !document.hidden)) tick();
  }
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; frame(); }, { threshold: 0.05 }).observe(canvas);
  document.addEventListener('visibilitychange', () => frame());
  resize();
  frame(true);
  return { frame };
}

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

// ---------------------------------------------------------------------------
// HERO SKY — the approach. A depth-field of luminous motes you are moving
// through: everything streams gently past the viewer from a glowing vanishing
// point ahead, and every few seconds two passing motes are chained by a thin
// filament with a light traveling along it. Pointer drift steers the camera.
// Reduced motion renders one calm static frame.
// ---------------------------------------------------------------------------

(() => {
  const canvas = document.getElementById('sky');
  if (!canvas) return;
  const pointer = { x: 0, y: 0 };  // -1..1
  const cam = { x: 0, y: 0 };
  canvas.parentElement.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    pointer.y = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1;
  });
  canvas.parentElement.addEventListener('pointerleave', () => { pointer.x = 0; pointer.y = 0; });

  const HUESET = [HUES.blue, HUES.blue, HUES.blue, HUES.green, HUES.purple];
  const rnd = seededRandom(97531);
  let pts = null, links = [], lastT = 0, nextLink = 2;

  function spawn(p, far) {
    const a = rnd() * Math.PI * 2, rr = 0.16 + Math.pow(rnd(), 0.62) * 1.2;
    p.x = Math.cos(a) * rr;
    p.y = Math.sin(a) * rr * 0.7;
    p.z = far ? 0.86 + rnd() * 0.14 : 0.08 + rnd() * 0.92;
    p.hue = HUESET[(rnd() * HUESET.length) | 0];
    p.r = 0.7 + rnd() * 1.7;
    p.tw = rnd() * 7;
    p.gen = (p.gen || 0) + 1;
    p.sx = null; p.sy = null;
    return p;
  }

  liveCanvas(canvas, (ctx, w, h, t) => {
    const dt = Math.min(0.05, Math.max(0.001, t - lastT)); lastT = t;
    if (!pts) pts = Array.from({ length: Math.max(90, Math.min(230, (w * h) / 9000 | 0)) }, () => spawn({}, false));
    ctx.clearRect(0, 0, w, h);

    cam.x += (pointer.x - cam.x) * 0.035;
    cam.y += (pointer.y - cam.y) * 0.035;
    const cx = w / 2 - cam.x * w * 0.015;
    const cy = h * 0.46 - cam.y * h * 0.015;

    // the destination — a soft glow at the vanishing point everything streams from
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.45);
    glow.addColorStop(0, rgba(HUES.blue, 0.06));
    glow.addColorStop(0.4, rgba(HUES.purple, 0.022));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const f = Math.min(w, h) * 0.9;
    const speed = REDUCED ? 0 : 0.045; // z-units per second — deliberate, not frantic
    const proj = (p) => [cx + (p.x + cam.x * 0.05) * (f / p.z), cy + (p.y + cam.y * 0.05) * (f / p.z)];

    // chain filaments: link two passing motes, run a light along the link
    if (!REDUCED && t > nextLink && links.length < 3) {
      const i = (Math.random() * pts.length) | 0;
      let best = -1, bd = 1e9;
      for (let k = 0; k < 40; k++) {
        const j = (Math.random() * pts.length) | 0;
        if (j === i) continue;
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) + Math.abs(pts[i].z - pts[j].z) * 1.6;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0 && pts[i].z > 0.18 && pts[best].z > 0.18) {
        links.push({ a: pts[i], b: pts[best], ga: pts[i].gen, gb: pts[best].gen, t0: t,
          hue: [HUES.green, HUES.blue, HUES.purple][(Math.random() * 3) | 0] });
      }
      nextLink = t + 2.4 + Math.random() * 2.6;
    }

    const LIFE = 3.2;
    links = links.filter((L) => t - L.t0 < LIFE && L.a.gen === L.ga && L.b.gen === L.gb);
    for (const L of links) {
      const e = Math.sin(Math.PI * Math.min(1, (t - L.t0) / LIFE));
      const [ax, ay] = proj(L.a), [bx, by] = proj(L.b);
      ctx.strokeStyle = rgba(L.hue, 0.14 * e);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const k = (t - L.t0) / LIFE;
      const lx = ax + (bx - ax) * k, ly = ay + (by - ay) * k;
      ctx.fillStyle = rgba(L.hue, 0.75 * e);
      ctx.beginPath(); ctx.arc(lx, ly, 1.6, 0, 7); ctx.fill();
    }

    for (const p of pts) {
      if (!REDUCED) p.z -= speed * dt * (0.35 + (1 - p.z) * 1.15);
      const [sx, sy] = proj(p);
      if (p.z <= 0.055 || sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) { spawn(p, true); continue; }
      const near = 1 - p.z;
      const tw = 0.6 + 0.4 * Math.sin(t * 1.3 + p.tw);
      const alpha = Math.min(0.85, (0.12 + near * 0.75)) * tw;
      const sr = p.r * (0.32 + near * 1.9);
      // motion streak — the trace of passing through (length-capped so near
      // motes read as light, not as clutter)
      if (p.sx !== null && !REDUCED) {
        let tx = p.sx, ty = p.sy;
        const len = Math.hypot(sx - tx, sy - ty);
        if (len > 64) { const k = 64 / len; tx = sx + (tx - sx) * k; ty = sy + (ty - sy) * k; }
        ctx.strokeStyle = rgba(p.hue, alpha * 0.35);
        ctx.lineWidth = Math.max(0.6, sr * 0.55);
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(sx, sy); ctx.stroke();
      }
      p.sx = sx; p.sy = sy;
      ctx.fillStyle = rgba(p.hue, alpha);
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
    }
  });
})();

// ---------------------------------------------------------------------------
// THE WORKSPACE DEMO — a ~35s looping cinematic. The center pane is ANY app:
// its spatial map, a code change, the fusion council, the signing gate, a tool
// it grew, a game. One canvas paints every scene; the chat, the abilities
// menu, the composer lock and the hot-corner hints all sync to the timeline.
// ---------------------------------------------------------------------------

(() => {
  const stage = document.getElementById('stage');
  if (!stage) return;
  const titleEl = document.getElementById('stage-title');
  const subEl = document.getElementById('stage-sub');
  const chatEl = document.getElementById('demo-chat');
  const menuEl = document.getElementById('demo-menu');
  const dotsEl = document.getElementById('scene-dots');
  const composer = document.querySelector('.demo-composer');
  const dcField = document.getElementById('dc-field');
  const dcSend = document.getElementById('dc-send');
  const hotHint = document.getElementById('hot-hint');
  const hotTag = hotHint.querySelector('.hh-tag');
  const tabs = [...document.querySelectorAll('#smock-tabs i')];
  const cLane = stage.closest('.smock-lane');
  const cornerTL = cLane.querySelector('.sc-tl');
  const cornerTR = cLane.querySelector('.sc-tr');

  const SCENES = [
    { key: 'map',     dur: 6.5, title: 'Spatial Map',    sub: 'its code · live',              menu: 'map',     tab: 0, compose: 'ask Aukora to map itself' },
    { key: 'build',   dur: 5.5, title: 'Building',        sub: 'drafting a change',            menu: 'map',     tab: 0, compose: 'run: add a dark-mode toggle' },
    { key: 'council', dur: 6.5, title: 'Fusion Council',  sub: 'seven minds · advisory',       menu: 'council', tab: 1, compose: 'seven rivals are reading it…' },
    { key: 'lock',    dur: 5.5, title: 'The Gate',        sub: 'awaiting your signature',      menu: 'gate',    tab: 1, compose: 'one signature unlocks this change' },
    { key: 'tracker', dur: 5,   title: 'Habit Tracker',   sub: 'an app it grew for you',      menu: 'tracker', tab: 2, compose: 'build me a habit tracker' },
    { key: 'tetris',  dur: 6,   title: 'Arcade',          sub: 'the center pane is a canvas',  menu: 'tetris',  tab: 2, compose: '…now drop Tetris in there' },
  ];
  let acc = 0; SCENES.forEach((s) => { s.start = acc; acc += s.dur; });
  const LOOP = acc;
  const CF = 0.8; // crossfade seconds

  const MENU = [
    { key: 'map',     name: 'Spatial Map',    gist: 'its body, live' },
    { key: 'council', name: 'Fusion Council', gist: 'multi-model review' },
    { key: 'gate',    name: 'Aumlok Gate',    gist: 'pending · your key' },
    { key: 'kira',    name: 'Kira Memory',    gist: 'atoms · receipts' },
    { key: 'tracker', name: 'Habit Tracker',  gist: 'grown for you', app: true },
    { key: 'tetris',  name: 'Arcade',         gist: 'canvas = game', app: true },
    { key: 'new',     name: '+ New Ability',  gist: 'it builds · you sign', soon: true },
  ];
  MENU.forEach((row) => {
    const el = document.createElement('div');
    el.className = 'smock-row';
    el.dataset.key = row.key;
    const nm = document.createElement('span'); nm.textContent = row.name; el.append(nm);
    if (row.app) { const b = document.createElement('span'); b.className = 'pill pill-green soon'; b.textContent = 'new'; el.append(b); }
    if (row.soon) { const b = document.createElement('span'); b.className = 'pill pill-purple soon'; b.textContent = 'soon'; el.append(b); }
    const g = document.createElement('span'); g.className = 'sr-gist'; g.textContent = row.gist; el.append(g);
    menuEl.append(el);
  });
  const menuRows = [...menuEl.children];
  SCENES.forEach(() => dotsEl.append(document.createElement('i')));
  const dotEls = [...dotsEl.children];

  const BEATS = [
    { at: 0.4,  cls: 'you',  text: 'map yourself' },
    { at: 2.1,  cls: 'her',  text: 'Here’s my whole body — every file, live.' },
    { at: 6.8,  cls: 'you',  text: 'run: add a dark-mode toggle' },
    { at: 8.1,  cls: 'note', text: '[read_file] ui/theme.ts' },
    { at: 9.4,  cls: 'note', text: '[propose_patch] drafted · 2 files' },
    { at: 10.7, cls: 'note', text: '[sandbox] full copy · 1,852 tests ✓' },
    { at: 12.8, cls: 'note', text: '[council] 7 minds reviewing…' },
    { at: 16.8, cls: 'note', text: '[council] ▲ green quorum · advisory' },
    { at: 18.9, cls: 'her',  text: 'Sealed. I can’t apply it — that takes your key.' },
    { at: 22.4, cls: 'sign', text: 'you signed · applied ✓' },
    { at: 24.4, cls: 'you',  text: 'now build me a habit tracker' },
    { at: 26.0, cls: 'her',  text: 'Done — it lives in the center now.' },
    { at: 29.4, cls: 'you',  text: '…and drop Tetris in there' },
    { at: 31.2, cls: 'her',  text: 'The center pane is any app you want.' },
  ];
  let shown = new Set(), lastT = 1e9;
  function syncChat(T) {
    if (T < lastT) { chatEl.innerHTML = ''; shown = new Set(); }
    lastT = T;
    BEATS.forEach((b, i) => {
      if (b.at <= T && !shown.has(i)) {
        shown.add(i);
        const el = document.createElement('div');
        el.className = 'dc-msg ' + b.cls;
        if (b.cls === 'her') { const s = document.createElement('span'); s.textContent = 'AUMA'; el.append(s); }
        const p = document.createElement('p'); p.textContent = b.text; el.append(p);
        chatEl.append(el);
        while (chatEl.children.length > 6) chatEl.firstChild.remove();
      }
    });
  }

  let hotTimer = 0;
  function flashCorner(which, tag) {
    const corner = which === 'tr' ? cornerTR : cornerTL;
    if (!corner) return;
    corner.classList.remove('hot'); void corner.offsetWidth; corner.classList.add('hot');
    const lr = cLane.getBoundingClientRect();
    hotHint.style.left = (which === 'tr' ? Math.max(0, lr.width - 96) : 18) + 'px';
    hotHint.style.top = '30px';
    hotTag.textContent = tag;
    hotHint.classList.add('show', 'ripple');
    clearTimeout(hotTimer);
    hotTimer = setTimeout(() => hotHint.classList.remove('show', 'ripple'), 1300);
  }

  let lastIdx = -1;
  function syncScene(idx, tl) {
    const s = SCENES[idx];
    if (idx !== lastIdx) {
      lastIdx = idx;
      titleEl.textContent = s.title;
      subEl.textContent = s.sub;
      tabs.forEach((tb, i) => tb.classList.toggle('active', i === s.tab));
      menuRows.forEach((el) => el.classList.toggle('sel', el.dataset.key === s.menu));
      composer.classList.toggle('locked', s.key === 'lock');
      composer.classList.remove('signed');
      dcSend.innerHTML = s.key === 'lock'
        ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
        : '↑';
      dcField.textContent = s.compose;
      if (s.key === 'council') flashCorner('tr', 'hot corner · open');
      else if (s.key === 'tracker') flashCorner('tl', 'hot corner · flip app');
      else if (s.key === 'tetris') flashCorner('tr', 'hot corner · flip app');
    }
    dotEls.forEach((d, i) => d.classList.toggle('on', i === idx));
    if (s.key === 'lock' && tl > 0.58) {
      composer.classList.add('signed'); composer.classList.remove('locked');
      dcSend.textContent = '✓'; dcField.textContent = 'signed ✓ — applied to the real repo';
    }
  }

  // ---- geometry (rebuilt on resize) ----
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  let geo = null;
  function buildGeo(w, h) {
    const rnd = seededRandom(20260703);
    const CL = [
      { x: 0.30, y: 0.36, hue: HUES.blue, n: 26 },
      { x: 0.66, y: 0.28, hue: HUES.green, n: 20 },
      { x: 0.70, y: 0.68, hue: HUES.purple, n: 15 },
      { x: 0.28, y: 0.70, hue: HUES.amber, n: 11 },
    ];
    const pts = [];
    for (const c of CL) for (let i = 0; i < c.n; i++) {
      const ang = rnd() * 6.283, rad = Math.pow(rnd(), 0.6) * Math.min(w, h) * 0.17;
      pts.push({ x: c.x * w + Math.cos(ang) * rad, y: c.y * h + Math.sin(ang) * rad * 0.85, r: 1.3 + rnd() * 2.4, hue: c.hue, tw: rnd() * 7 });
    }
    const links = []; const maxD = Math.min(94, w / 5.5);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < maxD) links.push([i, j, d]);
    }
    const sig = Array.from({ length: 7 }, (_, i) => {
      const r = seededRandom(9000 + i * 77); const n = 4 + ((r() * 3) | 0);
      return Array.from({ length: n }, () => [r() * 2 - 1, r() * 2 - 1]);
    });
    geo = { w, pts, links, sig };
  }

  function drawSigil(ctx, pts, x, y, size, color, alpha) {
    ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(([px, py], i) => { const sx = x + px * size, sy = y + py * size; i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy); });
    ctx.stroke();
  }

  function drawMap(ctx, w, h, t) {
    const pts = geo.pts, links = geo.links;
    const period = 4.2, k = (t / period) | 0, ph = (t % period) / period;
    const c = [[0.30, 0.36], [0.66, 0.28], [0.70, 0.68], [0.28, 0.70]][k % 4];
    const wx = c[0] * w, wy = c[1] * h, pr = ph * Math.hypot(w, h) * 0.72;
    const wh = (k % 3 === 2) ? HUES.red : HUES.green;
    for (const [i, j, d0] of links) {
      const a = pts[i], b = pts[j];
      const dp = Math.abs(Math.hypot((a.x + b.x) / 2 - wx, (a.y + b.y) / 2 - wy) - pr);
      const gl = Math.max(0, 1 - dp / 48);
      ctx.strokeStyle = gl > 0.02 ? rgba(wh, 0.06 + gl * 0.6) : rgba(HUES.blue, 0.05 * (1 - d0 / 110));
      ctx.lineWidth = gl > 0.02 ? 1 + gl : 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const p of pts) {
      const dp = Math.abs(Math.hypot(p.x - wx, p.y - wy) - pr);
      const gl = Math.max(0, 1 - dp / 38);
      const tw = 0.6 + 0.4 * Math.sin(t * 1.1 + p.tw);
      ctx.fillStyle = gl > 0.02 ? rgba(wh, 0.5 + gl * 0.5) : rgba(p.hue, 0.6 * tw);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + gl * 2, 0, 7); ctx.fill();
    }
  }

  function drawDiff(ctx, w, h, tl) {
    const cw = Math.min(300, w * 0.76), ch = Math.min(150, h * 0.62), x = (w - cw) / 2, y = (h - ch) / 2 + 6;
    ctx.fillStyle = 'rgba(10,12,20,0.85)'; rr(ctx, x, y, cw, ch, 12); ctx.fill();
    ctx.strokeStyle = rgba(HUES.green, 0.35); ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = rgba(HUES.green, 0.85); ctx.font = '600 10px ui-monospace,monospace';
    ctx.fillText('ui/theme.ts   +2 −0', x + 14, y + 21);
    const lines = [
      { t: '  const theme = useTheme()', add: false },
      { t: '+ const [dark,setDark]=useState(0)', add: true },
      { t: '+ toggle(dark)  // its draft', add: true },
      { t: '  return <App theme={theme}/>', add: false },
    ];
    const n = Math.min(lines.length, Math.floor(tl * 5));
    ctx.font = '10px ui-monospace,monospace';
    for (let i = 0; i < n; i++) {
      const ly = y + 42 + i * 21, l = lines[i];
      if (l.add) { ctx.fillStyle = rgba(HUES.green, 0.14); ctx.fillRect(x + 8, ly - 11, cw - 16, 18); }
      ctx.fillStyle = l.add ? rgba(HUES.green, 0.95) : 'rgba(220,226,245,0.5)';
      ctx.fillText(l.t, x + 14, ly);
    }
    if (n > 0 && tl < 0.95) {
      const l = lines[n - 1], ly = y + 42 + (n - 1) * 21, tw = ctx.measureText(l.t).width;
      ctx.fillStyle = rgba(HUES.green, 0.9); ctx.fillRect(x + 14 + tw + 2, ly - 9, 5, 11);
    }
  }

  function drawCouncil(ctx, w, h, tl) {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.30, phase = tl * 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    const HU = [HUES.blue, HUES.green, HUES.purple, HUES.amber, HUES.blue, HUES.green, HUES.purple];
    for (let i = 0; i < 7; i++) {
      const ang = -Math.PI / 2 + (i / 7) * 6.283, x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
      const castAt = i * 0.5, casting = phase > castAt && phase < castAt + 0.9;
      ctx.strokeStyle = rgba(HU[i], casting ? 0.22 : 0.06); ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = rgba(HU[i], casting ? 0.95 : 0.5); ctx.beginPath(); ctx.arc(x, y, casting ? 6 : 4.5, 0, 7); ctx.fill();
      drawSigil(ctx, geo.sig[i], x + Math.cos(ang) * 24, y + Math.sin(ang) * 24, 14, HU[i], casting ? 0.95 : 0.35);
      if (phase > castAt) { const f = Math.min(1, (phase - castAt) / 2.2); if (f < 1) drawSigil(ctx, geo.sig[i], x + (cx - x) * f, y + (cy - y) * f, 10 * (1 - f * 0.5), HU[i], 0.8 * (1 - f * 0.3)); }
    }
    const fuse = Math.max(0, Math.min(1, (phase - 4.4) / 1.4));
    if (fuse > 0) {
      const s = Math.min(w, h) * 0.09, tri = [[0, -1.15], [1, 0.85], [-1, 0.85], [0, -1.15]];
      ctx.save(); ctx.shadowColor = rgba(HUES.green, 0.8); ctx.shadowBlur = phase > 6 ? 24 : 10;
      ctx.strokeStyle = rgba(HUES.green, 0.3 + fuse * 0.7); ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); const tot = tri.length - 1, up = fuse * tot;
      for (let k = 0; k <= Math.floor(up); k++) { const [px, py] = tri[Math.min(k, tot)]; k === 0 ? ctx.moveTo(cx + px * s, cy + py * s) : ctx.lineTo(cx + px * s, cy + py * s); }
      if (up < tot) { const k = Math.floor(up), f = up - k, [ax, ay] = tri[k], [bx, by] = tri[k + 1]; ctx.lineTo(cx + (ax + (bx - ax) * f) * s, cy + (ay + (by - ay) * f) * s); }
      ctx.stroke(); ctx.restore();
      if (phase > 6) { ctx.fillStyle = rgba(HUES.green, 0.9); ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.fillText('▲ green quorum — advisory', cx, cy + s * 2.3); }
    }
  }

  function drawLock(ctx, w, h, tl) {
    const cx = w / 2, cy = h / 2 - 8, signed = tl > 0.58, openA = signed ? Math.min(1, (tl - 0.58) / 0.22) : 0;
    const hue = signed ? HUES.green : HUES.amber, bw = 52, bh = 42;
    if (!signed) { ctx.strokeStyle = rgba(HUES.amber, 0.22); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy + bh / 2, 48 + Math.sin(tl * 7) * 6, 0, 7); ctx.stroke(); }
    else { const rad = openA * Math.hypot(w, h) * 0.5; ctx.strokeStyle = rgba(HUES.green, 0.4 * (1 - openA)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy + bh / 2, rad, 0, 7); ctx.stroke(); }
    ctx.strokeStyle = rgba(hue, 0.92); ctx.lineWidth = 2.4;
    const lift = openA * 9; ctx.beginPath(); ctx.arc(cx - openA * 5, cy - lift, 14, Math.PI, 0); ctx.stroke();
    rr(ctx, cx - bw / 2, cy, bw, bh, 8); ctx.stroke();
    ctx.fillStyle = rgba(hue, 0.92); ctx.beginPath(); ctx.arc(cx, cy + bh * 0.42, 4, 0, 7); ctx.fill(); ctx.fillRect(cx - 1.5, cy + bh * 0.42, 3, 10);
    ctx.textAlign = 'center'; ctx.font = '700 10px ui-monospace,monospace'; ctx.fillStyle = rgba(hue, 0.95);
    ctx.fillText(signed ? 'SIGNED ✓ · APPLIED' : 'AWAITING YOUR SIGNATURE', cx, cy + bh + 26);
  }

  function drawTracker(ctx, w, h, tl) {
    const cw = Math.min(330, w * 0.82), ch = Math.min(176, h * 0.68), x = (w - cw) / 2, y = (h - ch) / 2 + 4;
    ctx.fillStyle = 'rgba(10,12,20,0.72)'; rr(ctx, x, y, cw, ch, 14); ctx.fill();
    ctx.strokeStyle = rgba(HUES.green, 0.3); ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(244,246,255,0.92)'; ctx.font = '600 12px ui-sans-serif,system-ui';
    ctx.fillText('This week', x + 16, y + 23);
    ctx.textAlign = 'right'; ctx.fillStyle = rgba(HUES.green, 0.95); ctx.font = '700 11px ui-sans-serif,system-ui';
    ctx.fillText('held all week', x + cw - 16, y + 23);
    const habits = ['Move', 'Read', 'Build'], days = 7, labelW = 52, gridX = x + 16 + labelW, gridW = cw - 32 - labelW, gap = 7;
    const cs = Math.min(20, (gridW - (days - 1) * gap) / days), rowH = (ch - 44) / habits.length;
    for (let r = 0; r < habits.length; r++) {
      const ry = y + 40 + r * rowH;
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(220,226,245,0.62)'; ctx.font = '10px ui-sans-serif,system-ui';
      ctx.fillText(habits[r], x + 16, ry + cs * 0.72);
      for (let d = 0; d < days; d++) {
        const order = (r * days + d) / (habits.length * days), on = tl > order * 0.92;
        const px = gridX + d * (cs + gap), py = ry;
        if (on) {
          ctx.fillStyle = rgba(HUES.green, 0.8); rr(ctx, px, py, cs, cs, 5); ctx.fill();
          ctx.strokeStyle = 'rgba(10,12,20,0.9)'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(px + cs * 0.26, py + cs * 0.52); ctx.lineTo(px + cs * 0.44, py + cs * 0.70); ctx.lineTo(px + cs * 0.76, py + cs * 0.32); ctx.stroke();
        } else { ctx.strokeStyle = rgba(HUES.green, 0.28); ctx.lineWidth = 1; rr(ctx, px, py, cs, cs, 5); ctx.stroke(); }
      }
    }
  }

  function drawTetris(ctx, w, h, tl) {
    const cols = 8, rows = 12, cell = Math.min((h - 30) / rows, (w * 0.5) / cols);
    const bw = cols * cell, bh = rows * cell, x = (w - bw) / 2, y = (h - bh) / 2;
    ctx.fillStyle = 'rgba(6,8,14,0.6)'; ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, bw, bh);
    const HU = [HUES.blue, HUES.green, HUES.purple, HUES.amber];
    const blk = (cx, ry, hue, a) => { ctx.fillStyle = rgba(hue, a); rr(ctx, x + cx * cell + 1, y + ry * cell + 1, cell - 2, cell - 2, 2); ctx.fill(); };
    const stack = [[0, 11], [1, 11], [2, 11], [3, 11], [4, 11], [5, 11], [6, 11], [7, 11], [0, 10], [1, 10], [6, 10], [7, 10], [2, 10], [5, 10]];
    stack.forEach(([cx, ry], i) => blk(cx, ry, HU[i % 4], 0.8));
    const drop = Math.min(rows - 3, Math.floor(tl * 15));
    blk(3, drop, HUES.green, 0.95); blk(4, drop, HUES.green, 0.95); blk(3, drop - 1, HUES.green, 0.95); blk(4, drop - 1, HUES.green, 0.95);
    if (tl > 0.82) { const f = (tl - 0.82) / 0.18; ctx.fillStyle = rgba(HUES.green, 0.5 * (1 - f)); ctx.fillRect(x, y + 11 * cell, bw, cell); }
    ctx.fillStyle = 'rgba(220,226,245,0.5)'; ctx.font = '9.5px ui-monospace,monospace'; ctx.textAlign = 'center';
    ctx.fillText('rendered on KNVS — the same canvas', w / 2, y + bh + 18);
  }

  function paint(ctx, w, h, t, key, into, dur, a) {
    const tl = Math.max(0, Math.min(1, into / dur));
    ctx.save(); ctx.globalAlpha = a;
    if (key === 'map') drawMap(ctx, w, h, t);
    else if (key === 'build') { ctx.save(); ctx.globalAlpha *= 0.4; drawMap(ctx, w, h, t); ctx.restore(); drawDiff(ctx, w, h, tl); }
    else if (key === 'council') drawCouncil(ctx, w, h, tl);
    else if (key === 'lock') drawLock(ctx, w, h, tl);
    else if (key === 'tracker') drawTracker(ctx, w, h, tl);
    else if (key === 'tetris') drawTetris(ctx, w, h, tl);
    ctx.restore();
  }

  liveCanvas(stage, (ctx, w, h, t) => {
    if (!geo || Math.abs(geo.w - w) > 60) buildGeo(w, h);
    ctx.clearRect(0, 0, w, h);
    // window.__demoSeek (a number of seconds) lets a tester freeze the loop on
    // one scene; undefined in normal use → the live loop.
    const seek = window.__demoSeek;
    const T = (typeof seek === 'number') ? seek : (REDUCED ? 4 : (t % LOOP));
    let idx = 0; for (let i = 0; i < SCENES.length; i++) { if (T >= SCENES[i].start) idx = i; }
    const s = SCENES[idx], into = T - s.start;
    paint(ctx, w, h, t, s.key, into, s.dur, 1);
    if (!REDUCED && s.dur - into < CF) {
      const nx = SCENES[(idx + 1) % SCENES.length], a = (CF - (s.dur - into)) / CF;
      paint(ctx, w, h, t, nx.key, 0.001, nx.dur, a);
    }
    syncScene(idx, into / s.dur);
    syncChat(T);
  });
})();

// ---------------------------------------------------------------------------
// THE BINDING — a live illustration of the real acrostic mechanic: one
// 6-letter anchor word, then six words whose first letters spell it back in
// order. This demo's own tiny wordlist is illustrative only; the real
// ceremony runs offline, in a terminal, from a much larger wordlist, and
// never touches a network — see the caption under the widget.
// ---------------------------------------------------------------------------

(() => {
  const anchorEl = document.getElementById('bind-anchor');
  const wordsEl = document.getElementById('bind-words');
  const phraseEl = document.getElementById('bind-phrase');
  const recastBtn = document.getElementById('bind-recast');
  if (!anchorEl) return;

  const ANCHORS = ['garden', 'beacon', 'orchid', 'falcon', 'silver', 'temple', 'willow', 'meadow', 'harbor', 'copper'];
  const POOL = {
    a: ['amber', 'anchor', 'arbor', 'aspen', 'antler', 'azure'],
    b: ['beacon', 'bramble', 'bridge', 'brook', 'blossom', 'banner'],
    c: ['candle', 'cinder', 'copper', 'canyon', 'comet', 'cradle'],
    d: ['dune', 'delta', 'dagger', 'dahlia', 'drift', 'dover'],
    e: ['ember', 'echo', 'egret', 'elm', 'evening', 'essence'],
    f: ['falcon', 'feather', 'fable', 'forge', 'frost', 'fern'],
    g: ['garden', 'glacier', 'goblet', 'grove', 'gravel', 'gander'],
    h: ['harbor', 'hollow', 'hearth', 'heron', 'hammer', 'haven'],
    i: ['island', 'ivory', 'ibis', 'iris', 'indigo', 'inkwell'],
    l: ['ladder', 'lantern', 'lagoon', 'larch', 'lumen', 'lyric'],
    m: ['meadow', 'mirror', 'maple', 'marsh', 'mist', 'mosaic'],
    n: ['nectar', 'nimbus', 'nettle', 'north', 'nova', 'nook'],
    o: ['orchid', 'otter', 'opal', 'oasis', 'ochre', 'orbit'],
    p: ['pillar', 'prairie', 'pebble', 'petal', 'pewter', 'plume'],
    r: ['river', 'raven', 'ridge', 'ribbon', 'rocket', 'root'],
    s: ['silver', 'sparrow', 'saddle', 'spruce', 'summit', 'seedling'],
    t: ['temple', 'thistle', 'thread', 'tundra', 'timber', 'tidal'],
    v: ['velvet', 'violet', 'vessel', 'vale', 'vapor', 'verge'],
    w: ['willow', 'walnut', 'wren', 'wharf', 'whisper', 'wander'],
  };

  function renderBinding(anchor, words) {
    anchorEl.innerHTML = '';
    const letterSpans = [...anchor].map((ch) => {
      const s = document.createElement('span');
      s.className = 'anchor-letter';
      s.textContent = ch.toUpperCase();
      anchorEl.append(s);
      return s;
    });
    wordsEl.innerHTML = '';
    phraseEl.textContent = '…';
    phraseEl.classList.remove('shown');
    const chips = words.map((w, i) => {
      const chip = document.createElement('div');
      chip.className = 'word-chip';
      const idx = document.createElement('span');
      idx.className = 'wc-idx';
      idx.textContent = anchor[i].toUpperCase();
      const rest = document.createElement('span');
      rest.className = 'wc-word';
      rest.innerHTML = `<b>${w[0]}</b>${w.slice(1)}`;
      chip.append(idx, rest);
      wordsEl.append(chip);
      return chip;
    });
    const step = REDUCED ? 0 : 460;
    chips.forEach((chip, i) => {
      setTimeout(() => {
        chip.classList.add('shown');
        letterSpans[i].classList.add('active');
      }, step * (i + 1));
    });
    setTimeout(() => {
      phraseEl.textContent = `${anchor} ${words.join(' ')}`;
      phraseEl.classList.add('shown');
    }, step * (words.length + 1));
  }

  function castNew() {
    const anchor = ANCHORS[(Math.random() * ANCHORS.length) | 0];
    const words = [...anchor].map((ch) => {
      // never let the anchor word echo itself back as one of the six —
      // confusing to read, even though it's cosmetically harmless
      const pool = (POOL[ch] || [ch]).filter((w) => w !== anchor);
      return pool[(Math.random() * pool.length) | 0];
    });
    renderBinding(anchor, words);
  }

  recastBtn.addEventListener('click', castNew);
  let played = false;
  function playOnce() {
    if (played) return;
    played = true;
    castNew();
  }
  new IntersectionObserver((e) => { if (e[0].isIntersecting) playOnce(); }, { threshold: 0.3 }).observe(anchorEl);
  if (anchorEl.getBoundingClientRect().top < innerHeight) playOnce();
})();


// ---------------------------------------------------------------------------
// THE COUNCIL — seven minds cast glyphs; the verdict fuses in the center
// ---------------------------------------------------------------------------

(() => {
  const canvas = document.getElementById('council-ring');
  if (!canvas) return;

  // each mind gets its own procedural sigil: a small angular stroke-walk
  const SIGILS = Array.from({ length: 7 }, (_, i) => {
    const rnd = seededRandom(9000 + i * 77);
    const n = 4 + ((rnd() * 3) | 0);
    return Array.from({ length: n }, () => [rnd() * 2 - 1, rnd() * 2 - 1]);
  });
  const MEMBER_HUES = [HUES.blue, HUES.green, HUES.purple, HUES.amber, HUES.blue, HUES.green, HUES.purple];
  // the real, executed Fusion Council roster (dashboard/fu/run-council.ts) —
  // full names + providers are in the legend under the canvas.
  const MEMBER_NAMES = ['Claude', 'GPT-5.5', 'GLM-5.2', 'Kimi', 'DeepSeek', 'Qwen', 'Mistral'];
  const PERIOD = 12;

  function drawSigil(ctx, pts, x, y, size, color, alpha, lw = 1.4) {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const sx = x + px * size, sy = y + py * size;
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.stroke();
  }

  liveCanvas(canvas, (ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.32;
    const phase = REDUCED ? 7.0 : t % PERIOD;

    // orbit ring
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();

    for (let i = 0; i < 7; i++) {
      const ang = -Math.PI / 2 + (i / 7) * Math.PI * 2 + (REDUCED ? 0 : t * 0.02);
      const x = cx + Math.cos(ang) * R;
      const y = cy + Math.sin(ang) * R;
      const castAt = i * 0.85;
      const casting = phase > castAt && phase < castAt + 0.85;
      const cast = Math.max(0, Math.min(1, (phase - castAt) / 0.85));

      // spoke
      ctx.strokeStyle = rgba(MEMBER_HUES[i], casting ? 0.22 : 0.06);
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.setLineDash([]);

      // node + its sigil hovering above — sized up so it reads clearly on the
      // now-smaller ring
      ctx.fillStyle = rgba(MEMBER_HUES[i], casting ? 0.95 : 0.45);
      ctx.beginPath(); ctx.arc(x, y, casting ? 6.5 : 5, 0, 7); ctx.fill();
      drawSigil(ctx, SIGILS[i], x + Math.cos(ang) * 30, y + Math.sin(ang) * 30, 17,
        MEMBER_HUES[i], casting ? 0.95 : 0.35, 1.8);

      // label — the real model's short name
      ctx.fillStyle = casting ? rgba(MEMBER_HUES[i], 0.85) : 'rgba(220,226,245,0.42)';
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(MEMBER_NAMES[i], x + Math.cos(ang) * 46, y + Math.sin(ang) * 46 + 3);

      // the glyph travels the spoke
      if (phase > castAt && phase < 7.0) {
        const f = Math.min(1, (phase - castAt) / 1.6);
        const gx = x + (cx - x) * f, gy = y + (cy - y) * f;
        if (f < 1) drawSigil(ctx, SIGILS[i], gx, gy, 12 * (1 - f * 0.5), MEMBER_HUES[i], 0.85 * (1 - f * 0.4), 1.6);
      }
    }

    // fusion: the verdict triangle draws itself, then burns green
    const fuse = Math.max(0, Math.min(1, (phase - 6.6) / 1.2));
    const hold = phase > 7.8 && phase < 10.6;
    const fade = phase >= 10.6 ? 1 - Math.min(1, (phase - 10.6) / 1.4) : 1;
    if (fuse > 0) {
      const s = Math.min(w, h) * 0.085;
      const tri = [[0, -1.15], [1, 0.85], [-1, 0.85], [0, -1.15]];
      ctx.save();
      ctx.shadowColor = rgba(HUES.green, 0.8 * fade);
      ctx.shadowBlur = hold ? 26 : 10;
      ctx.strokeStyle = rgba(HUES.green, (0.25 + fuse * 0.7) * fade);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const total = tri.length - 1;
      const upto = fuse * total;
      for (let k = 0; k <= Math.floor(upto); k++) {
        const [px, py] = tri[Math.min(k, total)];
        k === 0 ? ctx.moveTo(cx + px * s, cy + py * s) : ctx.lineTo(cx + px * s, cy + py * s);
      }
      if (upto < total) {
        const k = Math.floor(upto), f = upto - k;
        const [ax, ay] = tri[k], [bx, by] = tri[k + 1];
        ctx.lineTo(cx + (ax + (bx - ax) * f) * s, cy + (ay + (by - ay) * f) * s);
      }
      ctx.stroke();
      ctx.restore();
      if (hold) {
        ctx.fillStyle = rgba(HUES.green, 0.9);
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('▲ green quorum — advisory', cx, cy + s * 2.1);
      }
    } else {
      ctx.fillStyle = 'rgba(220,226,245,0.25)';
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 7); ctx.fill();
    }
  });
})();

// ---------------------------------------------------------------------------
// ASK AUMA — the floating chat. A real model behind /api/chat, page-only
// transcript (nothing stored anywhere), honest errors, no fake replies.
// ---------------------------------------------------------------------------

(() => {
  const fab = document.getElementById('ora-fab');
  const panel = document.getElementById('ora-panel');
  const closeBtn = document.getElementById('ora-close');
  const msgsEl = document.getElementById('ora-msgs');
  const form = document.getElementById('ora-form');
  const input = document.getElementById('ora-text');
  const sendBtn = document.getElementById('ora-send');
  if (!fab || !panel) return;

  const history = []; // {role, content} — lives only on this page, capped
  let busy = false;

  // a stable id for THIS page session, so a whole conversation logs to one file
  let convId = '';
  const newId = () => 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  try { convId = sessionStorage.getItem('auma-conv-id') || newId(); sessionStorage.setItem('auma-conv-id', convId); }
  catch { convId = newId(); }

  // best-effort: log real conversations so we can grow an FAQ from what people
  // actually ask (and notice how they treat it). Pure fire-and-forget — it
  // never blocks a reply or surfaces an error into the chat.
  function logConversation() {
    try {
      fetch('/api/log-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ convId, messages: history }),
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  // --- tiny, XSS-safe markdown renderer (escape first, then transform) ---
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[i] + '</code>');
    return s;
  }

  function renderMarkdown(src) {
    const lines = escapeHtml(src.trim()).split('\n');
    const out = [];
    let para = [], list = null;
    const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push('<ul>' + list.map((li) => '<li>' + inline(li) + '</li>').join('') + '</ul>'); list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flushPara(); flushList(); continue; }
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        flushPara(); flushList();
        const lvl = m[1].length + 2; // # -> h3, ## -> h4, ### -> h5
        out.push(`<h${lvl}>` + inline(m[2]) + `</h${lvl}>`);
      } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
        flushPara();
        (list = list || []).push(m[1]);
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara(); flushList();
    return out.join('');
  }

  function setOpen(open) {
    fab.setAttribute('aria-expanded', String(open));
    if (open) {
      panel.hidden = false;
      requestAnimationFrame(() => panel.classList.add('open'));
      setTimeout(() => input.focus(), 250);
    } else {
      panel.classList.remove('open');
      setTimeout(() => { panel.hidden = true; }, 300);
    }
  }
  fab.addEventListener('click', () => setOpen(panel.hidden));
  closeBtn.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });

  function addMsg(cls, content, asMarkdown) {
    const el = document.createElement('div');
    el.className = `ora-msg ${cls}`;
    const bub = document.createElement('div');
    bub.className = 'bub';
    if (cls === 'think') bub.innerHTML = '<span class="ora-dots"><i></i><i></i><i></i></span>';
    else if (asMarkdown) bub.innerHTML = renderMarkdown(content);
    else bub.textContent = content;
    el.append(bub);
    msgsEl.append(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return el;
  }

  // autogrow composer + disabled-state send button
  function autogrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 128) + 'px';
  }
  function syncSend() { sendBtn.disabled = busy || !input.value.trim(); }
  input.addEventListener('input', () => { autogrow(); syncSend(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    input.value = '';
    autogrow();
    syncSend();
    addMsg('you', text);
    history.push({ role: 'user', content: text });
    while (history.length > 12) history.shift();
    const think = addMsg('think', '');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      think.remove();
      if (!res.ok || !data.reply) {
        addMsg('err', data.error || 'Aukora couldn’t answer just now — try again in a moment.');
      } else {
        addMsg('her', data.reply, true);
        history.push({ role: 'assistant', content: data.reply });
        logConversation();
      }
    } catch {
      think.remove();
      addMsg('err', 'the connection dropped — try again in a moment.');
    }
    busy = false;
    syncSend();
    input.focus();
  });

  // "ask it yourself" — after each scripted Auma thread, a small bubble with a
  // right-pointing arrow that opens THIS live chat, so a reader can pick up where
  // the demo left off and ask for themselves. The arrow gently nudges to hint the
  // chat is here.
  document.querySelectorAll('.auma-thread').forEach((thread) => {
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'thread-cta';
    cta.setAttribute('aria-label', 'Ask Aukora yourself — open the live chat');
    cta.innerHTML = '<span>Ask it yourself</span>'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    cta.addEventListener('click', () => setOpen(true));
    thread.append(cta);
  });
})();
