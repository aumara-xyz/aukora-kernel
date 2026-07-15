// Aukora Spatial — KNVS duplex overlay.
//
// V0 "live preview" bridge: lets the KNVS canvas borrow the Auma Live voice
// channel without adding any authority surface. It sends mic audio only to the
// local sidecar / governed presence lane, receives TTS audio, and reports
// bounded visual state hooks back to the canvas. No files, receipts, eval, DOM
// HTML, or proposal writes live here.

// Her replies on the presence lane may carry invisible [field …] body-language
// tags (taught in spatial/presenceLane.ts). This organ has no light-field, so
// it strips them from the stream — never spoken, never shown — and offers them
// to the canvas as a bounded hook (hooks.onFieldDirective) for future use.
import { makeDirectiveFilter } from '/app/field-directives.js';

const DOOR = 'http://127.0.0.1:7091';
const SIDECAR_WS = 'ws://127.0.0.1:7092/ws';
const WORKLET_URL = '/app/aumalive-audio.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function sanitizeForVoice(s) {
  return String(s == null ? '' : s)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\s*field\b[^\]]*\]/gi, ' ')   // her [field …] body-language tags — the last-line guarantee
    .replace(/(\*\*\*|\*\*|\*|__|_|~~)/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/[*_`~#|]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function resampleLinear(f32, from, to) {
  if (from === to) return f32;
  const n = Math.max(1, Math.round(f32.length * to / from));
  const out = new Float32Array(n);
  const r = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * r;
    const i0 = x | 0;
    const i1 = Math.min(i0 + 1, f32.length - 1);
    const fr = x - i0;
    out[i] = f32[i0] * (1 - fr) + f32[i1] * fr;
  }
  return out;
}

function makeVoiceLink() {
  return {
    ws: null,
    ready: false,
    voices: [],
    defaultVoice: 'auma',
    on: {},
    _timer: 0,
    emit(k, ...a) {
      try { (this.on[k] || (() => {}))(...a); } catch { /* visual preview only */ }
    },
    connect() {
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
      let ws;
      try { ws = new WebSocket(SIDECAR_WS); } catch { this.retry(); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') { this.emit('pcm', e.data); return; }
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'ready') {
          this.ready = true;
          this.voices = m.voices || [];
          this.defaultVoice = m.default_voice || 'aurora';
          this.emit('ready', m);
        } else this.emit(m.t, m);
      };
      ws.onclose = ws.onerror = () => {
        const was = this.ready;
        this.ready = false;
        this.ws = null;
        if (was) this.emit('down');
        this.retry();
      };
    },
    retry() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.connect(), 4000);
    },
    send(obj) {
      if (this.ready && this.ws?.readyState === 1) {
        try { this.ws.send(JSON.stringify(obj)); } catch { /* local preview only */ }
      }
    },
    sendPCM(buf) {
      if (this.ready && this.ws?.readyState === 1) {
        try { this.ws.send(buf); } catch { /* local preview only */ }
      }
    },
    say(id, text, v, speed, first) {
      this.send({ t: 'tts', id, text, voice: v, speed: speed || 1.0, first: !!first });
    },
    cancel() { this.send({ t: 'tts_cancel' }); },
    her(on) { this.send({ t: 'her', on: !!on }); },
    reset() { this.send({ t: 'reset' }); },
    close() {
      clearTimeout(this._timer);
      try { this.ws?.close(); } catch { /* */ }
      this.ws = null;
      this.ready = false;
    },
  };
}

export function mountKnvsDuplex(host, hooks = {}) {
  injectStyle();
  const voice = makeVoiceLink();

  const orb = el('button', 'kdl-orb');
  orb.type = 'button';
  orb.title = 'open the KNVS voice preview';
  orb.innerHTML = '<span class="kdl-orb-halo"></span><span class="kdl-orb-ring"></span><span class="kdl-orb-core"></span>';

  const stamp = el('div', 'kdl-stamp', 'PREVIEW · not applied');
  const gear = el('button', 'kdl-gear');
  gear.type = 'button';
  gear.title = 'voice preview settings';
  gear.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1l2.1-2.1M17 7l2.1-2.1"/></svg>';

  const logBtn = el('button', 'kdl-log-btn');
  logBtn.type = 'button';
  logBtn.title = 'preview transcript';
  logBtn.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>';

  const panel = el('div', 'kdl-panel');
  const mindGroup = el('div', 'kdl-group');
  const mindSeg = el('div', 'kdl-seg');
  const mindNote = el('div', 'kdl-note');
  mindGroup.append(el('div', 'kdl-group-k', 'her mind'), mindSeg, mindNote);
  const voiceGroup = el('div', 'kdl-group');
  const voiceList = el('div', 'kdl-vlist');
  voiceGroup.append(el('div', 'kdl-group-k', 'her voice'), voiceList);
  panel.append(mindGroup, voiceGroup);

  const logPanel = el('div', 'kdl-log');
  const logHead = el('div', 'kdl-log-head');
  const logCopy = el('button', 'kdl-log-copy', 'copy');
  logCopy.type = 'button';
  logHead.append(el('div', 'kdl-log-title', 'preview transcript'), logCopy);
  const logBody = el('div', 'kdl-log-body');
  const logEmpty = el('div', 'kdl-log-empty', 'open the channel and speak, or type a KNVS prompt below.');
  const compose = document.createElement('form');
  compose.className = 'kdl-compose';
  const input = document.createElement('input');
  input.className = 'kdl-input';
  input.type = 'text';
  input.placeholder = 'say what the surface should become...';
  const send = el('button', 'kdl-send', 'send');
  send.type = 'submit';
  compose.append(input, send);
  logPanel.append(logHead, logBody, compose);

  host.append(stamp, orb, gear, logBtn, panel, logPanel);

  let channel = false;
  let streaming = false;
  let curAbort = null;
  let duplex = false;
  let herAudible = false;
  let ttsPending = 0;
  let ttsId = 0;
  let closed = false;
  let chosenVoice = 'auma';
  let voicePicked = false;
  let chosenMind = 'balanced';
  let panelOpen = false;
  let logOpen = false;
  let pendingTurn = null;

  const MINDS = [
    { id: 'deep', label: 'deep', note: 'fullest model path, slower and richer.' },
    { id: 'balanced', label: 'balanced', note: 'quick everyday path for live preview.' },
    { id: 'quick', label: 'quick', note: 'lightest path for rapid back-and-forth.' },
  ];

  function buildMinds() {
    mindSeg.innerHTML = '';
    for (const m of MINDS) {
      const b = el('button', 'kdl-seg-b' + (m.id === chosenMind ? ' on' : ''), m.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        chosenMind = m.id;
        [...mindSeg.children].forEach((c) => c.classList.toggle('on', c === b));
        mindNote.textContent = m.note;
      });
      mindSeg.append(b);
    }
    mindNote.textContent = (MINDS.find((m) => m.id === chosenMind) || MINDS[1]).note;
  }

  function populateVoices() {
    voiceList.innerHTML = '';
    const ordered = [...voice.voices].sort((a, b) => (a.engine === 'pocket' ? 0 : 1) - (b.engine === 'pocket' ? 0 : 1));
    for (const v of ordered) {
      const slow = v.engine === 'kokoro';
      const b = el('button', 'kdl-vrow' + (v.id === chosenVoice ? ' on' : '') + (slow ? ' slow' : ''));
      b.type = 'button';
      const top = el('span', 'kdl-vtop');
      top.append(el('span', 'kdl-vname', v.label), el('span', 'kdl-vtag ' + (slow ? 'is-slow' : 'is-fast'), slow ? 'richer · slower' : 'fast'));
      const hint = el('span', 'kdl-vhint', v.hint || '');
      b.append(top, hint);
      b.addEventListener('click', async () => {
        chosenVoice = v.id;
        voicePicked = true;
        [...voiceList.children].forEach((c) => c.classList.toggle('on', c === b));
        await ensureAudio();
        ttsPending++;
        voice.her(true);
        voice.say(++ttsId, 'This is me on the canvas.', chosenVoice);
      });
      voiceList.append(b);
    }
  }

  function setOrb() {
    orb.className = 'kdl-orb'
      + (channel ? ' live' : '')
      + (streaming ? ' thinking' : '')
      + (herAudible ? ' speaking' : '')
      + (!duplex ? ' fb' : '');
    orb.title = channel ? 'close the KNVS voice preview' : 'open the KNVS voice preview';
  }

  function togglePanel(force) {
    panelOpen = force === undefined ? !panelOpen : force;
    panel.classList.toggle('show', panelOpen);
    gear.classList.toggle('on', panelOpen);
  }

  function toggleLog(force) {
    logOpen = force === undefined ? !logOpen : force;
    logPanel.classList.toggle('show', logOpen);
    logBtn.classList.toggle('on', logOpen);
    if (logOpen) { togglePanel(false); logBody.scrollTop = logBody.scrollHeight; }
  }

  const LOG_KEY = 'aukora-knvs-live-log-v1';
  let logTurns = [];
  try { logTurns = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { logTurns = []; }
  function saveLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logTurns.slice(-120))); } catch { /* quota */ }
  }
  function logRow(turn) {
    const row = el('div', 'kdl-log-row ' + (turn.role === 'you' ? 'you' : 'auma'));
    row.append(el('div', 'kdl-log-who', turn.role === 'you' ? 'you' : 'Auma'));
    row.append(el('div', 'kdl-log-txt', turn.text));
    return row;
  }
  function renderLog() {
    logBody.innerHTML = '';
    if (!logTurns.length) { logBody.append(logEmpty); return; }
    for (const t of logTurns) logBody.append(logRow(t));
    logBody.scrollTop = logBody.scrollHeight;
  }
  function addTurn(role, text) {
    const t = String(text || '').trim();
    if (!t) return;
    logTurns.push({ role, text: t, ts: Date.now() });
    if (logTurns.length > 120) logTurns = logTurns.slice(-120);
    saveLog();
    if (logBody.contains(logEmpty)) logBody.removeChild(logEmpty);
    logBody.append(logRow(logTurns[logTurns.length - 1]));
    logBody.scrollTop = logBody.scrollHeight;
  }

  gear.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
  panel.addEventListener('click', (e) => e.stopPropagation());
  logBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLog(); });
  logPanel.addEventListener('click', (e) => e.stopPropagation());
  logCopy.addEventListener('click', () => {
    const text = logTurns.map((t) => (t.role === 'you' ? 'You: ' : 'Auma: ') + t.text).join('\n\n');
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
    logCopy.textContent = 'copied';
    setTimeout(() => { logCopy.textContent = 'copy'; }, 1400);
  });
  compose.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    requestTurn(text);
  });

  host.addEventListener('click', () => {
    if (panelOpen) togglePanel(false);
    if (logOpen) toggleLog(false);
  });

  let ctx = null;
  let micStream = null;
  let micNode = null;
  let playerNode = null;
  let micSrc = null;
  let muteTap = null;

  async function ensureAudio() {
    if (ctx) {
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { /* */ }
      }
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.audioWorklet.addModule(WORKLET_URL);
      playerNode = new AudioWorkletNode(ctx, 'alv-player', { numberOfInputs: 0, outputChannelCount: [1] });
      playerNode.connect(ctx.destination);
      playerNode.port.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'lvl') {
          const lvl = clamp(m.rms * 26, 0, 1);
          hooks.onSpeakingLevel?.(lvl);
          const audible = m.audible || ttsPending > 0;
          if (audible !== herAudible) {
            herAudible = audible;
            voice.her(audible);
            setOrb();
            if (!audible) settleIfDone();
          }
        }
      };
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  async function startMic() {
    if (micStream) return true;
    if (!(await ensureAudio())) return false;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      micSrc = ctx.createMediaStreamSource(micStream);
      micNode = new AudioWorkletNode(ctx, 'alv-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
      muteTap = ctx.createGain();
      muteTap.gain.value = 0;
      micSrc.connect(micNode);
      micNode.connect(muteTap);
      muteTap.connect(ctx.destination);
      micNode.port.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'rms') {
          const lvl = clamp((m.v - 0.008) * 11, 0, 1);
          hooks.onMicLevel?.(lvl);
          if (!duplex) fallbackVadTick(lvl);
        } else if (m.t === 'pcm' && channel && duplex) {
          voice.sendPCM(m.pcm);
        }
      };
      return true;
    } catch {
      return false;
    }
  }

  function stopMic() {
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    try { micSrc?.disconnect(); micNode?.disconnect(); muteTap?.disconnect(); } catch { /* */ }
    micStream = null;
    micSrc = null;
    micNode = null;
    muteTap = null;
    hooks.onMicLevel?.(0);
  }

  function pushPcm(arrayBuf) {
    if (!ctx || !playerNode) return;
    const i16 = new Int16Array(arrayBuf);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const rs = resampleLinear(f32, 24000, ctx.sampleRate);
    playerNode.port.postMessage({ cmd: 'push', pcm: rs.buffer }, [rs.buffer]);
  }

  // F6 (mirrors aumalive.js F3): force the sidecar's her-bar down from any
  // terminal path, not just the worklet's audible→false tick — which never
  // fires if the AudioContext suspends (tab backgrounded) or the node is torn
  // down. The WS is independent of the audio graph, so this always lands.
  function dropHer() {
    ttsPending = 0;
    if (herAudible) { herAudible = false; voice.her(false); setOrb(); }
  }

  function cutHerVoice() {
    if (playerNode) playerNode.port.postMessage({ cmd: 'cut' });
    voice.cancel();
    dropHer();
    stopBrowserVoice();
  }

  voice.on = {
    ready() {
      duplex = true;
      if (!voicePicked) chosenVoice = voice.defaultVoice;
      populateVoices();
      setOrb();
      if (channel) { voice.reset(); stopRecog(); }
    },
    down() {
      duplex = false;
      ttsPending = 0;
      setOrb();
      if (channel) startRecog();
    },
    vad(m) {
      if (!channel) return;
      if (m.speaking && (herAudible || streaming)) bargeIn();
    },
    final(m) {
      if (!channel) return;
      const text = (m.text || '').trim();
      if (text) requestTurn(text);
    },
    tts_end() {
      ttsPending = Math.max(0, ttsPending - 1);
      settleIfDone();
    },
    tts_cancelled() { dropHer(); },
    pcm(buf) { pushPcm(buf); },
    err() { /* soft preview error */ },
  };
  voice.connect();

  let ttsQueueFb = 0;
  let fbVoices = [];
  let fbChosen = null;
  let fbKeep = 0;
  function loadFbVoices() {
    fbVoices = (window.speechSynthesis?.getVoices() || []).filter((v) => /^en/i.test(v.lang));
    // mirrors aumalive.js: NAMED female neural voices first (never a bare
    // /natural/ — that flips her gender on installs with only male naturals)
    const pref = [/(aria|jenny|sonia|libby|michelle|emma|ava|ana).*(natural|neural|online)/i, /serena/i, /google uk english female/i, /sonia/i, /kate/i, /moira/i, /tessa/i, /zira/i, /female/i];
    fbVoices.sort((a, b) => (pref.findIndex((r) => r.test(a.name)) + 1 || 99) - (pref.findIndex((r) => r.test(b.name)) + 1 || 99));
    fbChosen = fbVoices[0] || null;
  }
  if ('speechSynthesis' in window) {
    loadFbVoices();
    window.speechSynthesis.onvoiceschanged = loadFbVoices;
  }
  // Desktop Chrome stalls speechSynthesis ~15s into a long utterance; nudge it.
  // Android (incl. no-'Mobile' tablets) is excluded — pause() kills audio there.
  const isChromeDesktop = /Chrome\//.test(navigator.userAgent) && !/Edg\/|Mobile|Android|CriOS/.test(navigator.userAgent);
  function fbKeepAlive() {
    if (!isChromeDesktop) return;
    clearInterval(fbKeep);
    fbKeep = setInterval(() => {
      const ss = window.speechSynthesis;
      if (!ss || !ss.speaking) { clearInterval(fbKeep); return; }
      try { ss.pause(); ss.resume(); } catch { /* */ }
    }, 12000);
  }
  function speakFallback(text) {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    try {
      const u = new SpeechSynthesisUtterance(text.trim());
      u.voice = fbChosen;
      u.rate = 0.96;
      u.pitch = 1.02;
      u.onboundary = () => hooks.onSpeakingLevel?.(0.45);
      u.onstart = () => { ttsQueueFb++; herAudible = true; setOrb(); fbKeepAlive(); };
      u.onend = u.onerror = () => {
        ttsQueueFb = Math.max(0, ttsQueueFb - 1);
        herAudible = ttsQueueFb > 0;
        if (!ttsQueueFb) clearInterval(fbKeep);
        setOrb();
        settleIfDone();
      };
      window.speechSynthesis.speak(u);
    } catch { /* no tts */ }
  }
  function stopBrowserVoice() {
    try { window.speechSynthesis.cancel(); } catch { /* */ }
    clearInterval(fbKeep);
    ttsQueueFb = 0;
  }

  // fallback STT — mirrors aumalive.js: turns fire from the recognizer's OWN
  // final results (debounced), never from an RMS silence timer racing it (the
  // race that made non-Mac nodes open the channel and never answer).
  let recog = null;
  let recogOn = false;
  let recogDead = false;
  let heard = '';
  let sendTimer = 0;
  let restartTimer = 0;
  let netErrs = 0;
  let lastMicLvl = 0;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function scheduleSend(stillForming) {
    clearTimeout(sendTimer);
    if (!heard.trim()) return;
    sendTimer = setTimeout(() => {
      const say = heard.trim();
      heard = '';
      if (channel && !duplex && say) requestTurn(say);
    }, stillForming ? 1500 : 600);
  }
  function startRecog() {
    if (!SR || recogOn || duplex || recogDead) return;
    recog = new SR();
    recog.lang = 'en-US';
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (ev) => {
      if (duplex || !channel) return;                       // stale events after the sidecar took over
      // echo gate: on speakers the recognizer hears HER voice; only accept
      // results the echo-cancelled mic corroborates while she is audible
      if (herStillAudible() && lastMicLvl < 0.04) return;
      netErrs = 0;
      let interim = false;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) heard += r[0].transcript + ' ';
        else if (r[0].transcript.trim()) interim = true;
      }
      if (interim && (streaming || herStillAudible())) bargeIn();
      scheduleSend(interim);
    };
    recog.onend = () => {
      if (!recogOn || recogDead) return;
      clearTimeout(restartTimer);
      if (netErrs === 0) { try { recog.start(); return; } catch { /* fall through */ } }
      restartTimer = setTimeout(() => { try { recog.start(); } catch { /* */ } }, 300);
    };
    recog.onerror = (e) => {
      const kind = e && e.error;
      if (kind === 'not-allowed' || kind === 'service-not-allowed') { recogDead = true; recogOn = false; }
      else if (kind === 'network' && ++netErrs >= 3) { recogDead = true; recogOn = false; }
    };
    try { recog.start(); recogOn = true; } catch { recogDead = true; }
  }
  function stopRecog() {
    recogOn = false;
    clearTimeout(sendTimer);
    clearTimeout(restartTimer);
    try { recog?.stop(); } catch { /* */ }
    recog = null;
    heard = '';
  }
  function fallbackVadTick(lvl) {
    lastMicLvl = lvl;
    if (!channel || duplex) return;
    // RMS is only the fast barge-in trigger now; the recognizer owns the turns
    if (lvl > 0.16 && (streaming || ttsQueueFb > 0)) bargeIn();
  }

  function speakChunk(text, first) {
    const t = sanitizeForVoice(text);
    if (!t) return;
    if (duplex) {
      ttsPending++;
      if (!herAudible) { herAudible = true; voice.her(true); setOrb(); }
      voice.say(++ttsId, t, chosenVoice, 1.0, first);
    } else speakFallback(t);
  }

  function requestTurn(text) {
    text = String(text || '').trim();
    if (!text) {
      if (streaming || herStillAudible()) bargeIn();
      return;
    }
    hooks.onUtterance?.(text, 'you');
    addTurn('you', text);
    if (streaming) { pendingTurn = text; bargeIn(); return; }
    if (herStillAudible()) bargeIn();
    transmit(text);
  }

  async function transmit(text) {
    if (streaming) return;
    streaming = true;
    hooks.onThinking?.(true);
    const abortCtl = new AbortController();
    curAbort = abortCtl;
    setOrb();
    await ensureAudio();

    let full = '';
    let sentTo = 0;
    let firstFlush = true;
    const dirs = makeDirectiveFilter((tag) => { try { hooks.onFieldDirective?.(tag); } catch { /* hook optional */ } });
    const flushSpeech = (endOfTurn) => {
      const tail = full.slice(sentTo);
      if (!tail) return;
      if (endOfTurn) {
        speakChunk(tail, firstFlush);
        sentTo = full.length;
        firstFlush = false;
        return;
      }
      let cut = -1;
      for (const m of tail.matchAll(/[.!?…]["'”’»)\]]?(?=\s|$)/g)) {
        const end = m.index + m[0].length;
        if (end >= 12) cut = end;
      }
      if (cut < 0 && tail.length > 180) {
        const c = tail.lastIndexOf(', ');
        if (c > 100) cut = c + 1;
      }
      if (cut > 0) {
        speakChunk(tail.slice(0, cut), firstFlush);
        sentTo += cut;
        firstFlush = false;
      }
    };

    try {
      const res = await fetch(DOOR + '/api/presence/stream', {
        method: 'POST',
        signal: abortCtl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, mind: chosenMind }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const m = p.match(/^data:\s*(.*)$/m);
          if (!m) continue;
          let ev; try { ev = JSON.parse(m[1]); } catch { continue; }
          if (ev.t === 'tok') {
            full += dirs.push(ev.v);
            hooks.onThinking?.(false);
            hooks.onSpeakingLevel?.(0.25);
            flushSpeech(false);
          } else if (ev.t === 'field') {
            // the door splits her body-language tags into typed events now
            try { hooks.onFieldDirective?.(ev.v); } catch { /* hook optional */ }
          }
          // 'done' needs no handling — the one finalizer below runs either way
        }
      }
      full += dirs.flush();
      flushSpeech(true);
      if (full.trim()) {
        const spoken = sanitizeForVoice(full);
        addTurn('auma', spoken);
        hooks.onUtterance?.(spoken, 'auma');
      }
      endTurn();
    } catch {
      if (abortCtl.signal.aborted) {
        if (full.trim()) addTurn('auma', sanitizeForVoice(full));
        endTurn('cut');
        return;
      }
      speakChunk('The preview channel flickered. Say it once more.', true);
      endTurn();
    }
  }

  function herStillAudible() {
    return herAudible || ttsPending > 0 || ttsQueueFb > 0;
  }
  function settleIfDone() {
    if (streaming || closed) return;
    if (!herStillAudible()) hooks.onSpeakingLevel?.(0);
  }
  function endTurn(how) {
    streaming = false;
    curAbort = null;
    hooks.onThinking?.(false);
    setOrb();
    if (pendingTurn) {
      const p = pendingTurn;
      pendingTurn = null;
      transmit(p);
      return;
    }
    if (how === 'cut') {
      cutHerVoice();
      settleIfDone();
      return;
    }
    settleIfDone();
    setTimeout(() => { dropHer(); settleIfDone(); }, 25000);
  }
  function bargeIn() {
    if (curAbort) {
      try { curAbort.abort(); } catch { /* */ }
    }
    cutHerVoice();
  }

  async function openChannel() {
    const ok = await startMic();
    if (!ok) {
      orb.classList.add('blocked');
      setTimeout(() => orb.classList.remove('blocked'), 2200);
      return;
    }
    channel = true;
    hooks.onOpenChange?.(true, duplex);
    if (duplex) voice.reset();
    else { recogDead = false; netErrs = 0; startRecog(); }   // reopening is a fresh chance for a flaky recognizer
    setOrb();
  }
  function closeChannel() {
    channel = false;
    stopRecog();
    stopMic();
    bargeIn();
    hooks.onOpenChange?.(false, duplex);
    setOrb();
  }
  orb.addEventListener('click', (e) => {
    e.stopPropagation();
    if (channel) closeChannel();
    else openChannel();
  });

  buildMinds();
  renderLog();
  if (voice.ready) { duplex = true; populateVoices(); }
  setOrb();

  const unload = () => { closeChannel(); voice.close(); };
  window.addEventListener('beforeunload', unload);
  // F6: backgrounding the tab suspends the AudioContext (the worklet stops
  // emitting audible→false) — tell the sidecar she's done NOW over the WS.
  const onVis = () => { if (document.hidden) dropHer(); };
  document.addEventListener('visibilitychange', onVis);
  return () => {
    closed = true;
    window.removeEventListener('beforeunload', unload);
    document.removeEventListener('visibilitychange', onVis);
    dropHer();
    closeChannel();
    voice.close();
  };
}

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const css = `
  .kdl-stamp { position:absolute; left:50%; top:16px; transform:translateX(-50%); z-index:4;
    pointer-events:none; padding:4px 12px; border-radius:999px; font-size:9.5px; letter-spacing:0.18em;
    text-transform:uppercase; color:rgba(var(--hue-c),0.9); border:1px solid rgba(var(--hue-c),0.24);
    background:rgba(5,7,12,0.5); backdrop-filter:blur(8px); }
  .kdl-orb { position:absolute; left:50%; bottom:34px; transform:translateX(-50%); z-index:7;
    width:64px; height:64px; border-radius:50%; cursor:pointer; border:none; background:transparent; }
  .kdl-orb-halo { position:absolute; inset:-22px; border-radius:50%; opacity:0; transition:opacity 0.6s ease;
    background:radial-gradient(circle, rgba(var(--hue-l),0.24), transparent 65%); }
  .kdl-orb-ring { position:absolute; inset:0; border-radius:50%; border:1.5px solid rgba(var(--hue-c),0.42);
    transition:border-color 0.3s ease, box-shadow 0.3s ease; }
  .kdl-orb-core { position:absolute; inset:20px; border-radius:50%; background:rgba(var(--hue-c),0.44);
    box-shadow:0 0 14px rgba(var(--hue-c),0.36); transition:all 0.3s ease; }
  .kdl-orb:hover .kdl-orb-ring { border-color:rgba(var(--hue-c),0.9); box-shadow:0 0 22px rgba(var(--hue-c),0.28); }
  .kdl-orb.live .kdl-orb-halo { opacity:1; animation:kdlHalo 3.2s ease-in-out infinite; }
  .kdl-orb.live .kdl-orb-ring { border-color:rgba(var(--hue-l),0.88); box-shadow:0 0 24px rgba(var(--hue-l),0.35); }
  .kdl-orb.live .kdl-orb-core { inset:16px; background:rgba(var(--hue-l),0.96); box-shadow:0 0 26px rgba(var(--hue-l),0.8); animation:kdlBreath 2.8s ease-in-out infinite; }
  .kdl-orb.thinking .kdl-orb-core { animation:kdlThink 0.9s ease-in-out infinite; }
  .kdl-orb.speaking .kdl-orb-ring { border-color:rgba(var(--hue-r),0.9); }
  .kdl-orb.speaking .kdl-orb-core { background:rgba(var(--hue-r),0.96); box-shadow:0 0 30px rgba(var(--hue-r),0.78); }
  .kdl-orb.fb .kdl-orb-ring { border-style:dashed; border-color:rgba(255,196,140,0.58); }
  .kdl-orb.blocked .kdl-orb-ring { border-color:rgba(255,120,120,0.9); animation:kdlBlocked 0.5s ease-in-out 3; }
  @keyframes kdlBreath { 0%,100%{transform:scale(1);} 50%{transform:scale(1.14);} }
  @keyframes kdlThink { 0%,100%{transform:scale(0.9); opacity:0.75;} 50%{transform:scale(1.22); opacity:1;} }
  @keyframes kdlHalo { 0%,100%{transform:scale(1); opacity:0.75;} 50%{transform:scale(1.35); opacity:1;} }
  @keyframes kdlBlocked { 0%,100%{transform:scale(1);} 50%{transform:scale(1.12);} }

  .kdl-gear, .kdl-log-btn { position:absolute; z-index:8; bottom:40px; width:38px; height:38px; border-radius:50%;
    display:grid; place-items:center; cursor:pointer; color:var(--faint); border:1px solid rgba(255,255,255,0.1);
    background:rgba(8,10,18,0.5); backdrop-filter:blur(10px); transition:color 0.18s ease, border-color 0.18s ease, transform 0.3s ease; }
  .kdl-gear { right:22px; }
  .kdl-log-btn { left:22px; }
  .kdl-gear:hover, .kdl-log-btn:hover { color:var(--dim); border-color:rgba(255,255,255,0.24); }
  .kdl-gear.on { color:rgba(var(--hue-l),1); border-color:rgba(var(--hue-l),0.45); transform:rotate(35deg); }
  .kdl-log-btn.on { color:rgba(var(--hue-c),1); border-color:rgba(var(--hue-c),0.45); }

  .kdl-panel, .kdl-log { position:absolute; z-index:8; max-width:calc(100% - 44px); opacity:0;
    transform:translateY(10px) scale(0.98); pointer-events:none; border-radius:18px;
    border:1px solid rgba(255,255,255,0.1); background:rgba(9,11,19,0.92); backdrop-filter:blur(20px) saturate(1.1);
    box-shadow:0 24px 60px rgba(0,0,0,0.5); transition:opacity 0.24s ease, transform 0.24s var(--ease); }
  .kdl-panel.show, .kdl-log.show { opacity:1; transform:translateY(0) scale(1); pointer-events:auto; }
  .kdl-panel { right:22px; bottom:88px; width:288px; transform-origin:bottom right; display:flex; flex-direction:column; gap:18px; padding:18px; }
  .kdl-group { display:flex; flex-direction:column; gap:9px; }
  .kdl-group-k, .kdl-log-title { font-size:9.5px; letter-spacing:0.24em; text-transform:uppercase; color:var(--faint); }
  .kdl-seg { display:grid; grid-template-columns:repeat(3,1fr); gap:3px; padding:3px; border-radius:12px;
    background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); }
  .kdl-seg-b { font:inherit; font-size:12px; padding:7px 4px; border-radius:9px; cursor:pointer; color:var(--dim);
    border:1px solid transparent; background:transparent; transition:all 0.15s ease; }
  .kdl-seg-b:hover { color:var(--text); }
  .kdl-seg-b.on { color:#fff; background:rgba(var(--hue-l),0.18); border-color:rgba(var(--hue-l),0.5); box-shadow:0 0 12px rgba(var(--hue-l),0.2); }
  .kdl-note { font-size:11px; line-height:1.5; color:var(--faint); min-height:2.6em; }
  .kdl-vlist { display:flex; flex-direction:column; gap:2px; max-height:216px; overflow-y:auto; margin:0 -4px; padding:0 4px; }
  .kdl-vrow { display:flex; align-items:baseline; justify-content:space-between; gap:10px; text-align:left;
    font:inherit; padding:8px 11px; border-radius:10px; cursor:pointer; border:1px solid transparent; background:transparent; transition:all 0.14s ease; }
  .kdl-vrow:hover { background:rgba(255,255,255,0.04); }
  .kdl-vrow.on { background:rgba(var(--hue-r),0.1); border-color:rgba(var(--hue-r),0.4); }
  .kdl-vtop { display:flex; align-items:center; gap:8px; min-width:0; }
  .kdl-vname { font-size:13px; color:var(--text); flex:none; }
  .kdl-vtag { font-size:8.5px; letter-spacing:0.08em; text-transform:uppercase; padding:1px 6px; border-radius:20px; flex:none; }
  .kdl-vtag.is-fast { color:rgba(var(--hue-l),0.95); border:1px solid rgba(var(--hue-l),0.4); background:rgba(var(--hue-l),0.1); }
  .kdl-vtag.is-slow { color:var(--faint); border:1px solid rgba(255,255,255,0.14); }
  .kdl-vrow.slow .kdl-vname { color:var(--dim); }
  .kdl-vhint { font-size:10px; color:var(--faint); text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .kdl-log { left:22px; bottom:88px; width:350px; max-height:min(62vh, 470px); transform-origin:bottom left;
    display:flex; flex-direction:column; overflow:hidden; }
  .kdl-log-head { flex:none; display:flex; align-items:center; justify-content:space-between; padding:13px 15px 10px; border-bottom:1px solid rgba(255,255,255,0.06); }
  .kdl-log-copy { font:inherit; font-size:11px; padding:4px 12px; border-radius:8px; cursor:pointer; color:var(--dim);
    border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.03); }
  .kdl-log-body { flex:1; overflow-y:auto; padding:13px 15px; display:flex; flex-direction:column; gap:12px; }
  .kdl-log-empty { font-size:12px; line-height:1.55; color:var(--faint); }
  .kdl-log-row { display:flex; flex-direction:column; gap:3px; }
  .kdl-log-row.you { align-items:flex-end; }
  .kdl-log-who { font-size:8.5px; letter-spacing:0.18em; text-transform:uppercase; }
  .kdl-log-row.you .kdl-log-who { color:rgba(var(--hue-c),0.9); }
  .kdl-log-row.auma .kdl-log-who { color:rgba(var(--hue-r),0.9); }
  .kdl-log-txt { font-size:13px; line-height:1.5; color:rgba(255,255,255,0.9); max-width:90%; padding:8px 11px;
    border-radius:12px; white-space:pre-wrap; word-break:break-word; }
  .kdl-log-row.you .kdl-log-txt { background:rgba(var(--hue-c),0.1); border:1px solid rgba(var(--hue-c),0.22); border-bottom-right-radius:4px; }
  .kdl-log-row.auma .kdl-log-txt { background:rgba(var(--hue-r),0.08); border:1px solid rgba(var(--hue-r),0.2); border-bottom-left-radius:4px; }
  .kdl-compose { flex:none; display:flex; gap:8px; padding:10px 12px; border-top:1px solid rgba(255,255,255,0.06); }
  .kdl-input { flex:1; min-width:0; font:inherit; font-size:13px; color:var(--text); background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.1); border-radius:11px; padding:8px 11px; outline:none; }
  .kdl-input::placeholder { color:var(--faint); }
  .kdl-input:focus { border-color:rgba(var(--hue-c),0.5); }
  .kdl-send { flex:none; font:inherit; font-size:12px; font-weight:600; padding:0 15px; border-radius:11px; cursor:pointer;
    color:#0b0d16; border:none; background:rgba(var(--hue-c),0.9); }
  `;
  const tag = document.createElement('style');
  tag.id = 'knvs-duplex-style';
  tag.textContent = css;
  document.getElementById('knvs-duplex-style')?.remove();
  document.head.append(tag);
}
