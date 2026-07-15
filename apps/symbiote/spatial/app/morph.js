// Aukora Spatial — KNVS morph surface: a living, fluid WebGL2 canvas that
// continuously reforms. The seed of the "gaming engine" idea — a substrate she
// can become anything on. Raw WebGL2, zero deps, one fullscreen raymarch pass.
//
// Today it renders an autonomous metaball field (organic, breathing, endless).
// It is deliberately a generic surface: a generated app / tool can later mount
// over it and transition in. Nothing here is claimed to be "her" thinking —
// it's a canvas, honestly a canvas.

import { mountKnvsDuplex } from '/app/knvs-duplex.js';

const VS = `#version 300 es
precision highp float;
const vec2 V[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
void main(){ gl_Position = vec4(V[gl_VertexID], 0., 1.); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_mouse;   // -1..1
uniform vec3  u_hl;      // green 0..1
uniform vec3  u_hc;      // blue  0..1
uniform vec3  u_hr;      // purple 0..1
uniform float u_pulse;   // 0..1 aura-earned ripple, decays per frame
uniform float u_spread;  // -0.4..0.4 gather bias (user/chat control)
uniform float u_you;     // 0..1 YOU are speaking      -> green,  inward shiver
uniform float u_think;   // 0..1 she is THINKING       -> blue,   swirling churn
uniform float u_her;     // 0..1 SHE is speaking        -> purple, ripples bloom out
out vec4 outColor;

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0-h);
}
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

// The field: N metaballs that gather into an orb and spread into a ring — an
// endless "becoming". Her state reshapes the topology in real time: thinking
// tightens and swirls it, speaking blooms it outward with traveling ripples,
// your voice sends a fine shiver through the whole body.
float map(vec3 p){
  float t = u_time;
  float act = clamp(u_you + u_think + u_her, 0.0, 1.6);
  p.xz *= rot(t*0.13 + u_mouse.x*0.5);
  p.xy *= rot(t*0.09 - u_mouse.y*0.4);
  // THINKING: a churn — the deeper you go, the more it twists (a mind turning over)
  float swirl = u_think * (0.7*sin(t*0.6) + 0.9);
  p.xz *= rot(swirl * (0.55 + length(p)*0.5));
  // gather: breathing + control bias, pulled tight while thinking, bloomed while she speaks
  float gather = clamp(0.5 + 0.5*sin(t*0.22) + u_spread + u_think*0.34 - u_her*0.30, 0.0, 1.0);
  float d = 1e5;
  const int N = 7;
  for(int i=0;i<N;i++){
    float fi = float(i);
    float ang = fi/float(N)*6.28318 + t*(0.28 + u_her*0.20);   // she speaks -> a gentle spin, not a lurch
    float rad = mix(1.25, 0.18, gather) * (0.82 + 0.18*sin(t*0.6+fi*1.3));
    vec3 c = vec3(cos(ang)*rad, sin(ang*1.3 + t*0.2)*rad*0.55, sin(ang)*rad);
    c.y += 0.22*sin(t*0.85 + fi*1.7);
    float r = mix(0.26, 0.44, gather) * (1.0 + act*0.07*sin(t*1.2 + fi*1.9));
    d = smin(d, length(p-c) - r, 0.55);
  }
  d = smin(d, length(p) - mix(0.14, 0.46, gather), 0.55);
  // surface life — SLOW, gentle swells (kept low-frequency so she breathes, not twitches):
  float rr = length(p);
  d -= u_her * 0.03 * sin(rr*6.0 - t*2.4);                  // her voice: slow rings bloom outward
  d -= u_you * 0.02 * sin(p.y*9.0 + t*4.0);                 // your voice: gentle shiver
  d += (0.006 + act*0.008) * sin(p.x*7.0 + t*1.1) * sin(p.z*7.0 - t*0.9); // idle ambient roil
  return d;
}

vec3 nrm(vec3 p){
  vec2 e = vec2(0.0016, 0.0);
  return normalize(vec3(
    map(p+e.xyy)-map(p-e.xyy),
    map(p+e.yxy)-map(p-e.yxy),
    map(p+e.yyx)-map(p-e.yyx)));
}

void main(){
  vec2 uv = (gl_FragCoord.xy*2.0 - u_res) / u_res.y;
  vec3 ro = vec3(0.0, 0.0, 3.7);
  vec3 rd = normalize(vec3(uv, -1.65));
  float t = 0.0; float d = 0.0; bool hit = false;
  for(int i=0;i<78;i++){
    d = map(ro + rd*t);
    if(d < 0.0012){ hit = true; break; }
    t += d*0.85;
    if(t > 8.5) break;
  }

  // ---- her MOOD as color -------------------------------------------------
  // green = you speak · blue = she thinks · purple = she speaks. When nothing
  // is happening she still has slow autonomous moods (the palette drifts), so
  // she reads as alive, not idle.
  float wY = u_you, wT = u_think, wH = u_her;
  float amt = clamp(wY + wT + wH, 0.0, 1.0);
  vec3 moodOn = (u_hl*wY + u_hc*wT + u_hr*wH) / max(wY+wT+wH, 0.0001);
  float mA = 0.5+0.5*sin(u_time*0.070);
  float mB = 0.5+0.5*sin(u_time*0.053 + 2.1);
  float mC = 0.5+0.5*sin(u_time*0.041 + 4.2);
  vec3 moodIdle = (u_hl*mA + u_hc*mB + u_hr*mC) / (mA+mB+mC);
  vec3 mood = mix(moodIdle, moodOn, amt);

  vec3 col = vec3(0.0); float alpha = 0.0;
  if(hit){
    vec3 p = ro + rd*t;
    vec3 n = nrm(p);
    vec3 lig = normalize(vec3(0.55, 0.8, 0.65));
    float diff = clamp(dot(n, lig), 0.0, 1.0);
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.6);
    // body gradient keeps spatial variety, but rides ON the current mood so the
    // whole being clearly greens / blues / purples with her state
    float g = 0.5 + 0.5*sin(p.y*1.4 + u_time*0.25);
    vec3 grad = mix(u_hl, u_hc, g);
    grad = mix(grad, u_hr, smoothstep(0.35, 1.0, 0.5 + 0.5*n.x));
    vec3 base = mix(grad, mood, 0.35 + 0.6*amt);   // idle: mostly gradient · active: mostly mood
    col = base * (0.18 + 0.82*diff);
    col = mix(col, mood, fres*0.62);          // mood-tinted fresnel rim
    col = col*col*(3.0 - 2.0*col);            // smoothstep contrast: richer, less washout
    col += base*0.06;                          // faint ambient fill
    col += mood * u_pulse * (0.35 + 0.65*fres); // pulse bloom in the current mood
    col += mood * u_her * fres * 0.5;          // she speaks: the rim lights purple
    alpha = 0.96;
  } else {
    float g = exp(-length(uv)*1.25);
    col = mood * g * (0.09 + 0.22*u_pulse + 0.18*amt);
    alpha = g*(0.22 + 0.2*u_pulse + 0.14*amt);
  }
  col = pow(max(col, 0.0), vec3(0.85));
  outColor = vec4(col, alpha);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// read a "r, g, b" CSS var and return a normalized [r,g,b] in 0..1
function hue(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(',').map((x) => parseFloat(x));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return fallback;
  return parts.map((x) => x / 255);
}

export function mountMorph(root) {
  injectStyle();
  const wrap = document.createElement('div');
  wrap.className = 'knvs-app';
  const canvas = document.createElement('canvas');
  canvas.className = 'knvs-canvas';
  wrap.append(canvas);

  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const label = mk('div', 'knvs-label');
  label.innerHTML = '<b>KNVS</b><span>the living substrate — she can become anything</span>';
  wrap.append(label);

  // info toggle + panel: what KNVS actually is
  const infoBtn = mk('button', 'knvs-info-btn', 'ⓘ what is this');
  infoBtn.type = 'button';
  wrap.append(infoBtn);
  const info = mk('div', 'knvs-info');
  info.innerHTML = `
    <h4>KNVS — the Kinetic Neural Visual Substrate</h4>
    <p>This isn’t a screensaver. It’s the <b>substrate</b>: the whole center of the workspace is one canvas she can paint anything on — a map, a tool, a game, a form she grows on request.</p>
    <p>Right now it breathes on its own, and <b>you can shape it</b> with the controls below. Where it’s going: the <b>chat drives it</b>. You ask her for something in words, and it takes form right here — eventually she can reshape almost anything in the system from a sentence. This living sphere is the seed of that.</p>
    <p class="knvs-honest">Today: an autonomous surface you can nudge. The chat-driven, app-forming version is coming.</p>`;
  const infoClose = mk('button', 'knvs-info-close', 'got it');
  infoClose.type = 'button';
  info.append(infoClose);
  wrap.append(info);
  infoBtn.addEventListener('click', () => info.classList.toggle('open'));
  infoClose.addEventListener('click', () => info.classList.remove('open'));

  // control strip — nudge the substrate now (a preview of chat-driven control)
  let energy = 1.0, spread = 0.0;
  let pulse = 0;
  const live = { mic: 0, say: 0, think: 0, open: false, phrase: 0 };
  const controls = mk('div', 'knvs-controls');
  const seg = (labelText, opts, defIdx, apply) => {
    const row = mk('div', 'knvs-seg');
    row.append(mk('span', 'knvs-seg-label', labelText));
    const grp = mk('div', 'knvs-seg-btns');
    const btns = opts.map(([name, val], i) => {
      const b = mk('button', 'knvs-seg-btn' + (i === defIdx ? ' on' : ''), name);
      b.type = 'button';
      b.addEventListener('click', () => { btns.forEach((x) => x.classList.remove('on')); b.classList.add('on'); apply(val); });
      grp.append(b);
      return b;
    });
    row.append(grp);
    controls.append(row);
  };
  seg('energy', [['calm', 0.4], ['flow', 1.0], ['vivid', 1.9]], 1, (v) => { energy = v; });
  seg('form', [['gather', -0.34], ['drift', 0.0], ['scatter', 0.34]], 1, (v) => { spread = v; });
  wrap.append(controls);

  const echo = mk('div', 'knvs-echo', 'live preview channel · closed');
  wrap.append(echo);

  function setEcho(text) {
    echo.textContent = text;
    echo.classList.add('lit');
    setTimeout(() => echo.classList.remove('lit'), 900);
  }

  function applyPreviewPhrase(text, who) {
    const t = String(text || '').toLowerCase();
    let touched = false;
    if (/\b(gather|condense|cohere|center|name)\b/.test(t)) {
      spread = -0.34; touched = true;
      setEcho(`${who === 'you' ? 'your' : 'her'} phrase gathered the field`);
    }
    if (/\b(scatter|expand|open|burst|galaxy)\b/.test(t)) {
      spread = 0.34; touched = true;
      setEcho(`${who === 'you' ? 'your' : 'her'} phrase opened the field`);
    }
    if (/\b(calm|soft|slow|quiet)\b/.test(t)) {
      energy = 0.45; touched = true;
      setEcho('energy softened');
    }
    if (/\b(vivid|ignite|alien|bright|alive|warm|warming|trefoil|knot|spiral)\b/.test(t)) {
      energy = Math.min(1.9, Math.max(energy, 1.55));
      pulse = 1; live.phrase = 1; touched = true;
      setEcho('the surface warmed');
    }
    if (/\b(pulse|ripple|wave|speak|voice)\b/.test(t)) {
      pulse = 1; live.phrase = 1; touched = true;
      setEcho('preview pulse');
    }
    if (touched) {
      controls.querySelectorAll('.knvs-seg-btn').forEach((b) => b.classList.remove('on'));
    }
  }

  // ---- Brick 3: the cinematic intro — "the becoming" ----------------------
  // A short, skippable overture the first time KNVS opens in this browser:
  // the substrate starts as scattered dust, gathers into the one body, pulses
  // in a speech-like rhythm (the same duplex energy as AUMA · LIVE), then
  // settles into its resting breath as the controls fade in. Pure choreography
  // of the EXISTING uniforms — honest captions, no new claims.
  const introUI = mk('div', 'knvs-intro');
  const introTitle = mk('div', 'knvs-intro-title');
  introTitle.innerHTML = '<b>KNVS</b><i>the Kinetic Neural Visual Substrate</i>';
  const introCap = mk('div', 'knvs-intro-cap', '');
  const introSkip = mk('div', 'knvs-intro-skip', 'click to skip');
  introUI.append(introTitle, introCap, introSkip);
  wrap.append(introUI);
  const replayBtn = mk('button', 'knvs-replay', '▶ intro');
  replayBtn.type = 'button'; replayBtn.title = 'replay the opening';
  wrap.append(replayBtn);

  // intro state consumed by the frame loop: overrides spread, drives pulse
  const intro = { on: false, t0: 0, spread: null, voice: 0 };
  const TIMELINE = [
    { at: 0.0,  cap: '' },
    { at: 1.1,  cap: 'The center of her world is one surface.' },
    { at: 4.0,  cap: 'It gathers. It breathes. It ripples when either of you speaks.' },
    { at: 7.6,  cap: 'Ask, and it takes form here — a map, a tool, a game.' },
    { at: 10.4, cap: 'The becoming is governed. Nothing lands without your key.' },
  ];
  const INTRO_LEN = 13.2;
  let capIdx = -1;

  function setChrome(hidden) {
    [label, infoBtn, controls, replayBtn].forEach((n) => n.classList.toggle('knvs-chrome-hidden', hidden));
  }
  function startIntro() {
    intro.on = true; intro.t0 = performance.now(); capIdx = -1;
    introUI.classList.add('on'); introTitle.classList.remove('in'); introCap.textContent = '';
    setChrome(true);
  }
  function endIntro() {
    intro.on = false; intro.spread = null; intro.voice = 0;
    introUI.classList.remove('on');
    setChrome(false);
    try { localStorage.setItem('knvs-intro-seen', '1'); } catch { /* */ }
  }
  // drive the overture; called each frame while intro.on
  function introTick(now) {
    const p = (now - intro.t0) / 1000;
    if (p >= INTRO_LEN) { endIntro(); return; }
    if (p > 0.4) introTitle.classList.add('in');
    if (p > 3.6) introTitle.classList.add('lift');
    for (let i = TIMELINE.length - 1; i >= 0; i--) {
      if (p >= TIMELINE[i].at) {
        if (capIdx !== i) { capIdx = i; introCap.classList.remove('in'); introCap.textContent = TIMELINE[i].cap; requestAnimationFrame(() => introCap.classList.add('in')); }
        break;
      }
    }
    // phase 1 (0–4s): dust → gather.  phase 2 (4–7.6s): speech-like ripple.
    // phase 3 (7.6–11s): gather tight (a "form"), then release to breath.
    if (p < 4) intro.spread = 0.4 - 0.74 * Math.min(1, p / 3.4);
    else if (p < 7.6) { intro.spread = -0.34 + 0.1 * Math.sin(p * 2.1); intro.voice = Math.max(0, Math.sin(p * 6.8) * 0.6 + Math.sin(p * 11.7) * 0.4) * 0.8; }
    else if (p < 11) { intro.spread = -0.34; intro.voice *= 0.92; }
    else { intro.spread = -0.34 + 0.34 * Math.min(1, (p - 11) / 2.0); intro.voice = 0; }
  }
  introUI.addEventListener('click', endIntro);
  replayBtn.addEventListener('click', startIntro);
  let introSeen = false;
  try { introSeen = localStorage.getItem('knvs-intro-seen') === '1'; } catch { /* */ }

  root.append(wrap);

  mountKnvsDuplex(wrap, {
    onMicLevel(v) {
      live.mic = Math.max(live.mic, v);
      pulse = Math.min(1, pulse + v * 0.04);
    },
    onSpeakingLevel(v) {
      live.say = Math.max(live.say, v);
      pulse = Math.min(1, pulse + v * 0.05);
    },
    onThinking(on) {
      live.think = on ? 1 : 0;
    },
    onOpenChange(open) {
      live.open = open;
      pulse = 1;
      setEcho(open ? 'live preview channel · listening' : 'live preview channel · closed');
    },
    onUtterance(text, who) {
      applyPreviewPhrase(text, who);
    },
  });

  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) {
    label.innerHTML = '<b>KNVS</b><span>WebGL2 is unavailable — this surface needs it.</span>';
    return;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
  gl.useProgram(prog);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const u = {
    res: gl.getUniformLocation(prog, 'u_res'),
    time: gl.getUniformLocation(prog, 'u_time'),
    mouse: gl.getUniformLocation(prog, 'u_mouse'),
    hl: gl.getUniformLocation(prog, 'u_hl'),
    hc: gl.getUniformLocation(prog, 'u_hc'),
    hr: gl.getUniformLocation(prog, 'u_hr'),
    pulse: gl.getUniformLocation(prog, 'u_pulse'),
    spread: gl.getUniformLocation(prog, 'u_spread'),
    you: gl.getUniformLocation(prog, 'u_you'),
    think: gl.getUniformLocation(prog, 'u_think'),
    her: gl.getUniformLocation(prog, 'u_her'),
  };
  gl.uniform3fv(u.hl, hue('--hue-l', [0.5, 0.83, 0.7]));
  gl.uniform3fv(u.hc, hue('--hue-c', [0.59, 0.7, 1.0]));
  gl.uniform3fv(u.hr, hue('--hue-r', [0.77, 0.67, 1.0]));

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha

  // aura-earned ripple: jump to 1 on each earn, decay per frame in the loop
  const onAura = () => { pulse = 1; };
  window.addEventListener('aura-changed', onAura);

  // gentle pointer parallax
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  wrap.addEventListener('pointermove', (e) => {
    const r = wrap.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
  });

  // render at a capped scale for smoothness (it upscales cleanly via CSS)
  const SCALE = 0.82;
  function resize() {
    const w = Math.max(1, Math.floor(wrap.clientWidth * SCALE));
    const h = Math.max(1, Math.floor(wrap.clientHeight * SCALE));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    return [w, h];
  }
  window.addEventListener('lane-settled', resize);
  window.addEventListener('resize', resize);

  let phase = 0, lastNow = performance.now();
  let moodYou = 0, moodThink = 0, moodHer = 0;   // smoothed state → color+topology mood
  let smoothDrive = 0;                            // low-passed motion drive (kills speed jitter)
  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (canvas.offsetParent === null) { lastNow = now; return; } // hidden organ — don't burn GPU or bank dt
    const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
    live.mic *= 0.94; live.say *= 0.92; live.phrase *= 0.9;
    // Speed is LOW-PASSED so raw audio spikes don't make the surface lurch — the
    // motion eases up and down instead of twitching with every RMS sample.
    const liveDrive = live.open ? (live.mic * 0.4 + live.say * 0.3 + live.think * 0.18 + live.phrase * 0.35) : 0;
    smoothDrive += (liveDrive - smoothDrive) * 0.04;
    phase += dt * Math.min(2.0, energy + smoothDrive * 0.6);
    const [w, h] = resize();
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    pulse *= 0.965; // slower, gentler decay — no strobing
    if (intro.on) introTick(now);
    // mood targets: green=you, blue=think, purple=her. Only from a live channel,
    // except the intro's speech phase feeds the purple ripple so the overture blooms.
    // Slow smoothing so color eases between moods instead of flickering.
    const youT = live.open ? Math.min(1, live.mic * 1.5) : 0;
    const thinkT = live.open ? live.think : 0;
    const herT = live.open ? Math.min(1, live.say * 1.6) : (intro.on ? Math.min(1, intro.voice) : 0);
    moodYou += (youT - moodYou) * 0.08;
    moodThink += (thinkT - moodThink) * 0.07;
    moodHer += (herT - moodHer) * 0.08;
    gl.uniform2f(u.res, w, h);
    gl.uniform1f(u.time, phase);
    gl.uniform2f(u.mouse, mouse.x, mouse.y);
    const liveSpread = live.think > 0 ? -0.32 : (live.say > 0.02 ? 0.22 * live.say : -0.18 * live.mic);
    gl.uniform1f(u.pulse, Math.min(1, pulse + (intro.on ? intro.voice : 0) + live.mic * 0.3 + live.say * 0.45 + live.phrase * 0.35));
    gl.uniform1f(u.spread, intro.on && intro.spread != null ? intro.spread : Math.max(-0.4, Math.min(0.4, spread + liveSpread)));
    gl.uniform1f(u.you, moodYou);
    gl.uniform1f(u.think, moodThink);
    gl.uniform1f(u.her, moodHer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  raf = requestAnimationFrame(frame);
  if (!introSeen) startIntro();
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .knvs-app { position:absolute; inset:0; overflow:hidden;
    background:radial-gradient(120% 120% at 50% 40%, rgba(var(--hue-c),0.05), transparent 70%), #111520; }
  .knvs-canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
  .knvs-label { position:absolute; left:20px; top:16px; pointer-events:none;
    display:flex; flex-direction:column; gap:2px; }
  .knvs-label b { font-size:15px; font-weight:700; letter-spacing:0.14em; color:#fff;
    text-shadow:0 0 14px rgba(var(--hue-c),0.5); }
  .knvs-label span { font-size:11.5px; color:var(--dim); letter-spacing:0.02em; }

  .knvs-info-btn { position:absolute; right:18px; top:16px; z-index:3; font:inherit; font-size:11.5px;
    padding:5px 11px; border-radius:20px; cursor:pointer; color:rgba(var(--hue-c),0.95);
    border:1px solid rgba(var(--hue-c),0.3); background:rgba(10,12,20,0.5); backdrop-filter:blur(6px); transition:border-color 0.16s ease; }
  .knvs-info-btn:hover { border-color:rgba(var(--hue-c),0.7); }
  .knvs-info { position:absolute; right:18px; top:52px; z-index:4; width:min(340px, calc(100% - 36px));
    padding:16px 17px 15px; border-radius:15px; opacity:0; transform:translateY(-6px); pointer-events:none;
    border:1px solid rgba(var(--hue-c),0.28); background:rgba(12,14,22,0.9); backdrop-filter:blur(12px);
    box-shadow:0 16px 44px rgba(0,0,0,0.5); transition:opacity 0.22s ease, transform 0.22s ease; }
  .knvs-info.open { opacity:1; transform:translateY(0); pointer-events:auto; }
  .knvs-info h4 { margin:0 0 9px; font-size:13.5px; color:#fff; font-weight:650; letter-spacing:0.01em; }
  .knvs-info p { margin:0 0 9px; font-size:12.5px; line-height:1.55; color:rgba(255,255,255,0.82); }
  .knvs-info .knvs-honest { color:rgba(var(--hue-r),0.92); font-style:italic; font-size:11.5px; margin-bottom:12px; }
  .knvs-info-close { font:inherit; font-size:12px; padding:6px 14px; border-radius:9px; cursor:pointer; color:var(--text);
    border:1px solid rgba(var(--hue-c),0.35); background:rgba(var(--hue-c),0.12); }
  .knvs-info-close:hover { border-color:rgba(var(--hue-c),0.7); }

  .knvs-controls { position:absolute; left:50%; bottom:112px; transform:translateX(-50%); z-index:3;
    display:flex; gap:18px; flex-wrap:wrap; justify-content:center; padding:9px 14px; border-radius:14px;
    border:1px solid rgba(255,255,255,0.08); background:rgba(10,12,20,0.5); backdrop-filter:blur(8px); }
  .knvs-echo { position:absolute; left:50%; bottom:228px; transform:translateX(-50%); z-index:4;
    max-width:min(520px, calc(100% - 48px)); padding:6px 13px; border-radius:999px;
    font-size:10px; letter-spacing:0.15em; text-transform:uppercase; text-align:center;
    color:rgba(var(--hue-c),0.82); border:1px solid rgba(var(--hue-c),0.18);
    background:rgba(6,8,14,0.5); backdrop-filter:blur(9px); opacity:0.72;
    transition:color 0.22s ease, border-color 0.22s ease, opacity 0.22s ease, transform 0.22s ease; }
  .knvs-echo.lit { opacity:1; color:rgba(var(--hue-r),0.95); border-color:rgba(var(--hue-r),0.35);
    transform:translateX(-50%) translateY(-2px); }
  .knvs-seg { display:flex; align-items:center; gap:9px; }
  .knvs-seg-label { font-size:10px; text-transform:uppercase; letter-spacing:0.14em; color:var(--faint); }
  .knvs-seg-btns { display:flex; gap:3px; padding:2px; border-radius:9px; background:rgba(255,255,255,0.04); }
  .knvs-seg-btn { font:inherit; font-size:11.5px; padding:4px 11px; border-radius:7px; cursor:pointer;
    color:var(--dim); border:1px solid transparent; background:transparent; transition:all 0.14s ease; }
  .knvs-seg-btn:hover { color:var(--text); }
  .knvs-seg-btn.on { color:#fff; background:rgba(var(--hue-c),0.2); border-color:rgba(var(--hue-c),0.45); box-shadow:0 0 10px rgba(var(--hue-c),0.25); }

  /* ---- brick 3: the cinematic intro ---- */
  .knvs-chrome-hidden { opacity:0 !important; pointer-events:none !important; transition:opacity 0.8s ease; }
  .knvs-label, .knvs-info-btn, .knvs-controls, .knvs-replay { transition:opacity 0.8s ease; }
  .knvs-intro { position:absolute; inset:0; z-index:5; display:none; flex-direction:column; align-items:center;
    justify-content:flex-end; cursor:pointer; text-align:center; padding:0 24px 15vh;
    background:radial-gradient(120% 120% at 50% 46%, transparent 40%, rgba(3,4,9,0.55) 100%),
               linear-gradient(to top, rgba(3,4,9,0.66), transparent 42%); }
  .knvs-intro.on { display:flex; }
  .knvs-intro-title { position:absolute; top:24%; left:0; right:0;
    opacity:0; transform:translateY(10px) scale(0.98); transition:opacity 1.4s ease, transform 1.4s ease; }
  .knvs-intro-title.in { opacity:1; transform:none; }
  .knvs-intro-title.lift { opacity:0.45; transform:translateY(-16vh) scale(0.82); }
  .knvs-intro-title b { display:block; font-size:44px; font-weight:750; letter-spacing:0.34em; color:#fff;
    text-shadow:0 0 34px rgba(var(--hue-c),0.65), 0 0 90px rgba(var(--hue-r),0.4); }
  .knvs-intro-title i { display:block; margin-top:8px; font-style:normal; font-size:11.5px; letter-spacing:0.22em;
    text-transform:uppercase; color:var(--dim); }
  .knvs-intro-cap { min-height:1.6em; max-width:560px; font-size:16.5px; line-height:1.55; color:rgba(240,244,255,0.94);
    text-shadow:0 1px 18px rgba(0,0,0,0.9); opacity:0; transform:translateY(6px); transition:opacity 0.9s ease, transform 0.9s ease; }
  .knvs-intro-cap.in { opacity:1; transform:none; }
  .knvs-intro-skip { position:absolute; bottom:20px; left:50%; transform:translateX(-50%); font-size:10px;
    letter-spacing:0.2em; text-transform:uppercase; color:var(--faint); animation:knvsSkipFade 3s ease 1s both; }
  @keyframes knvsSkipFade { from { opacity:0; } to { opacity:0.8; } }
  .knvs-replay { position:absolute; right:18px; top:52px; z-index:3; font:inherit; font-size:10.5px;
    padding:4px 10px; border-radius:20px; cursor:pointer; color:var(--faint);
    border:1px solid rgba(255,255,255,0.12); background:rgba(10,12,20,0.5); backdrop-filter:blur(6px); transition:color 0.16s ease, border-color 0.16s ease; }
  .knvs-replay:hover { color:var(--dim); border-color:rgba(255,255,255,0.3); }
  `;
  const tag = document.createElement('style');
  tag.id = 'knvs-style';
  tag.textContent = css;
  document.head.append(tag);
}
