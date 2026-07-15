// Trinity interface walkthrough — drives the shell-mock in #workspace as a real
// choreographed demo: show all three rooms, pick an app, push the canvas open,
// flip back to the menu, then throw the chat full-width and talk. Corners flash
// once on each push (no endless pulse). Pure DOM + one small canvas, no deps.

const mock = document.getElementById('shell-mock');
if (mock) run();

function run() {
  const laneL = mock.querySelector('.smock-l');
  const laneC = mock.querySelector('.smock-c');
  const laneR = mock.querySelector('.smock-r');
  const stage = document.getElementById('stage');
  const stageTitle = document.getElementById('stage-title');
  const demoChat = document.getElementById('demo-chat');
  const demoMenu = document.getElementById('demo-menu');
  const composer = mock.querySelector('.demo-composer');
  const dcField = document.getElementById('dc-field');
  const narrate = document.getElementById('mock-narrate');
  const cornerCR = laneC.querySelector('.sc-tr');   // center → push the menu out
  const cornerL = laneL.querySelector('.sc-tr');    // chat → open full-width
  const stageSub = document.getElementById('stage-sub');

  // ---- an "app she grew": a habit tracker that precipitates into the center ----
  const style = document.createElement('style');
  style.textContent = `
  .smock-appcard { position:absolute; z-index:3; left:50%; top:56%; transform:translate(-50%,-50%) scale(0.94);
    width:min(80%, 430px); padding:20px 22px; border-radius:16px; box-sizing:border-box;
    border:1px solid rgba(255,255,255,0.1); background:rgba(14,17,27,0.9); backdrop-filter:blur(8px);
    box-shadow:0 24px 60px rgba(0,0,0,0.45); opacity:0; pointer-events:none;
    transition:opacity 0.5s ease, transform 0.5s ease; }
  .smock-appcard.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
  .sa-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:16px; }
  .sa-head span { font-size:15px; font-weight:600; color:#fff; }
  .sa-head b { font-size:13px; font-weight:600; color:rgba(var(--hue-l),0.98); }
  .sa-row { display:flex; align-items:center; gap:14px; margin:11px 0; }
  .sa-label { width:42px; font-size:13px; color:var(--dim); }
  .sa-cells { display:flex; gap:7px; }
  .sa-cells i { width:24px; height:24px; border-radius:6px; display:grid; place-items:center;
    font-size:13px; border:1.5px solid rgba(255,255,255,0.12); color:transparent; }
  .sa-cells i.on { border-color:rgba(var(--hue-l),0.5); background:rgba(var(--hue-l),0.2); color:rgba(var(--hue-l),1); }
  `;
  document.head.append(style);
  const appCard = document.createElement('div');
  appCard.className = 'smock-appcard';
  appCard.innerHTML = '<div class="sa-head"><span>This week</span><b>held all week</b></div>' +
    [['Move', 7], ['Read', 7], ['Build', 3]].map(([label, done]) =>
      '<div class="sa-row"><span class="sa-label">' + label + '</span><div class="sa-cells">' +
      Array.from({ length: 7 }, (_, i) => '<i class="' + (i < done ? 'on' : '') + '">✓</i>').join('') +
      '</div></div>').join('');
  laneC.append(appCard);

  const cssHue = (name, fb) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fb;
  };
  const hueC = cssHue('--hue-c', '150,180,255');
  const hueL = cssHue('--hue-l', '129,212,180');

  // ---- the abilities menu (matches the real Apps tab) ----
  const APPS = [
    ['Spatial Map', 'her code, live', 'map'],
    ['Auma · Lingwa', 'learn her language', 'auma'],
    ['AURA', 'living coherence', 'aura'],
    ['The Forge', 'two-person bond', 'forge'],
    ['Fusion Council', 'model reviews', 'council'],
  ];
  demoMenu.innerHTML = '';
  const rows = {};
  APPS.forEach(([name, gist, key], i) => {
    const row = document.createElement('div');
    row.className = 'smock-row';
    row.style.animationDelay = (0.05 * i) + 's';
    row.innerHTML = name + '<span class="sr-gist">' + gist + '</span>';
    demoMenu.append(row);
    rows[key] = row;
  });
  const setSel = (key) => { for (const k in rows) rows[k].classList.toggle('sel', k === key); };

  // ---- lane widths ----
  function setLanes(l, c, r) {
    laneL.style.flexGrow = l; laneC.style.flexGrow = c; laneR.style.flexGrow = r;
    laneL.classList.toggle('narrow', l < 0.1);
    laneC.classList.toggle('narrow', c < 0.1);
    laneR.classList.toggle('narrow', r < 0.1);
  }
  function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

  // ---- the chat, driven by the narrative: off → you ask → she answers ----
  let chatMode = '';
  function setChat(mode) {
    if (mode === chatMode) return;
    chatMode = mode;
    demoChat.innerHTML = '';
    dcField.textContent = mode === 'off' ? 'ask her to build anything…' : 'build me a habit tracker';
    const add = (cls, text, who) => {
      const m = document.createElement('div');
      m.className = 'dc-msg ' + cls;
      if (who) m.innerHTML = '<span>' + who + '</span>';
      const p = document.createElement('p'); p.textContent = text; m.append(p);
      demoChat.append(m);
    };
    if (mode === 'done') add('her', 'Done — it lives in the center now.', 'Auma');
  }

  function say(html) {
    narrate.classList.add('fading');
    setTimeout(() => { narrate.innerHTML = html; narrate.classList.remove('fading'); }, 200);
  }

  // ---- the choreography: three rooms → ask → the governed loop → an app she
  //      grew lives in the center → flip to the menu → chat full-width ----
  const MAP = { title: 'Spatial Map', sub: 'her code · live' };
  const HABIT = { title: 'Habit Tracker', sub: 'an app she grew for you' };
  const STEPS = [
    { say: 'Welcome to the <b>Trinity interface</b>.', lanes: [1, 1.3, 1], sel: null, chat: 'off', app: false, scene: MAP, dur: 2800 },
    { say: 'Three rooms — <b>you</b> on the left, a <b>living canvas</b> in the center, every <b>ability</b> on the right.', lanes: [1, 1.3, 1], sel: null, chat: 'off', app: false, scene: MAP, dur: 3600 },
    { say: 'Ask her to build anything.', lanes: [1, 1.3, 1], sel: 'map', chat: 'ask', app: false, scene: MAP, dur: 2800 },
    { say: 'She drafts it, sandboxes it, the council reads it — then <b>you sign it in</b>.', lanes: [1, 1.3, 1], sel: 'map', chat: 'ask', app: false, scene: MAP, dur: 3600 },
    { say: 'And it <b>lives in the center</b> — an app she grew for you.', lanes: [1, 2.7, 0.04], sel: 'map', chat: 'done', app: true, scene: HABIT, flash: 'cr', dur: 3800 },
    { say: 'Flip back to the <b>menu</b> any time…', lanes: [1, 1.3, 1], sel: 'map', chat: 'done', app: true, scene: HABIT, flash: 'cr', dur: 2600 },
    { say: 'Or throw the <b>chat</b> full-width to keep talking.', lanes: [3, 0.04, 0.04], sel: 'map', chat: 'done', app: false, scene: MAP, flash: 'l', dur: 3400 },
  ];

  function apply(s) {
    say(s.say);
    stageTitle.textContent = s.scene.title;
    if (stageSub) stageSub.textContent = s.scene.sub;
    setSel(s.sel);
    setChat(s.chat);
    appCard.classList.toggle('show', !!s.app);
    const lanes = () => setLanes(...s.lanes);
    if (s.flash) { flash(s.flash === 'cr' ? cornerCR : cornerL); setTimeout(lanes, 240); }
    else lanes();
  }

  // ---- runner + visibility gating ----
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = false, idx = 0, timer = 0, started = false;

  function tick() {
    const s = STEPS[idx];
    apply(s);
    idx = (idx + 1) % STEPS.length;
    timer = setTimeout(tick, s.dur);
  }

  if (reduced) {
    // static, complete state — no motion
    setLanes(1, 1.3, 1); setSel('map'); say('The <b>Trinity interface</b> — talk, canvas, abilities.');
    running = true; startStage();
    return;
  }

  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      running = e.isIntersecting;
      if (e.isIntersecting && !started) { started = true; startStage(); tick(); }
      else if (e.isIntersecting && !timer) tick();
      else if (!e.isIntersecting && timer) { clearTimeout(timer); timer = 0; }
    }
  }, { threshold: 0.25 });
  io.observe(mock);

  // ---- center-stage constellation (her spatial map, live) ----
  let stageRaf = 0;
  function startStage() {
    const ctx = stage.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const N = 15;
    const pts = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0005, vy: (Math.random() - 0.5) * 0.0005,
      r: 1.6 + Math.random() * 3.4,
    }));
    function fit() { const b = stage.getBoundingClientRect(); W = b.width; H = b.height; stage.width = W * dpr; stage.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    fit();
    window.addEventListener('resize', fit);
    function draw() {
      stageRaf = requestAnimationFrame(draw);
      if (!running) return;
      if (W < 8 || H < 8) { fit(); return; }
      ctx.clearRect(0, 0, W, H);
      for (const p of pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > 1) p.vx *= -1; if (p.y < 0 || p.y > 1) p.vy *= -1; }
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const a = pts[i], b = pts[j], dx = (a.x - b.x) * W, dy = (a.y - b.y) * H, d = Math.hypot(dx, dy);
        if (d < 120) { ctx.strokeStyle = 'rgba(' + hueC + ',' + (0.14 * (1 - d / 120)).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke(); }
      }
      for (let i = 0; i < N; i++) { const p = pts[i]; ctx.fillStyle = 'rgba(' + (i % 3 === 0 ? hueL : hueC) + ',0.85)'; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2); ctx.fill(); }
    }
    draw();
  }
}
