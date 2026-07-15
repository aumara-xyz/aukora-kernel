// Aukora Spatial — DOM organs: read-only views over engine state.
// Every panel here renders what already exists on disk; nothing mutates.

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function panel(root, title, caption) {
  const p = el('div', 'organ-panel');
  p.append(el('div', 'panel-title', title), el('div', 'panel-caption', caption));
  root.append(p);
  return p;
}

function kvCard(title, pairs) {
  const card = el('div', 'glass-card');
  card.append(el('h3', null, title));
  for (const [k, v] of pairs) {
    const row = el('div', 'kv');
    row.append(el('span', 'k', k));
    const val = el('span', 'v');
    if (v instanceof Node) val.append(v);
    else val.textContent = String(v);
    row.append(val);
    card.append(row);
  }
  return card;
}

function pill(text, tone = '') {
  return el('span', `pill ${tone}`, text);
}

// ---------------------------------------------------------------------------
// Richer organ chrome — a spacious header + animated accordion bars, matching
// the Auma app's "bars across" language. Used by Council + Status.
// ---------------------------------------------------------------------------

function head2(root, title, caption) {
  injectOrganStyle();
  const app = el('div', 'org2-app');
  const h = el('div', 'org2-head');
  h.append(el('div', 'org2-title', title));
  if (caption) h.append(el('div', 'org2-cap', caption));
  app.append(h);
  const scroll = el('div', 'org2-scroll');
  app.append(scroll);
  root.append(app);
  return scroll;
}

function accBar(host, { hue = 'c', title, sub, meta, open = false, build }) {
  const acc = el('div', 'org2-acc hue-' + hue + (open ? ' open' : ''));
  const bar = el('div', 'org2-bar');
  const left = el('div', 'org2-bar-l');
  left.append(el('div', 'org2-bar-title', title));
  if (sub) left.append(el('div', 'org2-bar-sub', sub));
  bar.append(left);
  if (meta instanceof Node) { meta.classList.add('org2-bar-meta'); bar.append(meta); }
  else if (meta != null) bar.append(el('div', 'org2-bar-meta', String(meta)));
  bar.append(el('div', 'org2-chev', '›'));
  acc.append(bar);
  const wrap = el('div', 'org2-body-wrap');
  const body = el('div', 'org2-body');
  wrap.append(body);
  acc.append(wrap);
  let built = false;
  const doBuild = () => { if (!built && build) { build(body); built = true; } };
  if (open) doBuild();
  bar.addEventListener('click', () => { acc.classList.toggle('open'); if (acc.classList.contains('open')) doBuild(); });
  host.append(acc);
  return acc;
}

const shorten = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const prettyQuorum = (s) => String(s ?? '').toLowerCase().replace(/_/g, ' ');
const quorumTone = (s) => (/GREEN/.test(s) ? 'pill-green' : /RED/.test(s) ? 'pill-red' : /YELLOW/.test(s) ? 'pill-yellow' : 'pill-faint');
const quorumHue = (s) => (/GREEN/.test(s) ? 'l' : /RED/.test(s) ? 'r' : 'c');

let organStyled = false;
function injectOrganStyle() {
  if (organStyled) return; organStyled = true;
  const css = `
  .pill-yellow { border-color:rgba(240,210,120,0.35); color:rgba(240,210,120,0.92); }
  .org2-app { position:absolute; inset:0; display:flex; flex-direction:column; overflow:hidden; }
  .org2-head { flex:none; padding:18px 20px 14px; border-bottom:1px solid rgba(255,255,255,0.06);
    background:linear-gradient(100deg, rgba(var(--hue-l),0.06), rgba(var(--hue-r),0.05) 60%, transparent); }
  .org2-title { font-size:18px; font-weight:700; letter-spacing:0.01em; color:#fff; }
  .org2-cap { font-size:12.5px; line-height:1.5; color:var(--dim); margin-top:4px; max-width:560px; }
  .org2-scroll { flex:1; overflow-y:auto; padding:16px max(16px, calc((100% - 720px)/2)) 50px;
    scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.12) transparent; }
  .org2-explain { margin-bottom:16px; }
  .org2-explain p { margin:0 0 9px; font-size:13px; line-height:1.6; color:rgba(255,255,255,0.82); }
  .org2-section-label { font-size:10.5px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase;
    color:var(--faint); margin:14px 2px 8px; }
  .org2-empty { padding:24px 8px; text-align:center; color:var(--dim); font-size:13px; }

  .org2-acc { margin:0 0 8px; --ac:var(--hue-c); }
  .org2-acc.hue-l { --ac:var(--hue-l); } .org2-acc.hue-c { --ac:var(--hue-c); } .org2-acc.hue-r { --ac:var(--hue-r); }
  .org2-bar { display:flex; align-items:center; gap:12px; padding:12px 14px; cursor:pointer; border-radius:12px;
    border:1px solid rgba(var(--ac),0.22);
    background:linear-gradient(100deg, rgba(var(--ac),0.14), rgba(var(--ac),0.03) 70%, transparent);
    transition:border-color 0.16s ease; }
  .org2-bar:hover { border-color:rgba(var(--ac),0.45); }
  .org2-acc.open .org2-bar { border-radius:12px 12px 0 0; border-bottom-color:transparent; }
  .org2-bar-l { flex:1; min-width:0; }
  .org2-bar-title { font-size:13.5px; font-weight:600; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .org2-bar-sub { font-size:11px; color:var(--dim); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .org2-bar-meta { flex:none; }
  .org2-chev { flex:none; color:rgba(var(--ac),0.85); font-size:16px; transition:transform 0.26s ease; }
  .org2-acc.open .org2-chev { transform:rotate(90deg); }
  .org2-body-wrap { display:grid; grid-template-rows:0fr; transition:grid-template-rows 0.28s ease;
    border:1px solid rgba(var(--ac),0.16); border-top:none; border-radius:0 0 12px 12px; }
  .org2-acc:not(.open) .org2-body-wrap { border-color:transparent; }
  .org2-acc.open .org2-body-wrap { grid-template-rows:1fr; }
  .org2-body { overflow:hidden; }
  .org2-acc.open .org2-body { padding:13px 15px 15px; }

  .org2-votes { display:flex; gap:8px; flex-wrap:wrap; }
  .org2-vote { flex:1; min-width:60px; text-align:center; padding:9px 4px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); }
  .org2-vote b { display:block; font-size:19px; color:#fff; }
  .org2-vote span { font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--dim); }
  .org2-vote.g { border-color:rgba(var(--hue-l),0.4); background:rgba(var(--hue-l),0.08); }
  .org2-vote.y { border-color:rgba(240,210,120,0.4); background:rgba(240,210,120,0.08); }
  .org2-vote.r { border-color:rgba(255,140,140,0.4); background:rgba(255,140,140,0.08); }
  .org2-vote.n { border-color:rgba(255,255,255,0.12); }
  .org2-reason { margin-top:10px; font-size:12px; color:var(--dim); font-style:italic; }
  .org2-sub-label { font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--faint); margin:14px 0 7px; }
  .org2-chips { display:flex; flex-wrap:wrap; gap:6px; }
  .org2-chip { font-size:11px; font-family:ui-monospace,monospace; padding:4px 9px; border-radius:7px;
    color:rgba(var(--hue-c),0.95); border:1px solid rgba(var(--hue-c),0.2); background:rgba(var(--hue-c),0.05); }
  .org2-gov { display:flex; flex-direction:column; gap:4px; }
  .org2-gov-line { font-size:11.5px; font-family:ui-monospace,monospace; line-height:1.5; color:rgba(255,255,255,0.72);
    padding:6px 9px; border-radius:7px; background:rgba(255,255,255,0.03); word-break:break-word; }

  .org2-state { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 16px; border-radius:14px; margin-bottom:6px;
    border:1px solid rgba(var(--hue-l),0.3); background:radial-gradient(120% 160% at 0% 0%, rgba(var(--hue-l),0.14), transparent 70%); }
  .org2-state.bad { border-color:rgba(255,150,150,0.4); background:radial-gradient(120% 160% at 0% 0%, rgba(255,150,150,0.12), transparent 70%); }
  .org2-state-k { font-size:10px; letter-spacing:0.16em; color:var(--faint); }
  .org2-state-v { font-size:17px; font-weight:700; color:#fff; letter-spacing:0.02em; }
  .org2-state-note { flex-basis:100%; font-size:12px; color:var(--dim); line-height:1.5; }
  .org2-summary { margin:8px 0 14px; padding:11px 14px; border-radius:11px; font-size:12.5px; line-height:1.55;
    color:rgba(255,255,255,0.8); border:1px solid rgba(var(--hue-r),0.2); background:rgba(var(--hue-r),0.04); }
  .org2-check-mark { flex:none; width:24px; height:24px; display:grid; place-items:center; border-radius:7px; font-size:13px; }
  .org2-check-mark.ok { color:rgba(var(--hue-l),1); background:rgba(var(--hue-l),0.12); border:1px solid rgba(var(--hue-l),0.3); }
  .org2-check-mark.note { color:rgba(240,210,120,0.95); background:rgba(240,210,120,0.1); border:1px solid rgba(240,210,120,0.3); }
  .org2-check-val { font-size:12.5px; color:rgba(255,255,255,0.8); line-height:1.5; margin-bottom:8px; }
  .org2-check-explain { margin:0; font-size:12.5px; line-height:1.55; color:var(--dim); }
  .org2-raw { margin:0; font-size:11px; font-family:ui-monospace,monospace; line-height:1.5; color:var(--dim);
    white-space:pre-wrap; word-break:break-word; }
  .org2-generated { margin-top:14px; font-size:10.5px; letter-spacing:0.06em; color:var(--faint); text-align:center; }
  `;
  const tag = document.createElement('style');
  tag.id = 'org2-style';
  tag.textContent = css;
  document.head.append(tag);
}

// ---------------------------------------------------------------------------

export async function mountCouncil(root) {
  const scroll = head2(root, 'Fusion Council', 'Independent frontier models read the same work and vote. Their quorum is a weather report on it — a signal, never a signature.');
  try {
    const { runs } = await getJSON('/api/council');

    const ex = el('div', 'org2-explain');
    ex.append(el('p', null, 'A council run hands one target to several frontier models at once. Each reviews it alone and casts a verdict — green, yellow, or red — then the votes fuse into a quorum. It tells you how the work looks to many minds who never saw each other’s answers.'));
    ex.append(el('p', null, 'The council only advises. It cannot apply, sign, or unlock anything — that authority lives with your Aumlok key alone. Even a unanimous green is just a strong signal, never a decision.'));
    scroll.append(ex);

    if (!runs || !runs.length) {
      scroll.append(el('div', 'org2-empty', 'No council runs on disk yet.'));
      return;
    }
    scroll.append(el('div', 'org2-section-label', `${runs.length} recent run${runs.length === 1 ? '' : 's'} — click one to see what they came together on`));
    runs.forEach((r, i) => {
      const status = r.quorum || 'UNKNOWN';
      const when = (r.createdAt || '').slice(0, 16).replace('T', ' · ');
      accBar(scroll, {
        hue: quorumHue(status),
        title: shorten(r.target || r.runId || r.file, 56),
        sub: when,
        meta: pill(prettyQuorum(status), quorumTone(status)),
        open: i === 0,
        build: (body) => buildCouncilRun(body, r),
      });
    });
  } catch (e) {
    scroll.append(el('div', 'org2-empty', 'Council unreachable: ' + String(e.message ?? e)));
  }
}

function buildCouncilRun(body, r) {
  const q = r.quorumDetail || {};
  const votes = el('div', 'org2-votes');
  const vote = (n, cls, lab) => { const c = el('div', 'org2-vote ' + cls); c.append(el('b', null, String(n ?? 0)), el('span', null, lab)); return c; };
  votes.append(vote(q.greenVotes, 'g', 'green'), vote(q.yellowVotes, 'y', 'yellow'), vote(q.redVotes, 'r', 'red'), vote(q.nonVotes, 'n', 'non-votes'));
  body.append(votes);
  if (q.reason) body.append(el('div', 'org2-reason', q.reason));
  if (Array.isArray(r.models) && r.models.length) {
    body.append(el('div', 'org2-sub-label', `the council · ${r.models.length} models`));
    const chips = el('div', 'org2-chips');
    r.models.forEach((m) => chips.append(el('span', 'org2-chip', shorten(m, 30))));
    body.append(chips);
  }
  if (Array.isArray(r.governanceLines) && r.governanceLines.length) {
    body.append(el('div', 'org2-sub-label', 'what the run recorded'));
    const gl = el('div', 'org2-gov');
    r.governanceLines.forEach((line) => gl.append(el('div', 'org2-gov-line', line)));
    body.append(gl);
  }
}

export async function mountKira(root) {
  const p = panel(root, 'Kira Memory', 'Hash-chained recall receipts. Advisory only — memory informs, it never authorizes.');
  try {
    const k = await getJSON('/api/kira');
    if (!k.present) {
      p.append(kvCard('Brain', [['State', k.note ?? 'absent']]));
      return;
    }
    p.append(kvCard('Brain', [
      ['Schema', k.schema],
      ['Updated', k.updatedAt],
      ['Atoms', k.atomCount],
      ['Receipts', k.receiptCount],
      ['Chain linkage', k.chainLinked ? pill('linked', 'pill-green') : pill('broken', 'pill-red')],
    ]));
    const kindsCard = el('div', 'glass-card');
    kindsCard.append(el('h3', null, 'Atom kinds'));
    for (const [kind, n] of Object.entries(k.kinds ?? {})) {
      const row = el('div', 'kv');
      row.append(el('span', 'k', kind), el('span', 'v', String(n)));
      kindsCard.append(row);
    }
    p.append(kindsCard);
    if (Array.isArray(k.topTags) && k.topTags.length) {
      const card = el('div', 'glass-card');
      card.append(el('h3', null, 'Top tags'));
      const wrap = el('div');
      wrap.style.display = 'flex';
      wrap.style.flexWrap = 'wrap';
      wrap.style.gap = '6px';
      for (const [tag, n] of k.topTags) wrap.append(pill(`${tag} · ${n}`, 'pill-green'));
      card.append(wrap);
      p.append(card);
    }
  } catch (e) {
    p.append(kvCard('Kira', [['Error', String(e.message ?? e)]]));
  }
}

// A copyable, exactly-rendered terminal command. Uses textContent only (never innerHTML), so any
// server-provided path/hash is DOM-escaped — the command is shown verbatim, never interpreted.
function cmdBlock(label, command) {
  const wrap = el('div', 'aumlok-cmd');
  if (label) wrap.append(el('div', 'aumlok-cmd-label', label));
  wrap.append(el('pre', 'aumlok-cmd-pre', command)); // textContent = exact + escaped
  return wrap;
}

export async function mountAumlok(root) {
  const p = panel(root, 'Aumlok Gate', 'Signing assistant — it explains your AUMLOK status and shows the EXACT terminal command to run. It can only watch: nothing here can sign, apply, unlock, or read your key.');
  try {
    // The signing-assistant view (issues #81/#91). `status` = the AUMLOK snapshot; `snapshot` alias kept for compat.
    const v = await getJSON('/api/aumlok');
    const s = v.status ?? v.snapshot;

    p.append(kvCard('Cryptographic root', [
      ['Key present', s.keyPresent ? pill('yes', 'pill-green') : pill('no key yet', 'pill-faint')],
      ['Public root pinned', s.publicRootPinned ? pill('yes', 'pill-green') : pill('no', 'pill-faint')],
      ['Key id', s.keyId ?? '—'],
      ['Live promotion', s.livePromotionUnlocked ? 'UNLOCKED (impossible)' : pill('locked', 'pill-purple')],
      ['Signed apply lane', s.signedLiveApplyLaneBuilt ? 'built' : 'no'],
      ['Rehearsal receipts', s.rehearsalReceiptCount],
      ['Applied proposals', s.appliedProposalCount],
      ['Signer/verifier split', s.signerVerifierSplitIntact ? pill('intact', 'pill-green') : pill('BROKEN', 'pill-red')],
    ]));

    // Step 0: if there is no key yet, the owner must generate one first (a one-time terminal ceremony).
    if (v.keygenNeeded && v.commands?.keygen) {
      const card = el('div', 'glass-card');
      card.append(el('h3', null, 'No AUMLOK key yet — start here'));
      card.append(el('div', 'faint', 'Before any proposal can be signed, generate your Ed25519 key. This is a one-time step you run in your OWN terminal — the app never does it and never sees the key.'));
      card.append(cmdBlock('run in your terminal:', v.commands.keygen));
      p.append(card);
    }

    // Pending proposals with #91 file-shrink safety + the exact sign command for each.
    const pending = v.pending ?? [];
    const card = el('div', 'glass-card');
    card.append(el('h3', null, `Pending proposals (${pending.length}) — awaiting owner signature`));
    if (!pending.length) card.append(el('div', 'faint', 'queue is empty'));
    for (const pr of pending) {
      const box = el('div', 'aumlok-proposal');
      const head = el('div', 'aumlok-proposal-head');
      const goal = el('span', 'k');
      goal.textContent = pr.goal.length > 72 ? pr.goal.slice(0, 72) + '…' : pr.goal;
      goal.title = pr.goal;
      head.append(goal);
      if (!pr.valid) head.append(pill('INVALID', 'pill-red'));
      if (pr.anyShrinkWarning) head.append(pill('⚠ FILE-SHRINK (#91)', 'pill-red'));
      box.append(head);
      box.append(el('div', 'faint', `${pr.proposalHash.slice(0, 16)}…  ·  ${pr.createdAt || 'no date'}  ·  advisoryOnly:true · grantsAuthority:false`));

      for (const f of (pr.files ?? [])) {
        const before = f.beforeLines == null ? 'new' : `${f.beforeLines}`;
        const delta = f.netLineDelta == null ? '' : ` (${f.netLineDelta >= 0 ? '+' : ''}${f.netLineDelta} lines)`;
        const line = el('div', f.shrinkWarning ? 'aumlok-file shrink' : 'aumlok-file');
        line.textContent = `${f.relPath} — ${before} → ${f.afterLines} lines${delta}${f.shrinkWarning ? '   ⚠ possible truncation' : ''}`;
        box.append(line);
      }
      box.append(el('div', 'faint', pr.riskHint));

      if (pr.anyShrinkWarning) {
        box.append(el('div', 'aumlok-warn', '⚠ Do NOT sign — this replaces an existing file with much smaller content and may be truncating it (#91). Review the diff before signing.'));
      } else if (pr.valid && !v.keygenNeeded) {
        box.append(cmdBlock('1) sign it in your terminal:', pr.signCommand));
        box.append(cmdBlock('2) then, back in the workbench:', pr.applyHint));
      } else if (pr.valid && v.keygenNeeded) {
        box.append(el('div', 'faint', 'Generate your key (above) first, then a sign command will appear here.'));
      }
      card.append(box);
    }
    p.append(card);

    // Standing warnings — the boundaries, verbatim from the assistant.
    if (Array.isArray(v.warnings) && v.warnings.length) {
      const wc = el('div', 'glass-card');
      wc.append(el('h3', null, 'Before you sign'));
      for (const w of v.warnings) wc.append(el('div', 'aumlok-warn-line', w));
      p.append(wc);
    }

    p.append(el('div', 'faint', 'Advisory surface: the map proposes, the sandbox rehearses, only the human key — in your own terminal — applies.'));
  } catch (e) {
    p.append(kvCard('Aumlok', [['Error', String(e.message ?? e)]]));
  }
}

const CHECK_EXPLAIN = [
  ['gate source', 'The governance gate definition exists on disk — the rules the engine pins itself to.'],
  ['gate integrity', 'Seven governance files are byte-for-byte pinned. Any drift trips the gate and halts changes — this is the seed’s tamper check on itself.'],
  ['AUMLOK', 'The sole write authority is locked. No tool, agent, or council can apply a change without your signature. This is the lock everything else defers to.'],
  ['Convex write', 'There is structurally no write lane anywhere in the seed — reads only, enforced by an invariant test. Nothing can quietly persist state.'],
  ['Kira', 'Her memory brain is present as a local, read-only loopback. Memory informs the loop; it never authorizes a change.'],
  ['deferred-test debt', 'Host-coupled tests deferred behind the behavior gate (scripts/test.sh). Counted and shown on purpose — debt you can see, not debt that hides.'],
  ['sandbox heartbeat', 'The sandbox can rehearse a change end to end — but nothing it does is applied live (appliedLive=false). Rehearsal is not promotion.'],
  ['live promotion', 'Promoting sandbox-green work to real, live authority is not built and is locked. Sandbox-green ≠ promotion-ready — the gap is deliberate.'],
];
const explainCheck = (label) => {
  const l = String(label).toLowerCase();
  const hit = CHECK_EXPLAIN.find(([k]) => l.includes(k.toLowerCase()));
  return hit ? hit[1] : 'A self-check the engine reports before it will run.';
};

function parseStatusItems(text) {
  const items = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    const m = line.match(/^([✓•])\s+(.+)$/);
    if (!m) continue;
    const ok = m[1] === '✓';
    const rest = m[2];
    const ci = rest.indexOf(':');
    const label = ci >= 0 ? rest.slice(0, ci).trim() : rest;
    const value = ci >= 0 ? rest.slice(ci + 1).trim() : '';
    items.push({ ok, label, value });
  }
  return items;
}

export async function mountStatus(root) {
  const scroll = head2(root, 'Engine Status', 'What the seed checks about itself before it will run. Read-only — this watches the engine, it never changes it.');
  try {
    const s = await getJSON('/api/status');

    const banner = el('div', 'org2-state ' + (s.ready ? 'ok' : 'bad'));
    banner.append(el('div', 'org2-state-k', 'STATE'), el('div', 'org2-state-v', s.state));
    const noteMatch = s.text.match(/STATE:\s*\S+\s*\(([^)]+)\)/);
    if (noteMatch) banner.append(el('div', 'org2-state-note', noteMatch[1].trim()));
    scroll.append(banner);

    const summaryMatch = s.text.match(/NOT promotion-ready[^\n]*/i);
    if (summaryMatch) scroll.append(el('div', 'org2-summary', summaryMatch[0].trim()));

    const items = parseStatusItems(s.text);
    scroll.append(el('div', 'org2-section-label', 'checks — click any to see what it means'));
    items.forEach((it) => {
      accBar(scroll, {
        hue: it.ok ? 'l' : 'c',
        title: it.label,
        sub: shorten(it.value, 58),
        meta: el('div', 'org2-check-mark ' + (it.ok ? 'ok' : 'note'), it.ok ? '✓' : '•'),
        open: false,
        build: (body) => {
          if (it.value && it.value.length > 58) body.append(el('div', 'org2-check-val', it.value));
          body.append(el('p', 'org2-check-explain', explainCheck(it.label)));
        },
      });
    });

    accBar(scroll, { hue: 'r', title: 'Raw output', sub: 'scripts/status.sh', open: false, build: (body) => body.append(el('pre', 'org2-raw', s.text.trim())) });
    scroll.append(el('div', 'org2-generated', 'checked ' + String(s.generatedAt || '').slice(0, 19).replace('T', ' ')));
  } catch (e) {
    scroll.append(el('div', 'org2-empty', 'Status unreachable: ' + String(e.message ?? e)));
  }
}

// Small always-on engine pill in the map organ's chip.
export async function loadEngineStatusCard() {
  const pillEl = document.getElementById('engine-pill');
  if (!pillEl) return;
  try {
    const s = await getJSON('/api/status');
    pillEl.textContent = s.state;
    pillEl.className = 'pill ' + (s.ready ? 'pill-green' : 'pill-red');
    const lock = s.text.match(/AUMLOK[^\n]*/i);
    if (lock) pillEl.title = lock[0].trim();
  } catch {
    pillEl.textContent = 'engine unreachable';
    pillEl.className = 'pill pill-faint';
  }
}
