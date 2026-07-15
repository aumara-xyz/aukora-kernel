// Aukora Spatial — TRANSLATE: a live, two-language conversation translator.
//
// Two people, two languages. Pick any two; it listens, auto-detects which of the
// two is being spoken, and shows the translation into the other — big and instant.
// No speaking out loud (that only slows a live conversation down); it's purely
// visual. Speech in (Web Speech API, on-device) → fast interpreter (llama on
// groq via the local door /api/translate) → big text out.
//
// AUTO-DETECT: the recognizer can only listen in one language at a time, so it
// ping-pongs — after each line, it switches to the language the *reply* is most
// likely in (the one we just translated INTO). Natural back-and-forth just flows.

const DOOR = 'http://127.0.0.1:7091';

// A broad set of languages. `name` is the English name sent to the interpreter;
// `native` shows in the picker; `bcp` drives the on-device speech recognizer.
const LANGS = [
  { code: 'en', bcp: 'en-US', name: 'English', native: 'English' },
  { code: 'es', bcp: 'es-ES', name: 'Spanish', native: 'Español' },
  { code: 'fr', bcp: 'fr-FR', name: 'French', native: 'Français' },
  { code: 'de', bcp: 'de-DE', name: 'German', native: 'Deutsch' },
  { code: 'it', bcp: 'it-IT', name: 'Italian', native: 'Italiano' },
  { code: 'pt', bcp: 'pt-BR', name: 'Portuguese', native: 'Português' },
  { code: 'nl', bcp: 'nl-NL', name: 'Dutch', native: 'Nederlands' },
  { code: 'ru', bcp: 'ru-RU', name: 'Russian', native: 'Русский' },
  { code: 'zh', bcp: 'zh-CN', name: 'Mandarin Chinese', native: '中文' },
  { code: 'ja', bcp: 'ja-JP', name: 'Japanese', native: '日本語' },
  { code: 'ko', bcp: 'ko-KR', name: 'Korean', native: '한국어' },
  { code: 'ar', bcp: 'ar-SA', name: 'Arabic', native: 'العربية' },
  { code: 'hi', bcp: 'hi-IN', name: 'Hindi', native: 'हिन्दी' },
  { code: 'tr', bcp: 'tr-TR', name: 'Turkish', native: 'Türkçe' },
  { code: 'pl', bcp: 'pl-PL', name: 'Polish', native: 'Polski' },
  { code: 'vi', bcp: 'vi-VN', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', bcp: 'th-TH', name: 'Thai', native: 'ไทย' },
  { code: 'id', bcp: 'id-ID', name: 'Indonesian', native: 'Indonesia' },
  { code: 'sv', bcp: 'sv-SE', name: 'Swedish', native: 'Svenska' },
  { code: 'uk', bcp: 'uk-UA', name: 'Ukrainian', native: 'Українська' },
  { code: 'el', bcp: 'el-GR', name: 'Greek', native: 'Ελληνικά' },
  { code: 'he', bcp: 'he-IL', name: 'Hebrew', native: 'עברית' },
  { code: 'fa', bcp: 'fa-IR', name: 'Persian', native: 'فارسی' },
  { code: 'ro', bcp: 'ro-RO', name: 'Romanian', native: 'Română' },
  { code: 'cs', bcp: 'cs-CZ', name: 'Czech', native: 'Čeština' },
  { code: 'hu', bcp: 'hu-HU', name: 'Hungarian', native: 'Magyar' },
  { code: 'fi', bcp: 'fi-FI', name: 'Finnish', native: 'Suomi' },
  { code: 'da', bcp: 'da-DK', name: 'Danish', native: 'Dansk' },
  { code: 'no', bcp: 'nb-NO', name: 'Norwegian', native: 'Norsk' },
  { code: 'fil', bcp: 'fil-PH', name: 'Filipino', native: 'Filipino' },
];
const byCode = (c) => LANGS.find((l) => l.code === c) || LANGS[0];

const A_KEY = 'aukora-translate-langA';
const B_KEY = 'aukora-translate-langB';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function mountTranslate(root) {
  injectStyle();

  // ---- persisted language choices (default English ⇄ Spanish) ----
  let A = byCode(localStorage.getItem(A_KEY) || 'en');
  let B = byCode(localStorage.getItem(B_KEY) || 'es');
  if (A.code === B.code) B = byCode(A.code === 'en' ? 'es' : 'en');

  const app = el('div', 'tr-app');

  // header
  const head = el('div', 'tr-head');
  head.append(el('div', 'tr-title', 'Translate'));
  head.append(el('div', 'tr-sub', 'two languages, one conversation — it hears both and flows both ways'));
  app.append(head);

  // language bar: [A ▾]  ⇄  [B ▾]
  const bar = el('div', 'tr-bar');
  const selA = langSelect('a', A, (l) => { A = l; persist(); resetForLangChange(); });
  const swap = el('button', 'tr-swap'); swap.type = 'button'; swap.title = 'swap languages';
  swap.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4L4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7"/></svg>';
  const selB = langSelect('b', B, (l) => { B = l; persist(); resetForLangChange(); });
  bar.append(selA.wrap, swap, selB.wrap);
  app.append(bar);
  swap.addEventListener('click', () => {
    const t = A; A = B; B = t;
    selA.set(A); selB.set(B); persist(); resetForLangChange();
  });

  // the stage — the current translation, big
  const stage = el('div', 'tr-stage');
  const placeholder = el('div', 'tr-placeholder', 'Press listen and speak. Whichever of the two languages you use, it shows up translated here — instantly.');
  const orig = el('div', 'tr-orig');       // small: what was heard (source)
  const dirRow = el('div', 'tr-dir');       // "English → Spanish"
  const big = el('div', 'tr-big');          // the translation, large
  stage.append(placeholder, orig, dirRow, big);
  app.append(stage);

  // interim / status line
  const status = el('div', 'tr-status');
  app.append(status);

  // the big mic button
  const mic = el('button', 'tr-mic'); mic.type = 'button';
  mic.innerHTML = '<span class="tr-mic-ring"></span><span class="tr-mic-core"></span><span class="tr-mic-label">listen</span>';
  app.append(mic);

  // a compact history of recent lines
  const histWrap = el('div', 'tr-hist');
  app.append(histWrap);

  if (!SR) {
    const un = el('div', 'tr-unsupported', 'Live listening needs Chrome or Edge (the browser’s on-device speech recognition). Open this in Chrome to talk.');
    stage.after(un);
    mic.style.display = 'none';
  }

  root.append(app);

  // ---- language selector builder ----
  function langSelect(slot, cur, onChange) {
    const wrap = el('div', 'tr-lang tr-lang-' + slot);
    const sel = document.createElement('select');
    sel.className = 'tr-lang-sel';
    for (const l of LANGS) {
      const o = document.createElement('option');
      o.value = l.code; o.textContent = l.native + (l.native !== l.name ? '  ·  ' + l.name : '');
      sel.append(o);
    }
    sel.value = cur.code;
    sel.addEventListener('change', () => onChange(byCode(sel.value)));
    wrap.append(sel);
    return { wrap, sel, get: () => byCode(sel.value), set: (l) => { sel.value = l.code; } };
  }

  function persist() {
    try { localStorage.setItem(A_KEY, A.code); localStorage.setItem(B_KEY, B.code); } catch { /* */ }
  }

  // ---- state ----
  let listening = false;
  let recog = null;
  let curBcp = A.bcp;        // which language the recognizer is currently hearing
  let inflight = 0;          // outstanding translation requests (newest-wins guard)
  let closed = false;

  // ---- speech recognition (auto-restarting, language ping-pong) ----
  function buildRecog() {
    const r = new SR();
    r.lang = curBcp;
    r.continuous = true;
    r.interimResults = true;
    let finalText = '';
    r.onresult = (ev) => {
      let interim = '';
      finalText = '';
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim.trim()) { status.textContent = interim.trim(); status.classList.add('live'); status.classList.remove('err'); }
    };
    r.onend = () => {
      status.classList.remove('live');
      const say = finalText.trim();
      finalText = '';
      if (say) translate(say);
      // keep the channel open: restart (possibly in a newly-chosen language)
      if (listening && !closed) { r.lang = curBcp; try { r.start(); } catch { setTimeout(() => { if (listening && !closed) startRecog(); }, 250); } }
    };
    r.onerror = (e) => {
      status.classList.remove('live');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { showErr('microphone is blocked — allow mic access, then press listen'); stopListening(); }
      else if (e.error === 'network') showErr('speech recognition lost its connection — retrying');
      /* 'no-speech' / 'aborted' are normal; onend restarts */
    };
    return r;
  }
  function startRecog() {
    try { recog && recog.abort(); } catch { /* */ }
    recog = buildRecog();
    try { recog.start(); } catch { /* start may throw if called too fast; onend retries */ }
  }

  // Ping-pong: after a line, the reply usually comes in the OTHER language, so
  // aim the recognizer there. If the target's BCP differs, cycle the recognizer.
  function aimAt(bcp) {
    if (bcp === curBcp) return;
    curBcp = bcp;
    if (listening && recog) { try { recog.stop(); } catch { startRecog(); } } // onend restarts in curBcp
  }

  // ---- translate one utterance ----
  async function translate(text) {
    const myA = A, myB = B;                        // capture in case the user swaps mid-flight
    const turn = ++inflight;
    status.textContent = 'translating…'; status.classList.remove('err');
    orig.textContent = text;
    placeholder.style.display = 'none';
    stage.classList.add('working');
    try {
      const res = await fetch(`${DOOR}/api/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, langA: myA.name, langB: myB.name }),
      });
      const data = await res.json();
      if (turn !== inflight) return;               // a newer utterance already superseded this
      stage.classList.remove('working');
      if (!res.ok || !data.translation) { showErr(data.error || 'couldn’t translate that — try again'); return; }
      const srcIsA = matchLang(data.src, myA, myB) === myA;
      const srcL = srcIsA ? myA : myB;
      const tgtL = srcIsA ? myB : myA;
      showTranslation(text, data.translation, srcL, tgtL);
      aimAt(tgtL.bcp);                             // the reply is most likely in the target language
    } catch (e) {
      if (turn === inflight) { stage.classList.remove('working'); showErr('the channel flickered — say it again'); }
    }
  }

  // pick which of the two langs the model's "src" string refers to (robust to
  // it returning the English name, a native name, or a code)
  function matchLang(src, a, b) {
    const s = String(src || '').toLowerCase().trim();
    if (!s) return a;
    const hit = (l) => s.includes(l.name.toLowerCase()) || s.includes(l.native.toLowerCase()) || s === l.code;
    if (hit(a)) return a;
    if (hit(b)) return b;
    return a; // default; the translation still displays either way
  }

  function showTranslation(text, translation, srcL, tgtL) {
    status.textContent = ''; status.classList.remove('err');
    orig.textContent = text;
    orig.className = 'tr-orig hue-' + (srcL === A ? 'a' : 'b');
    setLang(orig, srcL);
    dirRow.innerHTML = '';
    dirRow.append(
      el('span', 'tr-dir-src hue-' + (srcL === A ? 'a' : 'b'), srcL.native),
      el('span', 'tr-dir-arrow', '→'),
      el('span', 'tr-dir-tgt hue-' + (tgtL === A ? 'a' : 'b'), tgtL.native));
    big.textContent = translation;
    big.className = 'tr-big show hue-' + (tgtL === A ? 'a' : 'b');
    setLang(big, tgtL);
    // history (newest on top), capped
    const row = el('div', 'tr-hrow');
    const htgt = el('div', 'tr-htgt hue-' + (tgtL === A ? 'a' : 'b'), translation);
    setLang(htgt, tgtL);
    row.append(el('div', 'tr-hsrc', text), htgt);
    histWrap.prepend(row);
    while (histWrap.children.length > 12) histWrap.lastChild.remove();
  }
  function setLang(node, l) { node.setAttribute('lang', l.code); node.dir = /^(ar|he|fa)$/.test(l.code) ? 'rtl' : 'ltr'; }

  let errTimer = 0;
  function showErr(msg) { status.textContent = msg; status.classList.add('err'); status.classList.remove('live'); clearTimeout(errTimer); errTimer = setTimeout(() => { status.classList.remove('err'); if (status.textContent === msg) status.textContent = listening ? 'listening…' : ''; }, 3200); }

  // ---- listen toggle ----
  function startListening() {
    listening = true;
    curBcp = A.bcp;
    mic.classList.add('on');
    mic.querySelector('.tr-mic-label').textContent = 'listening…';
    status.textContent = 'listening — go ahead'; status.classList.remove('err');
    startRecog();
  }
  function stopListening() {
    listening = false;
    mic.classList.remove('on');
    mic.querySelector('.tr-mic-label').textContent = 'listen';
    status.classList.remove('live');
    if (!status.classList.contains('err')) status.textContent = '';
    try { recog && recog.stop(); } catch { /* */ }
  }
  mic.addEventListener('click', () => { if (listening) stopListening(); else startListening(); });

  function resetForLangChange() {
    if (A.code === B.code) { B = byCode(A.code === 'en' ? 'es' : 'en'); selB.set(B); persist(); }
    curBcp = A.bcp;
    if (listening) startRecog();                   // re-aim at the (new) A language
  }

  // ---- teardown ----
  const onVis = () => { if (document.hidden && listening) stopListening(); };
  document.addEventListener('visibilitychange', onVis);
  window.__translateCleanup?.();
  window.__translateCleanup = () => { closed = true; document.removeEventListener('visibilitychange', onVis); try { recog && recog.abort(); } catch { /* */ } };
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .tr-app { position:absolute; inset:0; overflow-y:auto; display:flex; flex-direction:column; align-items:center;
    padding:26px clamp(16px,4vw,44px) 40px; color:var(--text);
    background:radial-gradient(120% 80% at 50% 0%, rgba(var(--hue-c),0.06), transparent 58%), #111520;
    --a:var(--hue-c); --b:var(--hue-l); }
  .tr-app::-webkit-scrollbar { width:8px; } .tr-app::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.12); border-radius:4px; }
  .hue-a { color:rgba(var(--a),0.96); } .hue-b { color:rgba(var(--b),0.96); }

  .tr-head { text-align:center; }
  .tr-title { font-size:20px; font-weight:680; letter-spacing:0.02em; color:#fff; }
  .tr-sub { font-size:12px; color:var(--dim); margin-top:4px; }

  /* language bar */
  .tr-bar { display:flex; align-items:center; justify-content:center; gap:12px; margin:20px 0 6px; width:100%; max-width:640px; }
  .tr-lang { flex:1; max-width:260px; position:relative; }
  .tr-lang::after { content:'▾'; position:absolute; right:13px; top:50%; transform:translateY(-50%); pointer-events:none; font-size:11px; color:var(--faint); }
  .tr-lang-sel { width:100%; font:inherit; font-size:15px; font-weight:560; color:#fff; cursor:pointer; -webkit-appearance:none; appearance:none;
    padding:12px 30px 12px 15px; border-radius:13px; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.04); text-align:center; text-align-last:center; }
  .tr-lang-a .tr-lang-sel { border-color:rgba(var(--a),0.4); }
  .tr-lang-b .tr-lang-sel { border-color:rgba(var(--b),0.4); }
  .tr-lang-sel:focus { outline:none; }
  .tr-lang-sel option { background:#151a26; color:#fff; text-align:left; }
  .tr-swap { flex:none; width:40px; height:40px; border-radius:50%; display:grid; place-items:center; cursor:pointer; color:var(--dim);
    border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.03); transition:color 0.16s ease, border-color 0.16s ease, transform 0.35s var(--ease); }
  .tr-swap:hover { color:#fff; border-color:rgba(255,255,255,0.3); transform:rotate(180deg); }

  /* the stage — big current translation */
  .tr-stage { width:100%; max-width:720px; min-height:210px; margin-top:18px; display:flex; flex-direction:column; align-items:center; justify-content:center;
    text-align:center; padding:28px 24px; border-radius:22px; border:1px solid rgba(255,255,255,0.08);
    background:rgba(255,255,255,0.02); transition:border-color 0.3s ease; }
  .tr-stage.working { border-color:rgba(var(--a),0.32); }
  .tr-placeholder { font-size:14px; line-height:1.6; color:var(--faint); max-width:460px; }
  .tr-orig { font-size:15px; line-height:1.5; color:var(--dim); margin-bottom:10px; max-width:640px; opacity:0.9; }
  .tr-orig:empty { display:none; }
  .tr-dir { display:flex; align-items:center; gap:9px; font-size:11px; letter-spacing:0.05em; text-transform:uppercase; margin-bottom:14px; }
  .tr-dir:empty { display:none; }
  .tr-dir-arrow { color:var(--faint); }
  .tr-big { font-size:clamp(26px, 4.4vw, 44px); line-height:1.25; font-weight:600; color:#fff; max-width:680px;
    opacity:0; transform:translateY(8px); transition:opacity 0.3s ease, transform 0.3s ease; }
  .tr-big.show { opacity:1; transform:none; }

  /* status / interim */
  .tr-status { min-height:1.4em; margin-top:16px; font-size:13.5px; color:var(--faint); text-align:center; transition:color 0.2s ease; }
  .tr-status.live { color:rgba(var(--a),0.9); font-style:italic; }
  .tr-status.err { color:rgba(255,150,150,0.95); }

  /* mic */
  .tr-mic { position:relative; margin-top:14px; margin-bottom:12px; width:76px; height:76px; border-radius:50%; cursor:pointer; border:none; background:transparent; }
  .tr-mic-ring { position:absolute; inset:0; border-radius:50%; border:1.5px solid rgba(var(--a),0.45); transition:all 0.25s ease; }
  .tr-mic-core { position:absolute; inset:24px; border-radius:50%; background:rgba(var(--a),0.4); box-shadow:0 0 14px rgba(var(--a),0.3); transition:all 0.25s ease; }
  .tr-mic-label { position:absolute; left:50%; bottom:-22px; transform:translateX(-50%); font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--faint); white-space:nowrap; }
  .tr-mic:hover .tr-mic-ring { border-color:rgba(var(--a),0.8); box-shadow:0 0 18px rgba(var(--a),0.25); }
  .tr-mic.on .tr-mic-ring { border-color:rgba(var(--a),0.95); box-shadow:0 0 26px rgba(var(--a),0.5); animation:trPulse 1.8s ease-in-out infinite; }
  .tr-mic.on .tr-mic-core { inset:20px; background:rgba(var(--a),0.95); box-shadow:0 0 30px rgba(var(--a),0.7); }
  .tr-mic.on .tr-mic-label { color:rgba(var(--a),0.95); }
  @keyframes trPulse { 0%,100%{transform:scale(1);opacity:1;} 50%{transform:scale(1.12);opacity:0.75;} }

  /* history */
  .tr-hist { width:100%; max-width:720px; margin-top:24px; display:flex; flex-direction:column; gap:8px; }
  .tr-hrow { padding:11px 15px; border-radius:13px; border:1px solid rgba(255,255,255,0.07); background:rgba(255,255,255,0.02); }
  .tr-hsrc { font-size:12.5px; color:var(--faint); }
  .tr-htgt { font-size:16px; color:#fff; margin-top:4px; line-height:1.4; }

  .tr-unsupported { max-width:520px; margin:16px auto 0; padding:13px 16px; border-radius:14px; font-size:13px; line-height:1.55;
    color:rgba(255,200,140,0.95); border:1px solid rgba(255,180,90,0.3); background:rgba(255,180,90,0.06); text-align:center; }
  `;
  const tag = document.createElement('style');
  tag.id = 'translate-style';
  tag.textContent = css;
  document.getElementById('translate-style')?.remove();
  document.head.append(tag);
}
