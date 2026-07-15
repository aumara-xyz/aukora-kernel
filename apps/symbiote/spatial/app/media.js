// Aukora Spatial — MEDIA PORTAL: the connected creative surface (SEED / shell).
//
// This is a planted seed, not a finished organ. The SURFACE is here — modes,
// prompt, a living portal, a job tray, a gallery — but the pipe that actually
// generates media is NOT wired yet, on purpose. It gets finished from the
// inside-out later, so it's done correctly and governed.
//
// HONEST LABEL (this organ is different from the sovereign brain): media
// generation is OUTBOUND. When wired, a prompt goes to Higgsfield's cloud GPUs
// through the Higgsfield CLI already installed on THIS machine (auth: the
// owner's own `higgsfield auth login` session — no key ever lives in the
// browser), spends the owner's OWN Higgsfield credits, and returns image/video
// URLs. A creation is NOT a memory, is NOT receipted into the brain, and grants
// NOTHING. It's an optional creative tool that reaches the world, clearly so.
//
// The real command surface it will drive (verified from `higgsfield --help`,
// CLI v1.1.5) is documented in docs/MEDIA_PORTAL.md. Nothing here calls out.

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// The modes map to the CLI's real command groups, so nothing here is invented.
const MODES = [
  { id: 'image',     label: 'Image',     gist: 'text → image (nano_banana, flux, gpt-image…)', cli: 'generate create <model>',          hue: 'r' },
  { id: 'video',     label: 'Video',     gist: 'image/text → video (seedance, veo, kling…)',   cli: 'generate create <model> --image', hue: 'c' },
  { id: 'soul',      label: 'Soul',      gist: 'a consistent character across shots',           cli: 'soul-id / generate --reference',  hue: 'l' },
  { id: 'product',   label: 'Product',   gist: 'brand-quality product photography',             cli: 'product-photoshoot',              hue: 'o' },
  { id: 'marketing', label: 'Marketing', gist: 'ads & marketing-studio assets',                cli: 'marketing-studio',                hue: 'r' },
];

// alien glyphs for the "unwired" shimmer where results will land
const GLYPHS = '◬◭◮◈◇⟁⟒⌖⌬⍟⨀⨁⟡✦∴∵⋈⧊';
const glyphRun = (n) => { let s = ''; for (let j = 0; j < n; j++) s += GLYPHS[(Math.random() * GLYPHS.length) | 0]; return s; };

// ---------------------------------------------------------------------------
// The portal — a living aperture (three hues) that idles until it's given a
// real pipe. Raw canvas, no deps, cheap.
// ---------------------------------------------------------------------------
function createPortal(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const hue = (n, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim().split(',').map(parseFloat); return v.length === 3 && !v.some(Number.isNaN) ? v : fb; };
  const HL = hue('--hue-l', [129, 212, 180]), HC = hue('--hue-c', [150, 180, 255]), HR = hue('--hue-r', [196, 170, 255]);
  const P = { energy: 0.35 }; // rises when (later) a job is live

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.42, R = Math.min(W, H) * 0.28;
    const rings = 5;
    for (let i = rings; i >= 0; i--) {
      const f = i / rings;
      const rr = R * (0.35 + f * 0.9) + Math.sin(t * 0.8 + i) * 6 * (0.4 + P.energy);
      const A = i % 2 ? HC : (i % 3 ? HR : HL);
      ctx.beginPath();
      for (let a = 0; a <= 6.2832; a += 0.12) {
        const wob = 1 + 0.05 * Math.sin(a * 6 + t * (1.1 + f) + i) * (0.5 + P.energy);
        const x = cx + Math.cos(a + t * 0.15 * (i % 2 ? 1 : -1)) * rr * wob;
        const y = cy + Math.sin(a + t * 0.15 * (i % 2 ? 1 : -1)) * rr * wob;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${A[0]|0},${A[1]|0},${A[2]|0},${(0.05 + f * 0.16 + P.energy * 0.1).toFixed(3)})`;
      ctx.lineWidth = 1 + f * 1.5;
      ctx.stroke();
    }
    // core aperture
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
    g.addColorStop(0, `rgba(${HC[0]|0},${HC[1]|0},${HC[2]|0},${(0.12 + P.energy * 0.2).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, 6.2832); ctx.fill();
  }

  let t0 = performance.now();
  (function loop(now) { requestAnimationFrame(loop); if (canvas.offsetParent === null) return; draw((now - t0) / 1000); })(performance.now());
  resize(); window.addEventListener('resize', resize); window.addEventListener('lane-settled', resize);
  return P;
}

// ---------------------------------------------------------------------------

export function mountMedia(root) {
  injectStyle();
  const app = el('div', 'mdp-app');
  const canvas = document.createElement('canvas'); canvas.className = 'mdp-canvas';
  app.append(canvas, el('div', 'mdp-scan'), el('div', 'mdp-vignette'));

  // head
  const head = el('div', 'mdp-head');
  const brand = el('div', 'mdp-brand'); brand.append(el('b', null, 'MEDIA PORTAL'), el('span', null, 'connected creative surface'));
  const status = el('div', 'mdp-status');
  status.innerHTML = '<span class="mdp-chip seed">SEED</span><span class="mdp-stat">Higgsfield CLI · installed · not wired yet</span>';
  head.append(brand, status); app.append(head);

  // stage: portal + a "results land here" shimmer
  const stage = el('div', 'mdp-stage');
  const shimmer = el('div', 'mdp-shimmer'); shimmer.textContent = glyphRun(10);
  const shimLabel = el('div', 'mdp-shimlabel', 'your creations will bloom here');
  stage.append(shimmer, shimLabel); app.append(stage);
  setInterval(() => { if (shimmer.offsetParent) shimmer.textContent = glyphRun(10); }, 1400);

  // mode row
  const modeRow = el('div', 'mdp-modes'); let mode = 'image';
  MODES.forEach((m) => {
    const b = el('button', 'mdp-mode h-' + m.hue + (m.id === mode ? ' on' : '')); b.type = 'button';
    b.append(el('span', 'mdp-dot'), el('b', null, m.label), el('i', null, m.gist));
    b.title = 'CLI: higgsfield ' + m.cli;
    b.addEventListener('click', () => { mode = m.id; [...modeRow.children].forEach((c) => c.classList.toggle('on', c === b)); });
    modeRow.append(b);
  });
  app.append(modeRow);

  // console
  const bar = el('div', 'mdp-bar');
  const input = document.createElement('textarea'); input.className = 'mdp-input'; input.rows = 2;
  input.placeholder = 'describe what to create — “cinematic product shot of a glass orb on wet stone, dawn light”';
  const gen = el('button', 'mdp-gen', 'Generate'); gen.type = 'button';
  bar.append(input, gen); app.append(bar);

  // the honest seed state — click Generate → truthful notice, no network
  const notice = el('div', 'mdp-notice');
  notice.innerHTML = 'The surface is planted; the pipe isn’t wired yet. When it is, this runs the <b>Higgsfield CLI on this machine</b> (your own <code>higgsfield auth login</code> session, your own credits) — no key ever touches the browser, and a creation is never a memory. Finishing it from the inside, so it’s done right.';
  notice.style.display = 'none';
  gen.addEventListener('click', () => {
    notice.style.display = '';
    gen.classList.add('pulse'); setTimeout(() => gen.classList.remove('pulse'), 600);
    portal.energy = Math.min(1, portal.energy + 0.4);
    setTimeout(() => { portal.energy = 0.35; }, 1500);
  });
  app.append(notice);

  // job tray + gallery (empty seeds)
  const trays = el('div', 'mdp-trays');
  const jobs = el('div', 'mdp-tray'); jobs.append(el('div', 'mdp-tray-k', 'RENDER QUEUE'), el('div', 'mdp-empty', 'no jobs yet — the queue lights up when the pipe lands'));
  const gallery = el('div', 'mdp-tray'); gallery.append(el('div', 'mdp-tray-k', 'GALLERY'), el('div', 'mdp-empty', 'nothing forged yet'));
  trays.append(jobs, gallery); app.append(trays);

  app.append(el('div', 'mdp-foot', 'outbound / connected organ — reaches Higgsfield on your own account & credits · not the sovereign brain · a creation is not a memory and grants nothing'));

  root.append(app);
  const portal = createPortal(canvas);
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .mdp-app { --mdp-o:255,184,120; position:absolute; inset:0; overflow:auto; display:flex; flex-direction:column; color:var(--text);
    background:
      radial-gradient(1000px 680px at 14% -6%, rgba(var(--hue-l),0.10), transparent 60%),
      radial-gradient(920px 640px at 86% 106%, rgba(var(--hue-r),0.13), transparent 60%),
      radial-gradient(760px 600px at 50% 42%, rgba(var(--hue-c),0.08), transparent 66%),
      #131826; }
  .mdp-canvas { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; opacity:0.9; }
  .mdp-scan { position:absolute; inset:0; pointer-events:none; opacity:0.14; background:repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,0.03) 3px 4px); }
  .mdp-vignette { position:absolute; inset:0; pointer-events:none; background:radial-gradient(120% 120% at 50% 40%, transparent 64%, rgba(9,12,20,0.4) 100%); }

  .mdp-head { position:relative; z-index:2; flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:16px 22px 0; }
  .mdp-brand b { font-size:14px; letter-spacing:0.24em;
    background:linear-gradient(100deg, rgba(var(--hue-l),1), rgba(var(--hue-c),1) 55%, rgba(var(--hue-r),1));
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .mdp-brand span { margin-left:11px; font-size:11px; color:var(--dim); }
  .mdp-status { display:flex; align-items:center; gap:9px; }
  .mdp-chip { font-size:8.5px; letter-spacing:0.18em; padding:3px 9px; border-radius:9px; font-family:ui-monospace,monospace; border:1px solid rgba(255,255,255,0.16); color:var(--faint); }
  .mdp-chip.seed { color:rgba(var(--mdp-o),1); border-color:rgba(var(--mdp-o),0.5); background:rgba(var(--mdp-o),0.09); }
  .mdp-stat { font-size:10px; letter-spacing:0.12em; color:var(--dim); font-family:ui-monospace,monospace; }

  .mdp-stage { position:relative; z-index:2; flex:none; height:190px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; }
  .mdp-shimmer { font-size:22px; letter-spacing:0.2em; color:rgba(var(--hue-c),0.6); text-shadow:0 0 22px rgba(var(--hue-c),0.45); }
  .mdp-shimlabel { font-size:11px; letter-spacing:0.14em; color:var(--faint); text-transform:lowercase; }

  /* aligned grid — equal cards, wraps evenly, centred (no more crunch) */
  .mdp-modes { position:relative; z-index:2; flex:none; display:grid; grid-template-columns:repeat(auto-fit, minmax(148px, 1fr)); gap:9px;
    width:min(720px, calc(100% - 40px)); margin:8px auto 0; }
  .mdp-mode { --mh:var(--hue-r); position:relative; display:flex; flex-direction:column; align-items:flex-start; gap:3px; text-align:left; cursor:pointer;
    padding:11px 13px; border-radius:14px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); backdrop-filter:blur(8px);
    transition:border-color 0.16s ease, background 0.16s ease, transform 0.14s ease; }
  .mdp-mode.h-l { --mh:var(--hue-l); } .mdp-mode.h-c { --mh:var(--hue-c); } .mdp-mode.h-r { --mh:var(--hue-r); } .mdp-mode.h-o { --mh:var(--mdp-o); }
  .mdp-dot { position:absolute; top:12px; right:12px; width:7px; height:7px; border-radius:50%; background:rgba(var(--mh),0.9); box-shadow:0 0 9px rgba(var(--mh),0.6); }
  .mdp-mode b { font-size:13px; color:#fff; font-weight:600; } .mdp-mode i { font-size:9.5px; font-style:normal; line-height:1.4; color:var(--faint); }
  .mdp-mode:hover { transform:translateY(-1px); border-color:rgba(var(--mh),0.45); background:rgba(var(--mh),0.07); }
  .mdp-mode.on { border-color:rgba(var(--mh),0.6); background:rgba(var(--mh),0.12); box-shadow:0 0 18px rgba(var(--mh),0.2); }
  .mdp-mode.on b { color:rgba(var(--mh),1); }

  .mdp-bar { position:relative; z-index:2; flex:none; display:flex; align-items:flex-end; gap:11px; margin:14px auto 0; width:min(720px, calc(100% - 40px));
    padding:11px 12px; border-radius:18px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); backdrop-filter:blur(12px); }
  .mdp-input { flex:1; min-width:0; resize:none; font:inherit; font-size:14px; line-height:1.5; color:var(--text); background:transparent; border:none; outline:none; padding:6px 4px; }
  .mdp-input::placeholder { color:var(--faint); }
  .mdp-gen { flex:none; align-self:stretch; padding:0 22px; border-radius:13px; font-size:14px; font-weight:650; cursor:pointer; color:#131826; border:none;
    background:linear-gradient(100deg, rgba(var(--hue-l),0.96), rgba(var(--hue-c),0.96) 55%, rgba(var(--hue-r),0.96)); transition:transform 0.16s ease, box-shadow 0.2s ease; }
  .mdp-gen:hover { box-shadow:0 0 24px rgba(var(--hue-c),0.4); }
  .mdp-gen.pulse { transform:scale(0.96); }

  .mdp-notice { position:relative; z-index:2; margin:13px auto 0; max-width:660px; padding:0 20px; font-size:12px; line-height:1.65; color:var(--dim); text-align:center; }
  .mdp-notice b { color:rgba(var(--hue-c),0.98); font-weight:600; } .mdp-notice code { font-size:11px; padding:1px 6px; border-radius:6px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:var(--dim); }

  .mdp-trays { position:relative; z-index:2; display:grid; grid-template-columns:1fr 1fr; gap:12px; width:min(720px, calc(100% - 40px)); margin:18px auto 0; }
  @media (max-width:560px){ .mdp-trays { grid-template-columns:1fr; } }
  .mdp-tray { padding:14px 15px; border-radius:15px; border:1px solid rgba(255,255,255,0.09); background:rgba(255,255,255,0.03); }
  .mdp-tray:first-child { border-color:rgba(var(--hue-c),0.22); } .mdp-tray:last-child { border-color:rgba(var(--hue-l),0.22); }
  .mdp-tray-k { font-size:9px; letter-spacing:0.22em; color:var(--faint); margin-bottom:10px; }
  .mdp-empty { font-size:12px; color:var(--faint); line-height:1.5; min-height:44px; }

  .mdp-foot { position:relative; z-index:2; flex:none; text-align:center; padding:18px 16px 20px; margin-top:auto; font-size:9.5px; letter-spacing:0.06em; color:var(--faint); font-family:ui-monospace,monospace; }
  `;
  const tag = document.createElement('style'); tag.id = 'media-style'; tag.textContent = css; document.head.append(tag);
}
