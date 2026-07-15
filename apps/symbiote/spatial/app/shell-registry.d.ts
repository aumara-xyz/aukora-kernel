import type { AppContract, BuiltinOrgan, BuiltinTabs } from './app-registry.js';

export function pickContractMount(mod: unknown): ((...args: any[]) => any) | null;

export function makeContractMountResolver(
  importer?: (entry: string) => Promise<unknown>
): (entry: string) => ((root: Element) => Promise<unknown>);

export function materializeShellModel(
  builtinsOrgans: Record<string, BuiltinOrgan>,
  builtinsTabs: BuiltinTabs,
  contracts?: readonly AppContract[],
  resolveMount?: (entry: string, organKey: string, contract: AppContract) => BuiltinOrgan['mount'] | null
): {
  organs: Record<string, BuiltinOrgan>;
  tabs: BuiltinTabs;
  accepted: {
    organs: Array<{ organKey: string; entry: string }>;
    tabs: Array<{ organKey: string; tab: 'yours' }>;
  };
  skipped: Array<{ organKey: string | null; reason: string }>;
};
