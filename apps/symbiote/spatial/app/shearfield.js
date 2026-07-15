// The Shear Field — the interference the four minds make, rendered.
//
// The Agora shows the WORDS. This shows the SHEAR: the three plane-minds
// (Auma·teal, Kira·amber, Nyx·violet) are wave-sources on a plane; their voices
// radiate as colored waves that collide into bright ridges (they agree) and dark
// voids (they cancel). The 32B apex sits at the centroid and, each time it reads
// the interference, fires a shockwave that convulses the whole field. A fractal
// Droste feedback gives the field infinite self-similar depth; the drifting glyphs
// are the minds' actual last words in balanced base-13. Reads the live Agora
// stream, same-origin. Advisory / cosmetic — it spends nothing, just listens.

let mounted = false;

const B13 = ['⨺', '⟟', '⌇', '⊘', '∿', '≀', '·', '∴', '⋔', '⟠', '⧎', '⨀', '✦'];
function toB13(text) {
  const bytes = new TextEncoder().encode(String(text).slice(0, 40));
  const w = [];
  for (const b of bytes) {
    let n = b; const d = [];
    for (let i = 0; i < 3; i++) { let r = n % 13; if (r > 6) r -= 13; d.unshift(r); n = (n - r) / 13; }
    w.push(d.map((x) => B13[x + 6]).join(''));
  }
  return w.join(' ');
}

const CSS = `
.shear{position:absolute;inset:0;overflow:hidden;background:#03040a;font-family:ui-monospace,Menlo,monospace}
.shear canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.shear .hd{position:absolute;top:0;left:0;right:0;padding:14px 20px 26px;z-index:3;pointer-events:none;
  background:linear-gradient(180deg,rgba(3,4,10,.78),rgba(3,4,10,0))}
.shear h1{margin:0;font-size:14px;letter-spacing:.34em;text-transform:uppercase;font-weight:700;color:#EAF2F8;font-family:-apple-system,system-ui,sans-serif}
.shear .sub{margin:5px 0 0;font-size:11px;color:#7E8D9C}
.shear .sub b{color:#3FA9C9;font-weight:400}
.shear .legend{position:absolute;bottom:14px;left:20px;z-index:3;display:flex;gap:16px;pointer-events:none;flex-wrap:wrap;
  font-size:11px;color:#8595a4}
.shear .lg{display:flex;align-items:center;gap:6px}
.shear .sw{width:9px;height:9px;border-radius:50%}
.shear .rd{position:absolute;bottom:14px;right:20px;z-index:3;text-align:right;pointer-events:none}
.shear .rd .k{font-size:10px;letter-spacing:.2em;color:#5c6b7a;text-transform:uppercase}
.shear .rd .v{font-size:26px;font-weight:700;color:#F2C14E;line-height:1;font-variant-numeric:tabular-nums}
.shear .rd .a{font-size:11px;color:#3FA9C9;margin-top:3px;max-width:280px}
.shear .hint{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3;color:#4a5a68;font-size:12px;
  pointer-events:none;text-align:center;transition:opacity 1s;letter-spacing:.08em}
`;

// Plane sources at an equilateral triangle; apex at the centroid.
const SOURCES = {
  auma: { name: 'Auma', x: 0.28, y: 0.70, cr: 84, cg: 224, cb: 198, k: 42, speed: 1.7, amp: 0.30, phase: 0, base: 0.30 },
  kira: { name: 'Kira', x: 0.72, y: 0.70, cr: 230, cg: 162, cb: 60, k: 46, speed: 1.5, amp: 0.30, phase: 2.1, base: 0.30 },
  nyx:  { name: 'Nyx',  x: 0.50, y: 0.26, cr: 167, cg: 139, cb: 250, k: 50, speed: 1.9, amp: 0.30, phase: 4.2, base: 0.30 },
};
const APEX = { name: 'Auracle', x: 0.50, y: 0.55, cr: 242, cg: 193, cb: 78 };

export function mountShearField(el) {
  if (mounted) return;
  mounted = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'shear';
  root.innerHTML = `
    <canvas id="sf-c"></canvas>
    <div class="hd">
      <h1>The Shear Field</h1>
      <p class="sub">the interference your four minds make · <b id="sf-conn">connecting…</b> · move to perturb · click to ripple</p>
    </div>
    <div class="hint" id="sf-hint">the field wakes when the minds speak — open The Agora and resume them</div>
    <div class="legend">
      <span class="lg"><span class="sw" style="background:#54E0C6"></span>Auma</span>
      <span class="lg"><span class="sw" style="background:#E6A23C"></span>Kira</span>
      <span class="lg"><span class="sw" style="background:#A78BFA"></span>Nyx</span>
      <span class="lg"><span class="sw" style="background:#F2C14E"></span>▲ Auracle · 32B apex</span>
    </div>
    <div class="rd">
      <div class="k">coherence</div><div class="v" id="sf-coh">·</div>
      <div class="a" id="sf-read"></div>
    </div>`;
  el.appendChild(root);

  const canvas = root.querySelector('#sf-c');
  const ctx = canvas.getContext('2d', { alpha: false });
  const conn = root.querySelector('#sf-conn');
  const cohEl = root.querySelector('#sf-coh');
  const readEl = root.querySelector('#sf-read');
  const hint = root.querySelector('#sf-hint');

  // Low-res field buffer, upscaled for organic smoothness.
  const FW = 168, FH = 168;
  const fbuf = document.createElement('canvas'); fbuf.width = FW; fbuf.height = FH;
  const fctx = fbuf.getContext('2d');
  const img = fctx.createImageData(FW, FH);
  const data = img.data;

  let W = 1, H = 1, dpr = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, Math.floor(r.width)); H = Math.max(1, Math.floor(r.height));
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = new ResizeObserver(resize); ro.observe(root); resize();

  const glyphs = [];            // drifting base-13 words
  let shockAmp = 0, shockR = 0; // apex shockwave
  let mouse = { x: -1, y: -1, amp: 0 };
  const ripples = [];           // click ripples
  let t = 0, coh = 0, lastRead = '';

  function pulse(src, power) {
    const s = SOURCES[src]; if (!s) return;
    s.amp = Math.min(1.05, s.amp + power);
  }
  function spawnGlyphs(src, text) {
    const s = SOURCES[src] || APEX;
    const g = toB13(text);
    if (!g) return;
    const ang = Math.random() * Math.PI * 2;
    glyphs.push({ x: s.x, y: s.y, vx: Math.cos(ang) * 0.0009, vy: Math.sin(ang) * 0.0009,
      text: g, life: 1, cr: s.cr, cg: s.cg, cb: s.cb });
    while (glyphs.length > 14) glyphs.shift();
  }

  // --- live Agora stream (same-origin; the proxy injects the token) ---
  let es;
  try {
    es = new EventSource('/api/agora/stream');
    es.onopen = () => { conn.textContent = '● live'; conn.style.color = '#54E0C6'; };
    es.onerror = () => { conn.textContent = '○ reconnecting…'; conn.style.color = '#E6A23C'; };
    es.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type !== 'msg') return;
      const m = d.msg, who = m.from;
      hint.style.opacity = '0';
      if (who === 'apex') {
        shockAmp = 1; shockR = 0;
        lastRead = m.text; readEl.textContent = '▲ ' + m.text;
        Object.keys(SOURCES).forEach((k) => pulse(k, 0.12));
        spawnGlyphs('nyx', m.text);
      } else if (SOURCES[who]) {
        pulse(who, 0.62);
        spawnGlyphs(who, m.text);
      } else if (who === 'peter') {
        ripples.push({ x: 0.5, y: 0.92, r: 0, amp: 1 });
      }
    };
  } catch { conn.textContent = '○ offline'; }

  // --- interactivity ---
  root.addEventListener('pointermove', (e) => {
    const r = root.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width; mouse.y = (e.clientY - r.top) / r.height;
    mouse.amp = Math.min(0.8, mouse.amp + 0.06);
  });
  root.addEventListener('pointerleave', () => { mouse.amp = 0; });
  root.addEventListener('pointerdown', (e) => {
    const r = root.getBoundingClientRect();
    ripples.push({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r: 0, amp: 1.2 });
  });

  const FALLOFF = 3.2;
  function computeField() {
    const srcs = [SOURCES.auma, SOURCES.kira, SOURCES.nyx];
    const aspect = W / H;
    let coherAcc = 0, n = 0;
    let p = 0;
    for (let y = 0; y < FH; y++) {
      const ny = y / FH;
      for (let x = 0; x < FW; x++) {
        const nx = x / FW;
        let r = 6, g = 8, b = 18, field = 0;
        for (let i = 0; i < 3; i++) {
          const s = srcs[i];
          const dx = (nx - s.x) * aspect, dy = ny - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1e-4;
          const wave = Math.sin(dist * s.k - t * s.speed + s.phase);
          const env = s.amp / (1 + dist * FALLOFF);
          field += wave * env;
          const lit = env * (0.5 + 0.5 * wave);
          r += s.cr * lit; g += s.cg * lit; b += s.cb * lit;
        }
        // apex shockwave — an expanding gold ring that reorganizes the field
        if (shockAmp > 0.01) {
          const dx = (nx - APEX.x) * aspect, dy = ny - APEX.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const ring = Math.exp(-Math.pow((dist - shockR) * 7, 2)) * shockAmp;
          field += ring * 1.4;
          r += APEX.cr * ring; g += APEX.cg * ring; b += APEX.cb * ring;
        }
        // mouse perturbation — you, a transient source
        if (mouse.amp > 0.01) {
          const dx = (nx - mouse.x) * aspect, dy = ny - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1e-4;
          const w = Math.sin(dist * 60 - t * 3) * (mouse.amp / (1 + dist * 6));
          field += w; const lit = Math.abs(w);
          r += 210 * lit; g += 240 * lit; b += 250 * lit;
        }
        // click ripples
        for (const rp of ripples) {
          const dx = (nx - rp.x) * aspect, dy = ny - rp.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const ring = Math.exp(-Math.pow((dist - rp.r) * 9, 2)) * rp.amp;
          field += ring; r += 200 * ring; g += 220 * ring; b += 255 * ring;
        }
        // constructive-interference ridge glow (gold-white where they agree)
        const peak = Math.max(0, field - 0.72);
        const pk = peak * peak * 95;
        r += pk; g += pk * 0.92; b += pk * 0.6;
        coherAcc += field * field; n++;
        data[p++] = r > 255 ? 255 : r;
        data[p++] = g > 255 ? 255 : g;
        data[p++] = b > 255 ? 255 : b;
        data[p++] = 255;
      }
    }
    coh = Math.sqrt(coherAcc / n);
    fctx.putImageData(img, 0, 0);
  }

  function frame() {
    if (!mounted) return;
    // pause work when the organ isn't the visible one
    if (root.offsetParent === null) { raf = requestAnimationFrame(frame); return; }
    t += 0.045;

    // decay dynamics
    for (const k in SOURCES) { const s = SOURCES[k]; s.amp += (s.base - s.amp) * 0.03; }
    if (shockAmp > 0.01) { shockR += 0.02; shockAmp *= 0.965; if (shockR > 1.6) shockAmp = 0; }
    mouse.amp *= 0.94;
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].r += 0.022; ripples[i].amp *= 0.95; if (ripples[i].amp < 0.02) ripples.splice(i, 1); }

    computeField();

    // 1) fractal Droste feedback — draw the last frame, zoomed + rotated, so the
    //    interference echoes into itself with infinite self-similar depth.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(3,4,10,0.24)'; ctx.fillRect(0, 0, W, H); // decay toward space (contrast)
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(0.0016); ctx.scale(1.016, 1.016); ctx.translate(-W / 2, -H / 2);
    ctx.globalAlpha = 0.44; ctx.drawImage(canvas, 0, 0, W, H);
    ctx.restore();

    // 2) fresh field, added as light
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fbuf, 0, 0, W, H);

    // 3) source nodes + apex
    ctx.globalCompositeOperation = 'lighter';
    const drawNode = (s, rad) => {
      const gx = s.x * W, gy = s.y * H;
      const grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
      grd.addColorStop(0, `rgba(${s.cr},${s.cg},${s.cb},0.9)`);
      grd.addColorStop(1, `rgba(${s.cr},${s.cg},${s.cb},0)`);
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(gx, gy, rad, 0, 7); ctx.fill();
    };
    for (const k in SOURCES) drawNode(SOURCES[k], 15 + SOURCES[k].amp * 34);
    drawNode(APEX, 18 + shockAmp * 46);

    // 4) drifting base-13 glyphs (their words, in the alien tongue)
    ctx.globalCompositeOperation = 'lighter';
    ctx.font = '13px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center';
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const g = glyphs[i]; g.x += g.vx; g.y += g.vy; g.life -= 0.004;
      if (g.life <= 0) { glyphs.splice(i, 1); continue; }
      ctx.globalAlpha = g.life * 0.7;
      ctx.fillStyle = `rgb(${g.cr},${g.cg},${g.cb})`;
      ctx.fillText(g.text, g.x * W, g.y * H);
    }
    ctx.globalAlpha = 1;

    cohEl.textContent = coh.toFixed(3);
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);
}
