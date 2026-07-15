import { RawIntent, normalizeProposal } from './normalizer';
import { generateReceipt, Receipt, PoP, PoPProvenance, verifyPoP, computeMerkleRoot, signHead, hash, canonicalIntentSerialize } from './crypto';
import { writeVkRow, VkTrainingRow } from './vk';
import { BoundedNonceLedger } from './boundedNonceLedger';

export interface KernelDecision {
  verdict: Receipt['verdict'];
  receipt: Receipt;
  vkRow: VkTrainingRow;
}

let globalReceipts: Receipt[] = [];
let lastReceiptHash = 'genesis_hash';
import { getEdgeNodeSeed, getAndCheckEdgeNodeSeed, EDGE_NODE_PUBLIC_KEY } from './nodeIdentity';
export { EDGE_NODE_PUBLIC_KEY };
// --- Pinned Trust Anchors ---
export const PrincipalRegistry = new Map<string, string>(); // principalId -> publicKey
// Replay-nonce ledger — BOUNDED so a flood of distinct nonces cannot exhaust memory (council finding #3).
// Stays module-private (never exported): other organs are tested to never import it.
const NONCE_LEDGER_MAX = 100_000;
const NonceLedger = new BoundedNonceLedger(NONCE_LEDGER_MAX);

export function evaluateIntent(rawIntent: RawIntent, pop: PoP | null): KernelDecision {
  const intent = normalizeProposal(rawIntent);
  let verdict: Receipt['verdict'] = 'refused';
  let provenance: PoPProvenance | null = null;
  const intentHash = hash(canonicalIntentSerialize(intent));

  // 1. Fail-closed deny unknown/restricted actions
  if (['delete_path', 'write_file', 'shell', 'network', 'self_modify', 'sacred_violation', 'refused_charset'].includes(intent.action)) {
    verdict = 'refused';
  } 
  // 2. Mediated actions
  else if (intent.action === 'read_file') {
    if (pop) {
      const pinnedKey = PrincipalRegistry.get(pop.principalId);
      if (
        pinnedKey &&
        pop.publicKey === pinnedKey &&
        pop.argsHash === intentHash &&
        pop.methodId === 'evaluateIntent' &&
        verifyPoP(pop) &&
        NonceLedger.consume(pop.nonce) // ATOMIC check-and-add: true once per fresh nonce, false on replay.
        // Evaluated LAST (via &&), so the nonce is consumed ONLY when every other auth check already passed —
        // a request that fails another check never burns a fresh nonce.
      ) {
        verdict = 'golden_success';
        // #4a — record WHO authorized this success: hashes/fingerprints only (no raw nonce, no secret).
        provenance = {
          principalFingerprint: hash(pop.publicKey),
          methodId: pop.methodId,
          argsHash: pop.argsHash,
          nonceHash: hash(pop.nonce),
        };
      } else {
        verdict = 'refused';
      }
    } else {
      verdict = 'refused';
    }
  } 
  // Default deny
  else {
    verdict = 'refused';
  }

  // Generate Receipt — bind the monotonic sequence (current chain length) + the auth-provenance into the id
  const receipt = generateReceipt(verdict, intent, intentHash, lastReceiptHash, globalReceipts.length, provenance);
  lastReceiptHash = receipt.id; // advance the chain

  // Bind Merkle Root via Signed Head
  globalReceipts.push(receipt);
  const root = computeMerkleRoot(globalReceipts);
  receipt.signedHead = signHead(getAndCheckEdgeNodeSeed(), root);

  // Write VK Training Row (Evidence only)
  const vkRow = writeVkRow('evaluate_intent', intent, verdict, receipt);

  return { verdict, receipt, vkRow };
}

export function _resetChain() {
  // test-only — gated SOLELY by NODE_ENV. The previous runtime-global escape hatch was a production bypass
  // surface (anyone who could set that global could wipe the chain) — council finding #2. Test runners set
  // NODE_ENV=test; production never does, so production reset stays forbidden.
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('_resetChain is test-only. Production chain reset is forbidden.');
  }
  lastReceiptHash = 'genesis_hash';
  globalReceipts = [];
  PrincipalRegistry.clear();
  NonceLedger.clear();
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export function getChain(): Receipt[] {
  // Return a deeply CLONED + deeply FROZEN snapshot — callers may READ the chain but cannot tamper it at ANY
  // depth: the array AND each receipt's verdict / normalizedIntent.* / provenance.* all refuse mutation, and
  // because the objects are independent clones, even a mutation that slipped through could not reach the live
  // ledger (council finding #1, deepened — freeze the receipt objects, not just the array).
  return deepFreeze(JSON.parse(JSON.stringify(globalReceipts))) as Receipt[];
}
