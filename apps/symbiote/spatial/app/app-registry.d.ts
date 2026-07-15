export const APP_CONTRACT_SCHEMA: 'aukora-app-contract-v1';
export const APP_REGISTRY_TABS: readonly ['yours'];
export const APP_CONTRACTS: readonly AppContract[];

export type AppRegistryTab = 'yours';

export type AppContract = {
  schema: 'aukora-app-contract-v1';
  organKey: string;
  organ: {
    title: string;
    sub: string;
    entry: string;
  };
  menu: {
    tab: AppRegistryTab;
    label: string;
    gist: string;
  };
  advisoryOnly: true;
  grantsAuthority: false;
};

export type AppContractCheck =
  | { ok: true; value: AppContract }
  | { ok: false; reason: string };

export type BuiltinOrgan = {
  title: string;
  sub: string;
  mount: (...args: any[]) => any;
};

export type BuiltinTabs = Record<string, Array<{ organ: string; label: string; gist: string }>>;

export type MergeSkip = {
  organKey: string | null;
  reason: string;
};

export function validateAppContract(raw: unknown): AppContractCheck;

export function mergeOrgans(
  builtins: Record<string, BuiltinOrgan>,
  contracts: unknown[],
  resolveMount?: ((entry: string, organKey: string, contract: AppContract) => BuiltinOrgan['mount'] | null) | null
): {
  organs: Record<string, BuiltinOrgan>;
  accepted: Array<{ organKey: string; entry: string }>;
  skipped: MergeSkip[];
};

export function mergeTabs(
  builtins: BuiltinTabs,
  contracts: unknown[]
): {
  tabs: BuiltinTabs;
  accepted: Array<{ organKey: string; tab: AppRegistryTab }>;
  skipped: MergeSkip[];
};

export function mergeAppContracts(
  builtinsOrgans: Record<string, BuiltinOrgan>,
  builtinsTabs: BuiltinTabs,
  contracts: unknown[],
  resolveMount?: ((entry: string, organKey: string, contract: AppContract) => BuiltinOrgan['mount'] | null) | null
): {
  organs: Record<string, BuiltinOrgan>;
  tabs: BuiltinTabs;
  accepted: {
    organs: Array<{ organKey: string; entry: string }>;
    tabs: Array<{ organKey: string; tab: AppRegistryTab }>;
  };
  skipped: MergeSkip[];
};
