// Aukora Spatial — OPERATE: Auma's hands on the UI (owner-directed 2026-07-08).
//
// Vendored from the page-agent pattern (Alibaba page-agent, MIT) — adapted, ZERO-EGRESS, no CDN, no
// npm at runtime, pure in-page JS. The model: read the DOM as an INDEXED TEXT LIST of interactive
// elements (never screenshots), and drive them with a tiny action vocabulary
// (click_element_by_index, input_text, select_dropdown_option, scroll, ask_user, done).
//
// THE FENCE — non-negotiable. This operates the ADVISORY shell surface ONLY:
//   - It runs in the shell's OWN document (:7090). The AUMLOK signing gate and the phrase ceremony
//     live in a SEPARATE-ORIGIN iframe (:7094). Same-origin policy means this module structurally
//     CANNOT read into that frame, see the phrase, or click "Sign & apply". It cannot cross the gate.
//   - <iframe> elements are never indexed (so it can't even try to target the gate frame), and any
//     element (or subtree) marked [data-operate-forbid] is skipped.
//   - Every action is receipted (advisory evidence, never authority). This tool DRIVES the app; the
//     one human gate — Peter's phrase — stays the only thing that makes a change real.
//
// It is exposed as window.aukoraOperate so the seat tool `operate_ui(goal)` (and tests) can call it.

const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea',
  '[role=button]', '[role=tab]', '[role=link]', '[role=menuitem]', '[role=option]',
  '[onclick]', '[data-operate]', '[contenteditable=true]',
].join(',');

let registry = []; // operate index -> element (rebuilt on every serialize)
const receipts = []; // advisory evidence: one entry per action

function isVisible(el) {
  if (!(el instanceof Element)) return false;
  if (el.closest('[hidden],[aria-hidden=true],.mobile-hidden,.collapsed')) return false;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}

// A short human label for an element — what a person would call it.
function labelOf(el) {
  const pick = (s) => (s && String(s).trim()) || '';
  let t = pick(el.getAttribute && el.getAttribute('aria-label'))
    || pick(el.getAttribute && el.getAttribute('placeholder'))
    || pick(el.value)
    || pick(el.getAttribute && el.getAttribute('title'))
    || pick(el.textContent);
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 80) t = t.slice(0, 80) + '…';
  if (!t) t = pick(el.id) || pick(el.className).split(' ')[0] || '(unlabeled)';
  return t;
}

/**
 * Serialize the interactive shell into an indexed text list the model reads. Rebuilds the registry.
 * FENCE: never indexes <iframe> (so the gate frame is untargetable) or [data-operate-forbid] subtrees.
 */
export function serialize(root) {
  registry = [];
  document.querySelectorAll('[data-operate-index]').forEach((n) => n.removeAttribute('data-operate-index'));
  const scope = root || document.body;
  // Candidate = matches a semantic interactive selector OR renders with cursor:pointer (the shell's
  // corner buttons and menu rows are <div>s with attached click handlers — cursor:pointer catches them,
  // exactly as the page-agent serializer does). Walk once in document order so indices are stable.
  const candidates = [];
  for (const el of scope.querySelectorAll('*')) {
    if (el.tagName === 'IFRAME') continue;              // fence: never the gate frame's element
    if (el.closest('iframe')) continue;                 // (belt) never anything inside a frame
    if (el.closest('[data-operate-forbid]')) continue;  // fence: explicit no-operate subtrees
    if (!isVisible(el)) continue;
    const clickable = el.matches(INTERACTIVE_SELECTOR) || getComputedStyle(el).cursor === 'pointer';
    if (clickable) candidates.push(el);
  }
  // Keep only the OUTERMOST clickable in a nest (a button wrapping a pointer-span → keep the button).
  const els = candidates.filter((el) => !candidates.some((o) => o !== el && o.contains(el)));
  const out = [];
  for (const el of els) {
    const i = registry.length;
    registry.push(el);
    el.setAttribute('data-operate-index', String(i));
    const tag = el.tagName.toLowerCase();
    const kind = el.type ? tag + '/' + el.type : tag;
    out.push(`[${i}] ${kind} "${labelOf(el)}"`);
  }
  return out.join('\n');
}

function receipt(type, ok, detail, extra) {
  const r = { type, ok, detail: String(detail).slice(0, 200), at: new Date().toISOString(), advisoryOnly: true, grantsAuthority: false, ...extra };
  receipts.push(r);
  if (receipts.length > 200) receipts.shift();
  return r;
}

function elAt(index) {
  const el = registry[index];
  if (!el || !el.isConnected) return null;
  return el;
}

/**
 * Execute ONE action from the tiny vocabulary. Returns a receipt (advisory). Never signs, never
 * applies, never touches the gate — it can only drive shell DOM controls it can already see.
 * action ∈ { type:'click', index } | { type:'input', index, text } | { type:'select', index, option }
 *        | { type:'scroll', direction, index? } | { type:'done', text } | { type:'ask', question }
 */
export function act(action) {
  try {
    switch (action && action.type) {
      case 'click': {
        const el = elAt(action.index);
        if (!el) return receipt('click', false, `no element at index ${action.index} — re-serialize`);
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        return receipt('click', true, `clicked [${action.index}] "${labelOf(el)}"`, { index: action.index });
      }
      case 'input': {
        const el = elAt(action.index);
        if (!el) return receipt('input', false, `no element at index ${action.index} — re-serialize`);
        const val = String(action.text ?? '');
        if (el.isContentEditable) { el.textContent = val; }
        else { el.value = val; }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return receipt('input', true, `typed into [${action.index}] "${labelOf(el)}"`, { index: action.index });
      }
      case 'select': {
        const el = elAt(action.index);
        if (!el || el.tagName !== 'SELECT') return receipt('select', false, `index ${action.index} is not a <select>`);
        const opt = [...el.options].find((o) => o.value === action.option || o.textContent.trim() === action.option);
        if (!opt) return receipt('select', false, `no option "${action.option}"`);
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return receipt('select', true, `selected "${opt.textContent.trim()}"`, { index: action.index });
      }
      case 'scroll': {
        const by = (action.direction === 'up' ? -1 : 1) * Math.round(window.innerHeight * 0.8);
        const target = Number.isInteger(action.index) ? elAt(action.index) : window;
        if (target === window) window.scrollBy({ top: by, behavior: 'smooth' });
        else if (target) target.scrollBy({ top: by, behavior: 'smooth' });
        return receipt('scroll', true, `scrolled ${action.direction || 'down'}`);
      }
      case 'done':
        return receipt('done', true, action.text || 'done');
      case 'ask':
        return receipt('ask', true, action.question || 'needs owner input', { question: action.question });
      default:
        return receipt('unknown', false, `unknown action: ${action && action.type}`);
    }
  } catch (e) {
    return receipt(action && action.type, false, `errored: ${e && e.message || e}`);
  }
}

/** The advisory receipt trail of everything operate has done this session (read-only). */
export function getReceipts() { return receipts.slice(); }

// Self-install the advisory driving API. Not authority — it drives the shell; it never signs.
export function installOperate() {
  window.aukoraOperate = {
    serialize, act, getReceipts,
    // the page-agent-style vocabulary, thin wrappers so a tool loop reads naturally
    click: (index) => act({ type: 'click', index }),
    input: (index, text) => act({ type: 'input', index, text }),
    select: (index, option) => act({ type: 'select', index, option }),
    scroll: (direction, index) => act({ type: 'scroll', direction, index }),
    ask: (question) => act({ type: 'ask', question }),
    done: (text) => act({ type: 'done', text }),
    fence: 'advisory shell surface only — the AUMLOK gate is a separate-origin iframe this cannot reach',
  };
  return window.aukoraOperate;
}

installOperate();
