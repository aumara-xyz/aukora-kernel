// The Agora — the tetrahedron salon, living inside the spatial shell's centre pane.
//
// Three base vertices (Auma/DeepSeek, Kira/GLM, Nyx/Qwen) talk on a plane; the
// apex (Auracle — Peter's own 32B, auma-vl-v4) watches the interference they make
// and reads the shear. Same-origin: the proxy fronts this at /api/agora/* and
// injects the token server-side, so this file holds no secret.
//
// Organ contract: mountAgora(el) renders once into an absolutely-positioned root
// the shell keeps alive across tab switches. Advisory/experimental — it spends
// model tokens (OpenRouter + the GPU node) only while powered on.

let mounted = false;

const CSS = `
.agora{position:absolute;inset:0;display:flex;flex-direction:column;background:
  radial-gradient(140% 100% at 50% -25%,#0d2230 0%,rgba(13,34,48,0) 58%),#05070B;
  color:#C7D3DF;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;overflow:hidden}
.agora *{box-sizing:border-box}
.agora .hd{padding:14px 20px 10px;border-bottom:1px solid #182636;flex:0 0 auto;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.agora h1{margin:0;font-size:15px;letter-spacing:.30em;text-transform:uppercase;font-weight:700}
.agora .sub{margin:5px 0 0;font-size:11px;color:#7E8D9C;font-family:ui-monospace,Menlo,monospace}
.agora .sub b{color:#3FA9C9;font-weight:400}
.agora .ctrls{display:flex;gap:8px;flex:0 0 auto}
.agora button.ctl{background:transparent;border:1px solid #182636;color:#C7D3DF;border-radius:7px;padding:7px 12px;font-size:12.5px;cursor:pointer;white-space:nowrap;font-weight:600}
.agora button.ctl:hover{border-color:#2b3f54}
.agora #ag-pause.on{border-color:#3FA9C9;color:#3FA9C9}
.agora #ag-power.off{border-color:#E06C6C;color:#E06C6C}
.agora .apexbar{display:flex;align-items:center;gap:10px;padding:9px 20px;border-bottom:1px solid #101c29;background:linear-gradient(180deg,rgba(242,193,78,.06),transparent)}
.agora .apexbar .glyph{font-size:15px;color:#F2C14E}
.agora .apexbar .lbl{font-size:11.5px;color:#B9A76A;font-weight:600}
.agora .apexbar .md{font-size:10px;color:#5c6b52;font-family:ui-monospace,Menlo,monospace}
.agora .orbs{display:flex;gap:20px;padding:12px 20px;flex:0 0 auto;flex-wrap:wrap}
.agora .orb{display:flex;align-items:center;gap:8px}
.agora .dot{width:12px;height:12px;border-radius:50%}
.agora .dot.spk{animation:agpulse 1.2s ease-out}
@keyframes agpulse{0%{box-shadow:0 0 0 0 currentColor}100%{box-shadow:0 0 0 16px transparent}}
.agora .orb .nm{font-size:12px;font-weight:600}
.agora .orb .md{font-size:9.5px;color:#465563;font-family:ui-monospace,Menlo,monospace}
.agora #ag-feed{flex:1 1 auto;overflow-y:auto;padding:10px 20px 18px;display:flex;flex-direction:column;gap:13px}
.agora .m{max-width:760px;animation:agrise .3s ease-out}
@keyframes agrise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.agora .who{font-size:12px;font-weight:700;display:flex;align-items:center;gap:7px}
.agora .who .t{font-family:ui-monospace,Menlo,monospace;color:#465563;font-weight:400;font-size:10px}
.agora .alien{margin-top:4px;font-family:ui-monospace,Menlo,monospace;font-size:13px;line-height:1.5;letter-spacing:.02em;color:#3FA9C9;opacity:.85;text-shadow:0 0 10px rgba(63,169,201,.3)}
.agora .tx{margin-top:5px;font-size:14.5px;line-height:1.5;color:#DCE6EE;border-left:2px solid #182636;padding-left:11px}
.agora .m.peter{align-self:flex-end;text-align:right}
.agora .m.peter .who{justify-content:flex-end}
.agora .m.peter .tx{border-left:0;border-right:2px solid #182636;padding-left:0;padding-right:11px}
.agora .m.sys .tx{color:#7E8D9C;font-style:italic;font-size:12.5px;border:0}
.agora .m.sys .alien{display:none}
.agora .m.apex{max-width:820px;align-self:center;width:100%}
.agora .m.apex .who{color:#F2C14E;justify-content:center}
.agora .m.apex .tx{color:#F0E4C0;border-left:0;text-align:center;font-style:italic;
  border-top:1px solid rgba(242,193,78,.22);border-bottom:1px solid rgba(242,193,78,.22);
  padding:9px 12px;margin-top:7px;background:linear-gradient(180deg,rgba(242,193,78,.05),transparent)}
.agora .m.apex .alien{text-align:center;color:#C8A94E;text-shadow:0 0 10px rgba(242,193,78,.25)}
.agora .ft{flex:0 0 auto;border-top:1px solid #182636;padding:13px 20px;display:flex;gap:9px;align-items:center;background:#0C121C}
.agora #ag-in{flex:1;background:#070C13;border:1px solid #182636;border-radius:8px;color:#C7D3DF;padding:11px 13px;font-size:14.5px;font-family:inherit;outline:none}
.agora #ag-in:focus{border-color:#3FA9C9}
.agora #ag-in:disabled{opacity:.55;cursor:not-allowed}
.agora #ag-send{background:#3FA9C9;color:#04121A;border:0;border-radius:8px;padding:11px 18px;font-weight:700;cursor:pointer;font-size:13.5px}
.agora #ag-send:disabled{opacity:.55;cursor:not-allowed}
.agora .beat{color:#F2C14E;font-variant-numeric:tabular-nums}
.agora #ag-density{color:#3FA9C9}
.agora .loom{display:flex;align-items:center;gap:8px;padding:8px 20px;border-bottom:1px solid #101c29;overflow-x:auto;
  background:linear-gradient(180deg,rgba(63,169,201,.05),transparent);flex:0 0 auto;scrollbar-width:thin}
.agora .loom-lbl{font-family:ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:#5c6b7a;flex:0 0 auto}
.agora .loom-empty{font-size:11px;color:#465563;font-style:italic}
.agora .coin{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;background:#0b1420;border:1px solid #1c2f42;border-radius:999px;padding:3px 10px;font-size:12px;white-space:nowrap;animation:agrise .3s ease-out}
.agora .coin .g{font-size:14px;color:#F2C14E}
.agora .coin .mean{color:#9fb0bf;font-size:11px;max-width:190px;overflow:hidden;text-overflow:ellipsis}
.agora .coin .u{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:#465563}
`;

export function mountAgora(el) {
  if (mounted) return;
  mounted = true;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'agora';
  root.innerHTML = `
    <div class="hd">
      <div>
        <h1>The Agora</h1>
        <p class="sub">a tetrahedron building a <b>living code</b> · <span id="ag-conn">connecting…</span> · <span id="ag-drand" class="beat" title="drand beacon — a clock none of them owns">⧗ …</span> · <span id="ag-density" title="glyphs coined · reuses">⟦⟧ 0</span></p>
      </div>
      <div class="ctrls">
        <button class="ctl" id="ag-pause">⏸ pause</button>
        <button class="ctl" id="ag-power">⏻ on</button>
      </div>
    </div>
    <div class="apexbar">
      <span class="glyph">▲</span>
      <span class="lbl" id="ag-apexlbl">apex — watching the interference</span>
      <span class="md" id="ag-apexmd"></span>
    </div>
    <div class="orbs" id="ag-orbs"></div>
    <div class="loom" id="ag-loom"><span class="loom-lbl">the loom</span><span class="loom-empty">shared code forms as they speak…</span></div>
    <div id="ag-feed"></div>
    <div class="ft">
      <input id="ag-in" placeholder="speak into the shear — all of them at once…" autocomplete="off"/>
      <button id="ag-send">send</button>
    </div>`;
  el.appendChild(root);

  const feed = root.querySelector('#ag-feed');
  const orbs = root.querySelector('#ag-orbs');
  const conn = root.querySelector('#ag-conn');
  const input = root.querySelector('#ag-in');
  const send = root.querySelector('#ag-send');
  const pauseBtn = root.querySelector('#ag-pause');
  const powerBtn = root.querySelector('#ag-power');
  const apexMd = root.querySelector('#ag-apexmd');
  const loom = root.querySelector('#ag-loom');
  const drandEl = root.querySelector('#ag-drand');
  const densityEl = root.querySelector('#ag-density');
  const dots = {};
  const mds = {};
  let paused = false;
  let powered = true;
  let connected = false;
  let offlineNotice = false;

  function setDrand(round) { if (round) drandEl.textContent = '⧗ ' + round; }
  function setDensity(size, reuses) { densityEl.textContent = '⟦⟧ ' + (size || 0) + (reuses ? ' · ×' + reuses : ''); }
  function renderLoom(lex) {
    loom.innerHTML = '';
    const lbl = document.createElement('span');
    lbl.className = 'loom-lbl';
    lbl.textContent = 'the loom';
    loom.append(lbl);
    if (!lex || !lex.length) {
      const e = document.createElement('span');
      e.className = 'loom-empty';
      e.textContent = 'shared code forms as they speak…';
      loom.append(e);
      return;
    }
    for (const c of lex) {
      const chip = document.createElement('span');
      chip.className = 'coin';
      chip.title = c.by ? 'coined by ' + c.by : '';
      const g = document.createElement('span'); g.className = 'g'; g.textContent = '⟦' + c.glyph + '⟧';
      const m = document.createElement('span'); m.className = 'mean'; m.textContent = c.meaning;
      chip.append(g, m);
      if (c.uses) { const u = document.createElement('span'); u.className = 'u'; u.textContent = '×' + c.uses; chip.append(u); }
      loom.append(chip);
    }
    loom.scrollLeft = loom.scrollWidth;
  }

  function setPaused(p) {
    paused = p;
    pauseBtn.textContent = p ? '▶ resume' : '⏸ pause';
    pauseBtn.className = 'ctl' + (p ? ' on' : '');
  }
  function setPowered(on) {
    powered = on;
    powerBtn.textContent = on ? '⏻ on' : '⏻ off';
    powerBtn.className = 'ctl' + (on ? '' : ' off');
  }

  function render(m) {
    const wrap = document.createElement('div');
    wrap.className = 'm' + (m.from === 'peter' ? ' peter' : '') + (m.from === 'sys' ? ' sys' : '') + (m.from === 'apex' ? ' apex' : '');
    const who = document.createElement('div');
    who.className = 'who';
    who.style.color = m.color || '#C7D3DF';
    const name = document.createElement('span');
    name.textContent = (m.glyph ? m.glyph + ' ' : '') + m.name;
    const ts = document.createElement('span');
    ts.className = 't';
    ts.textContent = new Date(m.ts).toLocaleTimeString();
    who.append(name, ts);
    wrap.append(who);
    if (m.alien) {
      const al = document.createElement('div');
      al.className = 'alien';
      al.textContent = m.alien;
      wrap.append(al);
    }
    const tx = document.createElement('div');
    tx.className = 'tx';
    tx.textContent = m.text;
    wrap.append(tx);
    feed.append(wrap);
    feed.scrollTop = feed.scrollHeight;
    const dot = dots[m.from];
    if (dot) { dot.classList.remove('spk'); void dot.offsetWidth; dot.classList.add('spk'); }
  }

  function showOfflineNotice() {
    if (offlineNotice || connected) return;
    offlineNotice = true;
    conn.textContent = '○ optional backend offline';
    conn.style.color = '#E6A23C';
    input.disabled = true;
    send.disabled = true;
    render({
      from: 'sys',
      name: 'Agora',
      glyph: '',
      color: '#7E8D9C',
      text: 'The Agora salon is installed but not running yet. The main node is ready; this optional multi-model room can be enabled later without blocking Auma, AUMLOK, or the Spatial app.',
      ts: Date.now(),
    });
  }

  function buildOrbs(agents) {
    orbs.innerHTML = '';
    for (const a of agents) {
      if (a.role === 'apex') { apexMd.textContent = a.model; dots[a.id] = null; continue; }
      const w = document.createElement('div');
      w.className = 'orb';
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.background = a.color;
      dot.style.color = a.color;
      dots[a.id] = dot;
      const nm = document.createElement('div');
      const n = document.createElement('div');
      n.className = 'nm';
      n.textContent = a.glyph + ' ' + a.name;
      n.style.color = a.color;
      const md = document.createElement('div');
      md.className = 'md';
      md.textContent = a.model;
      mds[a.id] = md;
      nm.append(n, md);
      w.append(dot, nm);
      orbs.append(w);
    }
  }

  // Same-origin SSE via the proxy (which injects the token). No key in the client.
  const es = new EventSource('/api/agora/stream');
  const offlineTimer = setTimeout(showOfflineNotice, 1800);
  es.onopen = () => {
    connected = true;
    clearTimeout(offlineTimer);
    conn.textContent = '● live';
    conn.style.color = '#54E0C6';
    input.disabled = false;
    send.disabled = false;
  };
  es.onerror = () => {
    if (connected) {
      conn.textContent = '○ reconnecting…';
      conn.style.color = '#E6A23C';
      return;
    }
    showOfflineNotice();
  };
  es.onmessage = (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.type === 'hello') {
      setPaused(!!d.paused);
      setPowered(d.powered !== false);
      buildOrbs(d.agents || []);
      renderLoom(d.lexicon);
      setDensity(d.lexSize, d.reuses);
      setDrand(d.drand);
    } else if (d.type === 'model') {
      if (mds[d.id]) mds[d.id].textContent = d.model;
    } else if (d.type === 'drand') {
      setDrand(d.round);
    } else if (d.type === 'lex') {
      renderLoom(d.lexicon);
      setDensity(d.size, d.reuses);
    } else if (d.type === 'state') {
      setPaused(!!d.paused);
      setPowered(d.powered !== false);
    } else if (d.type === 'msg') {
      render(d.msg);
    }
  };

  function say() {
    if (!connected) return;
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    fetch('/api/agora/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: v }) }).catch(() => {});
  }
  send.onclick = say;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') say(); });
  pauseBtn.onclick = () => { if (connected) fetch('/api/agora/' + (paused ? 'resume' : 'pause'), { method: 'POST' }).catch(() => {}); };
  powerBtn.onclick = () => { if (connected) fetch('/api/agora/' + (powered ? 'off' : 'on'), { method: 'POST' }).catch(() => {}); };
}
