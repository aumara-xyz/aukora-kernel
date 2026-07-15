import { describe, expect, it } from 'vitest';
import {
  APP_CONTRACTS,
  APP_CONTRACT_SCHEMA,
  APP_REGISTRY_TABS,
  mergeAppContracts,
  mergeOrgans,
  mergeTabs,
  validateAppContract,
} from '../../spatial/app/app-registry.js';

function sampleContract(overrides = {}) {
  return {
    schema: APP_CONTRACT_SCHEMA,
    organKey: 'hello-lab',
    organ: {
      title: 'Hello Lab',
      sub: 'a tiny governed preview organ',
      entry: '/app/hello-lab.js',
    },
    menu: {
      tab: 'yours',
      label: 'Hello Lab',
      gist: 'grow a small app from the inside',
    },
    advisoryOnly: true,
    grantsAuthority: false,
    ...overrides,
  };
}

describe('app registry contract (Brick A, issue #142)', () => {
  it('exports the narrow v1 scope (yours tab only)', () => {
    expect(APP_REGISTRY_TABS).toEqual(['yours']);
  });

  it('ships no boot-time contracts: Yours is reserved for user-grown apps', () => {
    expect(APP_CONTRACTS).toEqual([]);
    for (const raw of APP_CONTRACTS) {
      const checked = validateAppContract(raw);
      expect(checked.ok).toBe(true);
      if (!checked.ok) continue;
      expect(checked.value.advisoryOnly).toBe(true);
      expect(checked.value.grantsAuthority).toBe(false);
      expect(checked.value.menu.tab).toBe('yours');
    }
  });

  it('accepts a clean advisory-only contract and trims human fields', () => {
    const checked = validateAppContract(sampleContract({
      organ: { title: ' Hello Lab ', sub: ' a tiny governed preview organ ', entry: '/app/hello-lab.js' },
      menu: { tab: 'yours', label: ' Hello Lab ', gist: ' grow a small app from the inside ' },
    }));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.organ.title).toBe('Hello Lab');
    expect(checked.value.menu.gist).toBe('grow a small app from the inside');
  });

  it('refuses contracts that widen authority or target the wrong tab', () => {
    expect(validateAppContract(sampleContract({ grantsAuthority: true })).ok).toBe(false);
    expect(validateAppContract(sampleContract({ advisoryOnly: false })).ok).toBe(false);
    expect(validateAppContract(sampleContract({ menu: { tab: 'organs', label: 'Hello Lab', gist: 'x' } })).ok).toBe(false);
  });

  it('merges a valid organ only when its mount resolves, and never overrides built-ins', () => {
    const builtins = {
      map: { title: 'Spatial Map', sub: 'builtin', mount: () => null },
      'hello-lab': { title: 'Existing', sub: 'builtin collision', mount: () => null },
    };
    const ok = sampleContract();
    const noMount = sampleContract({ organKey: 'ghost-lab', organ: { title: 'Ghost', sub: 'missing', entry: '/app/ghost.js' } });
    const merged = mergeOrgans(builtins, [ok, noMount], (entry: string) => (entry === '/app/hello-lab.js' ? () => null : null));
    expect(merged.organs.map.title).toBe('Spatial Map');
    expect(merged.organs['hello-lab'].title).toBe('Existing');
    expect(merged.accepted).toEqual([]);
    expect(merged.skipped).toEqual([
      { organKey: 'hello-lab', reason: 'organ_key_conflict' },
      { organKey: 'ghost-lab', reason: 'mount_unresolved' },
    ]);

    const builtins2 = { map: { title: 'Spatial Map', sub: 'builtin', mount: () => null } };
    const merged2 = mergeOrgans(builtins2, [ok], (entry: string) => (entry === '/app/hello-lab.js' ? () => null : null));
    expect(merged2.accepted).toEqual([{ organKey: 'hello-lab', entry: '/app/hello-lab.js' }]);
    expect(merged2.organs['hello-lab'].title).toBe('Hello Lab');
  });

  it('adds menu rows to the yours tab without mutating built-ins and skips duplicates', () => {
    const builtins = {
      organs: [{ organ: 'map', label: 'Map', gist: 'builtin' }],
      yours: [{ organ: 'hello-lab', label: 'Old Hello', gist: 'existing' }],
    };
    const ok = sampleContract();
    const fresh = sampleContract({
      organKey: 'studio-lab',
      organ: { title: 'Studio Lab', sub: 'another app', entry: '/app/studio-lab.js' },
      menu: { tab: 'yours', label: 'Studio Lab', gist: 'another governed app' },
    });
    const merged = mergeTabs(builtins, [ok, fresh]);
    expect(builtins.yours).toEqual([{ organ: 'hello-lab', label: 'Old Hello', gist: 'existing' }]);
    expect(merged.tabs.yours).toEqual([
      { organ: 'hello-lab', label: 'Old Hello', gist: 'existing' },
      { organ: 'studio-lab', label: 'Studio Lab', gist: 'another governed app' },
    ]);
    expect(merged.accepted).toEqual([{ organKey: 'studio-lab', tab: 'yours' }]);
    expect(merged.skipped).toEqual([{ organKey: 'hello-lab', reason: 'tab_row_conflict' }]);
  });

  it('returns one combined report so future shell wiring can merge both surfaces deterministically', () => {
    const contract = sampleContract();
    const merged = mergeAppContracts(
      { map: { title: 'Spatial Map', sub: 'builtin', mount: () => null } },
      { yours: [] },
      [contract],
      () => () => null
    );
    expect(merged.organs['hello-lab']).toMatchObject({ title: 'Hello Lab', sub: 'a tiny governed preview organ' });
    expect(merged.tabs.yours).toEqual([{ organ: 'hello-lab', label: 'Hello Lab', gist: 'grow a small app from the inside' }]);
    expect(merged.accepted.organs).toHaveLength(1);
    expect(merged.accepted.tabs).toHaveLength(1);
    expect(merged.skipped).toEqual([]);
  });
});
