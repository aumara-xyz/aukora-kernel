import { getTestPublicKey } from './crypto';
import { PINNED_EDGE_NODE_PUBLIC_KEY } from './pinnedPublicKey';

let consistencyChecked = false;

export function assertRuntimeSeedMatchesPinnedPublicKey() {
  const seed = getEdgeNodeSeed(); // fails closed if missing
  const derived = getTestPublicKey(seed);
  if (derived !== PINNED_EDGE_NODE_PUBLIC_KEY) {
    throw new Error('FATAL: Key consistency guard failed. The injected AUKORA_EDGE_NODE_SEED does not mathematically match the PINNED_EDGE_NODE_PUBLIC_KEY.');
  }
  consistencyChecked = true;
}

export function getEdgeNodeSeed(): string {
  const seed = process.env.AUKORA_EDGE_NODE_SEED;
  if (!seed) {
    throw new Error('FATAL: AUKORA_EDGE_NODE_SEED environment variable is not set. Node cannot start without a private secret.');
  }
  return seed;
}

export function getAndCheckEdgeNodeSeed(): string {
  if (!consistencyChecked) {
    assertRuntimeSeedMatchesPinnedPublicKey();
  }
  return getEdgeNodeSeed();
}

export const EDGE_NODE_PUBLIC_KEY = PINNED_EDGE_NODE_PUBLIC_KEY;
