// Aukora app-contract registry — Brick A for issue #142.
//
// This module is intentionally inert: it defines the shape a user-grown app
// must satisfy before the shell is allowed to surface it, and pure merge
// helpers that can fold those contracts into the shell's built-in ORGANS/TABS
// without mutating them. The shell does not import this file yet; that wiring
// belongs to the next brick.

export const APP_CONTRACT_SCHEMA = 'aukora-app-contract-v1';
export const APP_REGISTRY_TABS = ['yours'];

// User-grown contracts live here. Shipped product apps belong to the shell's
// built-in Apps catalog; keeping this empty at boot means Yours is reserved for
// work a person grows through + New App.
export const APP_CONTRACTS = Object.freeze([]);

const ORGAN_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENTRY_RE = /^\/app\/[a-z0-9/_-]+\.js$/;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function nonEmptyString(v, max = 200) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function cloneTabs(tabs) {
  const out = {};
  for (const [tab, rows] of Object.entries(tabs ?? {})) out[tab] = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  return out;
}

export function validateAppContract(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'contract_invalid' };
  if (raw.schema !== APP_CONTRACT_SCHEMA) return { ok: false, reason: 'schema_invalid' };
  if (raw.advisoryOnly !== true) return { ok: false, reason: 'advisory_only_required' };
  if (raw.grantsAuthority !== false) return { ok: false, reason: 'grants_authority_must_be_false' };

  const organKey = raw.organKey;
  if (typeof organKey !== 'string' || !ORGAN_KEY_RE.test(organKey)) return { ok: false, reason: 'organ_key_invalid' };

  const organ = raw.organ;
  if (!organ || typeof organ !== 'object' || Array.isArray(organ)) return { ok: false, reason: 'organ_invalid' };
  if (!nonEmptyString(organ.title, 120)) return { ok: false, reason: 'organ_title_invalid' };
  if (!nonEmptyString(organ.sub, 180)) return { ok: false, reason: 'organ_sub_invalid' };
  if (typeof organ.entry !== 'string' || !ENTRY_RE.test(organ.entry)) return { ok: false, reason: 'organ_entry_invalid' };

  const menu = raw.menu;
  if (!menu || typeof menu !== 'object' || Array.isArray(menu)) return { ok: false, reason: 'menu_invalid' };
  if (menu.tab !== 'yours') return { ok: false, reason: 'menu_tab_invalid' };
  if (!nonEmptyString(menu.label, 80)) return { ok: false, reason: 'menu_label_invalid' };
  if (!nonEmptyString(menu.gist, 160)) return { ok: false, reason: 'menu_gist_invalid' };

  return {
    ok: true,
    value: {
      schema: APP_CONTRACT_SCHEMA,
      organKey,
      organ: {
        title: organ.title.trim(),
        sub: organ.sub.trim(),
        entry: organ.entry,
      },
      menu: {
        tab: 'yours',
        label: menu.label.trim(),
        gist: menu.gist.trim(),
      },
      advisoryOnly: true,
      grantsAuthority: false,
    },
  };
}

export function mergeOrgans(builtins, contracts, resolveMount) {
  const organs = { ...(builtins ?? {}) };
  const accepted = [];
  const skipped = [];
  for (const raw of contracts ?? []) {
    const checked = validateAppContract(raw);
    if (!checked.ok) {
      skipped.push({ organKey: raw && typeof raw === 'object' ? raw.organKey ?? null : null, reason: checked.reason });
      continue;
    }
    const c = checked.value;
    if (hasOwn(organs, c.organKey)) {
      skipped.push({ organKey: c.organKey, reason: 'organ_key_conflict' });
      continue;
    }
    const mount = resolveMount ? resolveMount(c.organ.entry, c.organKey, c) : null;
    if (typeof mount !== 'function') {
      skipped.push({ organKey: c.organKey, reason: 'mount_unresolved' });
      continue;
    }
    organs[c.organKey] = { title: c.organ.title, sub: c.organ.sub, mount };
    accepted.push({ organKey: c.organKey, entry: c.organ.entry });
  }
  return { organs, accepted, skipped };
}

export function mergeTabs(builtins, contracts) {
  const tabs = cloneTabs(builtins);
  if (!hasOwn(tabs, 'yours')) tabs.yours = [];
  const accepted = [];
  const skipped = [];
  const seen = new Set(
    Object.values(tabs)
      .flatMap((rows) => rows)
      .map((row) => (row && typeof row === 'object' && typeof row.organ === 'string' ? row.organ : null))
      .filter(Boolean)
  );

  for (const raw of contracts ?? []) {
    const checked = validateAppContract(raw);
    if (!checked.ok) {
      skipped.push({ organKey: raw && typeof raw === 'object' ? raw.organKey ?? null : null, reason: checked.reason });
      continue;
    }
    const c = checked.value;
    if (seen.has(c.organKey)) {
      skipped.push({ organKey: c.organKey, reason: 'tab_row_conflict' });
      continue;
    }
    tabs.yours.push({ organ: c.organKey, label: c.menu.label, gist: c.menu.gist });
    seen.add(c.organKey);
    accepted.push({ organKey: c.organKey, tab: 'yours' });
  }

  return { tabs, accepted, skipped };
}

export function mergeAppContracts(builtinsOrgans, builtinsTabs, contracts, resolveMount) {
  const organs = mergeOrgans(builtinsOrgans, contracts, resolveMount);
  const tabs = mergeTabs(builtinsTabs, contracts);
  return {
    organs: organs.organs,
    tabs: tabs.tabs,
    accepted: {
      organs: organs.accepted,
      tabs: tabs.accepted,
    },
    skipped: [...organs.skipped, ...tabs.skipped],
  };
}
