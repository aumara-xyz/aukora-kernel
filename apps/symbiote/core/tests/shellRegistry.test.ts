import { describe, expect, it } from 'vitest';
import { materializeShellModel, pickContractMount } from '../../spatial/app/shell-registry.js';
import { APP_CONTRACT_SCHEMA } from '../../spatial/app/app-registry.js';
import type { AppContract } from '../../spatial/app/app-registry.js';

function contract(overrides = {}): AppContract {
  return {
    schema: APP_CONTRACT_SCHEMA,
    organKey: 'hello-lab',
    organ: {
      title: 'Hello Lab',
      sub: 'governed app',
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

describe('shell registry wiring (Brick B, issue #142)', () => {
  it('prefers mountApp, then default, then first named mount export', () => {
    const byName = () => null;
    expect(pickContractMount({ mountApp: () => 1, default: () => 2 })).toBeTypeOf('function');
    expect(pickContractMount({ default: () => 2 })?.()).toBe(2);
    expect(pickContractMount({ mountHello: byName })).toBe(byName);
    expect(pickContractMount({ nope: () => 3 })).toBe(null);
  });

  it('with no contracts, materialization leaves built-ins untouched', () => {
    const builtinsOrgans = { map: { title: 'Spatial Map', sub: 'builtin', mount: () => null } };
    const builtinsTabs = { yours: [{ organ: 'map', label: 'Map', gist: 'builtin' }] };
    const merged = materializeShellModel(builtinsOrgans, builtinsTabs, [], () => () => null);
    expect(merged.organs.map.title).toBe('Spatial Map');
    expect(merged.tabs.yours).toEqual([{ organ: 'map', label: 'Map', gist: 'builtin' }]);
    expect(merged.accepted.organs).toEqual([]);
    expect(merged.accepted.tabs).toEqual([]);
  });

  it('adds a valid contract as one new organ and one new menu row', () => {
    const builtinsOrgans = { map: { title: 'Spatial Map', sub: 'builtin', mount: () => null } };
    const builtinsTabs = { yours: [] };
    const mount = () => null;
    const merged = materializeShellModel(
      builtinsOrgans,
      builtinsTabs,
      [contract()],
      (entry: string) => (entry === '/app/hello-lab.js' ? mount : null)
    );
    expect(merged.organs['hello-lab']).toMatchObject({ title: 'Hello Lab', sub: 'governed app' });
    expect(merged.organs['hello-lab'].mount).toBe(mount);
    expect(merged.tabs.yours).toEqual([{ organ: 'hello-lab', label: 'Hello Lab', gist: 'grow a small app from the inside' }]);
    expect(merged.accepted.organs).toEqual([{ organKey: 'hello-lab', entry: '/app/hello-lab.js' }]);
    expect(merged.accepted.tabs).toEqual([{ organKey: 'hello-lab', tab: 'yours' }]);
  });
});
