// Aukora Spatial — AUKORA · XYZ: the public site's own dashboard, living inside
// Aukora's IDE. It reads aukora.xyz's collected visitor data (waitlist emails +
// Ask-Auma conversations) from lander/data/ via the read-only :7090 /api/site-data
// endpoint, and shows overview stats, the recent chats (each readable one by one),
// and a deterministic read of what people are curious about.
//
// HONEST SEPARATION (load-bearing): the site's Auma is a SEPARATE, stateless model
// running on Vercel — it is NOT Aukora's own Kira brain. This organ only tallies
// the raw files the site wrote; it never calls a model and never touches memory.

const DATA_URL = '/api/site-data';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function relTime(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  try { return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}

// A collapsible section — bar toggles the body open (same language as the AURA page).
function section(host, hue, title, sub, count) {
  const wrap = el('div', `axyz-sec hue-${hue}`);
  const bar = el('button', 'axyz-sec-bar'); bar.type = 'button';
  const txt = el('div', 'axyz-sec-bartext');
  const titleRow = el('div', 'axyz-sec-titlerow');
  titleRow.append(el('div', 'axyz-sec-title', title));
  if (count != null) titleRow.append(el('span', 'axyz-sec-count', String(count)));
  txt.append(titleRow);
  if (sub) txt.append(el('div', 'axyz-sec-sub', sub));
  bar.append(txt, el('div', 'axyz-sec-chev'));
  wrap.append(bar);
  const body = el('div', 'axyz-sec-body');
  wrap.append(body);
  bar.addEventListener('click', () => wrap.classList.toggle('open'));
  host.append(wrap);
  return body;
}

export function mountAukoraXyz(root) {
  injectStyle();
  const app = el('div', 'axyz-app');

  // ---- header ----
  const head = el('div', 'axyz-head');
  const headL = el('div', 'axyz-head-l');
  const title = el('div', 'axyz-title');
  title.innerHTML = '<b>Aukora</b><span class="axyz-dot"></span><i>xyz</i>';
  headL.append(title, el('div', 'axyz-sub', 'aukora.xyz · live visitor data, straight from the site'));
  const refresh = el('button', 'axyz-refresh'); refresh.type = 'button';
  refresh.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg><span>refresh</span>';
  head.append(headL, refresh);
  app.append(head);

  // honest note about the separate brain
  const note = el('div', 'axyz-note');
  note.innerHTML = 'The site runs a <b>separate, stateless model</b> for its own Ask-Auma widget — this dashboard only reads what it collected. Nothing here touches Aukora’s own Kira memory. Loopback-only; this visitor data never leaves your machine.';
  app.append(note);

  const body = el('div', 'axyz-body');
  app.append(body);

  root.append(app);

  async function load() {
    body.innerHTML = '';
    const loading = el('div', 'axyz-loading', 'reading the site…');
    body.append(loading);
    let data;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      data = await res.json();
      if (data.error) throw new Error(data.error);
    } catch (e) {
      body.innerHTML = '';
      body.append(el('div', 'axyz-empty', 'Couldn’t reach the site data endpoint. Is the spatial server (:7090) running?'));
      return;
    }
    render(data);
  }

  function render(data) {
    body.innerHTML = '';
    const o = data.overview || {};

    // ---- overview stat cards ----
    const stats = el('div', 'axyz-stats');
    const stat = (n, label, hue, sub) => {
      const c = el('div', `axyz-stat hue-${hue}`);
      c.append(el('div', 'axyz-stat-n', String(n)));
      c.append(el('div', 'axyz-stat-k', label));
      if (sub) c.append(el('div', 'axyz-stat-sub', sub));
      return c;
    };
    stats.append(
      stat(o.sessions ?? 0, 'chat sessions', 'c', o.lastSeen ? 'last ' + relTime(o.lastSeen) : ''),
      stat(o.messages ?? 0, 'messages', 'l', `${o.userMessages ?? 0} from visitors`),
      stat(o.emails ?? 0, 'emails collected', 'r', 'waitlist'),
      stat(o.avgMsgsPerSession ?? 0, 'avg / session', 'c', 'depth of chat'),
    );
    body.append(stats);

    const chats = Array.isArray(data.chats) ? data.chats : [];
    const flaggedN = chats.filter((c) => c.flagged).length;

    // ---- SECTION 1: recent chats ----
    const chatsBody = section(body, 'c', 'Recent chats',
      chats.length ? 'each session from a real site visitor — click one to read it' : 'no conversations yet',
      chats.length);
    if (flaggedN) {
      const warn = el('div', 'axyz-flagnote');
      warn.innerHTML = `<span class="axyz-flag-dot"></span>${flaggedN} session${flaggedN > 1 ? 's' : ''} flagged for a quick look (rough keyword check for rude/abusive language — not a real sentiment read).`;
      chatsBody.append(warn);
    }
    if (!chats.length) {
      chatsBody.append(el('div', 'axyz-empty', 'When someone talks to Auma on aukora.xyz, their conversation shows up here.'));
    } else {
      for (const c of chats) chatsBody.append(chatCard(c));
    }

    // ---- SECTION 2: what people are curious about ----
    const topics = Array.isArray(data.topics) ? data.topics : [];
    const words = Array.isArray(data.topWords) ? data.topWords : [];
    const curioBody = section(body, 'l', 'What people are curious about',
      topics.length ? 'their questions, rolled into themes' : 'nothing to analyze yet', null);
    if (!topics.length && !words.length) {
      curioBody.append(el('div', 'axyz-empty', 'Topics and common words appear here once visitors start asking things.'));
    } else {
      if (topics.length) {
        const maxT = Math.max(...topics.map((t) => t.count), 1);
        const bars = el('div', 'axyz-topics');
        for (const t of topics) {
          const row = el('div', 'axyz-topic');
          row.append(el('div', 'axyz-topic-name', t.topic));
          const track = el('div', 'axyz-topic-track');
          const fill = el('div', 'axyz-topic-fill');
          fill.style.width = Math.max(6, (t.count / maxT) * 100) + '%';
          track.append(fill);
          row.append(track, el('div', 'axyz-topic-n', String(t.count)));
          bars.append(row);
        }
        curioBody.append(bars);
      }
      if (words.length) {
        curioBody.append(el('div', 'axyz-words-k', 'words they use most'));
        const cloud = el('div', 'axyz-words');
        const maxW = Math.max(...words.map((w) => w.count), 1);
        for (const w of words) {
          const chip = el('span', 'axyz-word', w.word);
          const scale = 0.82 + 0.6 * (w.count / maxW);
          chip.style.fontSize = scale.toFixed(2) + 'em';
          chip.style.opacity = (0.55 + 0.45 * (w.count / maxW)).toFixed(2);
          if (w.count > 1) chip.title = `${w.count}×`;
          cloud.append(chip);
        }
        curioBody.append(cloud);
      }
    }

    // ---- SECTION 3: emails ----
    const emails = Array.isArray(data.emails) ? data.emails : [];
    const mailBody = section(body, 'r', 'Emails collected',
      emails.length ? 'public-release waitlist' : 'none yet', emails.length);
    if (!emails.length) {
      mailBody.append(el('div', 'axyz-empty', 'Waitlist signups from the “public release coming soon” box land here.'));
    } else {
      const list = el('div', 'axyz-maillist');
      for (const m of emails) {
        const r = el('div', 'axyz-mail');
        r.append(el('span', 'axyz-mail-addr', m.email));
        r.append(el('span', 'axyz-mail-ts', relTime(m.ts)));
        list.append(r);
      }
      mailBody.append(list);
    }

    // generated-at footer
    body.append(el('div', 'axyz-gen', data.generatedAt ? 'read ' + relTime(data.generatedAt) : ''));
  }

  // a single chat session — a nested expander: head (first Q + meta) → full thread
  function chatCard(c) {
    const card = el('div', 'axyz-chat' + (c.flagged ? ' flagged' : ''));
    const head = el('button', 'axyz-chat-head'); head.type = 'button';
    const left = el('div', 'axyz-chat-headtext');
    const q = el('div', 'axyz-chat-q', c.firstQuestion || '(no opening question)');
    left.append(q);
    const meta = el('div', 'axyz-chat-meta');
    meta.append(el('span', null, `${c.messageCount} message${c.messageCount === 1 ? '' : 's'}`));
    if (c.updatedAt) meta.append(el('span', 'axyz-chat-dot', '·'), el('span', null, relTime(c.updatedAt)));
    if (c.flagged) meta.append(el('span', 'axyz-chat-flag', 'flagged'));
    left.append(meta);
    head.append(left, el('div', 'axyz-chat-chev'));
    card.append(head);

    const thread = el('div', 'axyz-chat-thread');
    for (const m of c.messages) {
      const row = el('div', 'axyz-msg ' + (m.role === 'user' ? 'you' : 'auma'));
      row.append(el('div', 'axyz-msg-who', m.role === 'user' ? 'visitor' : 'Auma'));
      row.append(el('div', 'axyz-msg-txt', m.content));
      thread.append(row);
    }
    card.append(thread);
    head.addEventListener('click', () => card.classList.toggle('open'));
    return card;
  }

  refresh.addEventListener('click', () => { refresh.classList.add('spin'); load().finally(() => setTimeout(() => refresh.classList.remove('spin'), 400)); });
  load();
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .axyz-app { position:absolute; inset:0; overflow-y:auto; padding:22px clamp(16px,4vw,40px) 60px;
    background:radial-gradient(120% 90% at 50% 0%, rgba(var(--hue-c),0.06), transparent 60%), #111520; color:var(--text); }
  .axyz-app::-webkit-scrollbar { width:8px; } .axyz-app::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.12); border-radius:4px; }

  .axyz-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; max-width:820px; margin:0 auto; }
  .axyz-title { display:flex; align-items:center; gap:9px; }
  .axyz-title b { font-size:22px; font-weight:720; letter-spacing:0.01em; color:#fff; }
  .axyz-title i { font-style:normal; font-size:22px; font-weight:720; letter-spacing:0.14em;
    background:linear-gradient(100deg, rgb(var(--hue-l)), rgb(var(--hue-c)), rgb(var(--hue-r)));
    -webkit-background-clip:text; background-clip:text; color:transparent; }
  .axyz-dot { width:7px; height:7px; border-radius:50%; background:rgb(var(--hue-l)); box-shadow:0 0 10px rgb(var(--hue-l)); animation:axyzPulse 2.4s ease-in-out infinite; }
  @keyframes axyzPulse { 0%,100%{opacity:0.5;} 50%{opacity:1;} }
  .axyz-sub { font-size:12px; color:var(--dim); margin-top:4px; }
  .axyz-refresh { flex:none; display:inline-flex; align-items:center; gap:7px; font:inherit; font-size:12px; cursor:pointer;
    color:var(--dim); padding:7px 13px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.03);
    transition:color 0.16s ease, border-color 0.16s ease; }
  .axyz-refresh:hover { color:#fff; border-color:rgba(var(--hue-c),0.5); }
  .axyz-refresh.spin svg { animation:axyzSpin 0.6s linear; }
  @keyframes axyzSpin { to { transform:rotate(360deg); } }

  .axyz-note { max-width:820px; margin:14px auto 0; font-size:11.5px; line-height:1.55; color:var(--faint);
    padding:11px 14px; border-radius:12px; border:1px solid rgba(var(--hue-l),0.18); background:rgba(var(--hue-l),0.04); }
  .axyz-note b { color:rgba(var(--hue-l),0.95); font-weight:600; }

  .axyz-body { max-width:820px; margin:18px auto 0; }
  .axyz-loading, .axyz-empty { font-size:13px; color:var(--faint); padding:20px 4px; text-align:center; }

  /* overview stat cards — auto-fit wraps by the PANE's width, not the viewport,
     so they never clip when the center lane is narrow */
  .axyz-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(132px, 1fr)); gap:11px; margin-bottom:6px; }
  .axyz-stat { padding:15px 16px; border-radius:15px; border:1px solid rgba(var(--ac),0.26);
    background:linear-gradient(160deg, rgba(var(--ac),0.12), rgba(var(--ac),0.03)); }
  .axyz-stat.hue-l { --ac:var(--hue-l); } .axyz-stat.hue-c { --ac:var(--hue-c); } .axyz-stat.hue-r { --ac:var(--hue-r); }
  .axyz-stat-n { font-size:30px; font-weight:730; line-height:1; color:#fff; }
  .axyz-stat-k { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:rgba(var(--ac),0.95); margin-top:8px; }
  .axyz-stat-sub { font-size:10.5px; color:var(--faint); margin-top:3px; }

  /* accordion sections */
  .axyz-sec { margin:11px 0; }
  .axyz-sec.hue-l { --ac:var(--hue-l); } .axyz-sec.hue-c { --ac:var(--hue-c); } .axyz-sec.hue-r { --ac:var(--hue-r); }
  .axyz-sec-bar { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left; cursor:pointer; font:inherit;
    padding:13px 16px; border-radius:14px; border:1px solid rgba(var(--ac),0.28);
    background:linear-gradient(100deg, rgba(var(--ac),0.15), rgba(var(--ac),0.04) 70%, transparent); transition:background 0.16s ease; }
  .axyz-sec-bar:hover { background:linear-gradient(100deg, rgba(var(--ac),0.22), rgba(var(--ac),0.06) 70%, transparent); }
  .axyz-sec.open .axyz-sec-bar { border-radius:14px 14px 0 0; border-bottom-color:transparent; }
  .axyz-sec-titlerow { display:flex; align-items:center; gap:9px; }
  .axyz-sec-title { font-size:14.5px; font-weight:650; color:#fff; }
  .axyz-sec-count { font-size:11px; font-weight:600; padding:1px 8px; border-radius:20px; color:rgba(var(--ac),0.95);
    background:rgba(var(--ac),0.14); border:1px solid rgba(var(--ac),0.3); }
  .axyz-sec-sub { font-size:11.5px; color:var(--dim); margin-top:2px; }
  .axyz-sec-chev { flex:none; width:18px; height:18px; position:relative; }
  .axyz-sec-chev::before { content:''; position:absolute; top:5px; left:5px; width:7px; height:7px;
    border-right:2px solid rgba(var(--ac),0.9); border-bottom:2px solid rgba(var(--ac),0.9); transform:rotate(45deg); transition:transform 0.25s ease, top 0.25s ease; }
  .axyz-sec.open .axyz-sec-chev::before { transform:rotate(-135deg); top:8px; }
  .axyz-sec-body { max-height:0; overflow:hidden; opacity:0;
    border-radius:0 0 14px 14px; background:rgba(var(--ac),0.03);
    transition:max-height 0.36s ease, opacity 0.28s ease, padding 0.3s ease; }
  .axyz-sec.open .axyz-sec-body { max-height:75vh; overflow-y:auto; opacity:1; padding:13px 14px 16px;
    border:1px solid rgba(var(--ac),0.16); border-top:none; }
  .axyz-sec-body::-webkit-scrollbar { width:7px; } .axyz-sec-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.14); border-radius:4px; }

  .axyz-flagnote { display:flex; align-items:center; gap:8px; font-size:11.5px; color:rgba(255,180,120,0.95);
    padding:9px 12px; margin-bottom:10px; border-radius:10px; border:1px solid rgba(255,170,90,0.28); background:rgba(255,170,90,0.07); }
  .axyz-flag-dot { flex:none; width:7px; height:7px; border-radius:50%; background:rgb(255,170,90); box-shadow:0 0 8px rgba(255,170,90,0.7); }

  /* a chat session card (nested expander) */
  .axyz-chat { margin:7px 0; border-radius:12px; border:1px solid rgba(255,255,255,0.09); background:rgba(255,255,255,0.02); overflow:hidden; }
  .axyz-chat.flagged { border-color:rgba(255,170,90,0.35); background:rgba(255,170,90,0.04); }
  .axyz-chat-head { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left; cursor:pointer; font:inherit;
    padding:11px 14px; background:transparent; border:none; transition:background 0.15s ease; }
  .axyz-chat-head:hover { background:rgba(255,255,255,0.03); }
  .axyz-chat-headtext { min-width:0; flex:1; }
  .axyz-chat-q { font-size:13.5px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .axyz-chat-meta { display:flex; align-items:center; gap:6px; margin-top:3px; font-size:10.5px; color:var(--faint); }
  .axyz-chat-flag { color:rgba(255,180,120,0.95); border:1px solid rgba(255,170,90,0.4); border-radius:20px; padding:0 7px; }
  .axyz-chat-chev { flex:none; width:16px; height:16px; position:relative; }
  .axyz-chat-chev::before { content:''; position:absolute; top:4px; left:5px; width:6px; height:6px;
    border-right:2px solid rgba(255,255,255,0.5); border-bottom:2px solid rgba(255,255,255,0.5); transform:rotate(45deg); transition:transform 0.24s ease, top 0.24s ease; }
  .axyz-chat.open .axyz-chat-chev::before { transform:rotate(-135deg); top:7px; }
  .axyz-chat-thread { max-height:0; overflow:hidden; opacity:0; display:flex; flex-direction:column; gap:10px; padding:0 14px;
    transition:max-height 0.34s ease, opacity 0.26s ease, padding 0.28s ease; }
  .axyz-chat.open .axyz-chat-thread { max-height:2600px; opacity:1; padding:4px 14px 15px; }
  .axyz-msg { display:flex; flex-direction:column; gap:3px; }
  .axyz-msg.you { align-items:flex-end; }
  .axyz-msg-who { font-size:8.5px; letter-spacing:0.16em; text-transform:uppercase; }
  .axyz-msg.you .axyz-msg-who { color:rgba(var(--hue-c),0.9); }
  .axyz-msg.auma .axyz-msg-who { color:rgba(var(--hue-r),0.9); }
  .axyz-msg-txt { font-size:13px; line-height:1.5; color:rgba(255,255,255,0.9); max-width:86%; padding:8px 12px; border-radius:12px; white-space:pre-wrap; word-break:break-word; }
  .axyz-msg.you .axyz-msg-txt { background:rgba(var(--hue-c),0.1); border:1px solid rgba(var(--hue-c),0.24); border-bottom-right-radius:4px; }
  .axyz-msg.auma .axyz-msg-txt { background:rgba(var(--hue-r),0.08); border:1px solid rgba(var(--hue-r),0.2); border-bottom-left-radius:4px; }

  /* curiosity: topic bars + word cloud */
  .axyz-topics { display:flex; flex-direction:column; gap:9px; }
  .axyz-topic { display:grid; grid-template-columns:minmax(120px,1.1fr) 2fr auto; align-items:center; gap:11px; }
  .axyz-topic-name { font-size:12.5px; color:rgba(255,255,255,0.9); }
  .axyz-topic-track { height:9px; border-radius:5px; background:rgba(255,255,255,0.05); overflow:hidden; }
  .axyz-topic-fill { height:100%; border-radius:5px; background:linear-gradient(90deg, rgba(var(--hue-l),0.8), rgba(var(--hue-c),0.85)); box-shadow:0 0 10px rgba(var(--hue-c),0.3); transition:width 0.6s ease; }
  .axyz-topic-n { font-size:12px; font-weight:600; color:var(--dim); min-width:16px; text-align:right; }
  .axyz-words-k { font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:var(--faint); margin:16px 0 9px; }
  .axyz-words { display:flex; flex-wrap:wrap; gap:6px 9px; align-items:baseline; }
  .axyz-word { color:rgba(var(--hue-l),0.92); line-height:1.1; }

  /* emails */
  .axyz-maillist { display:flex; flex-direction:column; gap:2px; }
  .axyz-mail { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 11px; border-radius:9px; }
  .axyz-mail:hover { background:rgba(255,255,255,0.03); }
  .axyz-mail-addr { font-size:13px; color:rgba(255,255,255,0.9); font-family:ui-monospace,monospace; }
  .axyz-mail-ts { font-size:10.5px; color:var(--faint); flex:none; }

  .axyz-gen { text-align:center; font-size:10.5px; color:var(--faint); margin-top:18px; }
  `;
  const tag = document.createElement('style');
  tag.id = 'aukora-xyz-style';
  tag.textContent = css;
  document.getElementById('aukora-xyz-style')?.remove();
  document.head.append(tag);
}
