import { APP_CONTRACTS, mergeAppContracts } from './app-registry.js';

function renderLoadError(root, entry, error) {
  if (!root || typeof root.replaceChildren !== 'function' || typeof document === 'undefined') return;
  const wrap = document.createElement('div');
  wrap.className = 'organ organ-contract-error';
  const title = document.createElement('h2');
  title.textContent = 'App failed to load';
  const pathLine = document.createElement('p');
  pathLine.textContent = entry;
  const detail = document.createElement('p');
  detail.textContent = String(error && error.message ? error.message : error || 'unknown load error');
  wrap.append(title, pathLine, detail);
  root.replaceChildren(wrap);
}

export function pickContractMount(mod) {
  if (mod && typeof mod.mountApp === 'function') return mod.mountApp;
  if (mod && typeof mod.default === 'function') return mod.default;
  if (!mod || typeof mod !== 'object') return null;
  for (const [key, value] of Object.entries(mod)) {
    if (/^mount[A-Z0-9_]/.test(key) && typeof value === 'function') return value;
  }
  return null;
}

export function makeContractMountResolver(importer = (entry) => import(entry)) {
  return function resolveContractMount(entry, _organKey, _contract) {
    return async function mountContract(root) {
      try {
        const mod = await importer(entry);
        const mount = pickContractMount(mod);
        if (typeof mount !== 'function') throw new Error('no mount function exported');
        return mount(root);
      } catch (error) {
        renderLoadError(root, entry, error);
        return null;
      }
    };
  };
}

export function materializeShellModel(
  builtinsOrgans,
  builtinsTabs,
  contracts = APP_CONTRACTS,
  resolveMount = makeContractMountResolver()
) {
  return mergeAppContracts(builtinsOrgans, builtinsTabs, contracts, resolveMount);
}
