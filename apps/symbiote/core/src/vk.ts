import { NormalizedIntent } from './normalizer';
import { hash, Receipt } from './crypto';

export type SemanticSlot = 'action' | 'resource' | 'ring' | 'verdict' | 'receiptId';
const SLOT_ORDER: SemanticSlot[] = ['action', 'resource', 'ring', 'verdict', 'receiptId'];

export interface VkPayload {
  formatVersion: string;
  codebookHash: string;
  payloadCodes: string[];
}

export interface VkTrainingRow {
  rowId: string;
  receiptId: string;
  receiptHash: string;
  intentHash: string;
  glyphHash: string;
  codebookVersion: string;
  normalizedIntent: NormalizedIntent;
  verdict: string;
  vkPayload: VkPayload;
  evidenceOnly: true;
  createdAt: number;
}

export const EDGE_GENESIS_CODEBOOK = {
  version: "vk-edge-v1",
  vocab: {
    action: {
      "read_file": "A01",
      "delete_path": "A02",
      "write_file": "A03",
      "shell": "A04",
      "network": "A05",
      "self_modify": "A06",
      "sacred_violation": "A07",
      "refused_charset": "A08"
    } as Record<string, string>,
    ring: {
      "local": "R01",
      "root": "R02",
      "external": "R03"
    } as Record<string, string>,
    verdict: {
      "golden_success": "V01",
      "refused": "V02",
      "noise_dropped": "V03"
    } as Record<string, string>
  }
};

// Create reverse lookups for the finite vocabulary
const reverseVocab = {
  action: Object.fromEntries(Object.entries(EDGE_GENESIS_CODEBOOK.vocab.action).map(([k, v]) => [v, k])),
  ring: Object.fromEntries(Object.entries(EDGE_GENESIS_CODEBOOK.vocab.ring).map(([k, v]) => [v, k])),
  verdict: Object.fromEntries(Object.entries(EDGE_GENESIS_CODEBOOK.vocab.verdict).map(([k, v]) => [v, k]))
};

export function encodeVkPayload(intent: NormalizedIntent, verdict: string, receiptId: string): VkPayload {
  const payloadCodes = SLOT_ORDER.map(slot => {
    if (slot === 'action') return EDGE_GENESIS_CODEBOOK.vocab.action[intent.action] || `A99:${intent.action}`;
    if (slot === 'ring') return EDGE_GENESIS_CODEBOOK.vocab.ring[intent.ring] || `R99:${intent.ring}`;
    if (slot === 'verdict') return EDGE_GENESIS_CODEBOOK.vocab.verdict[verdict] || `V99:${verdict}`;
    
    // For unbounded strings, we prefix them as part of the formal schema
    if (slot === 'resource') return `RES:${intent.resource}`;
    if (slot === 'receiptId') return `ID:${receiptId}`;
    return '';
  });

  return {
    formatVersion: EDGE_GENESIS_CODEBOOK.version,
    codebookHash: hash(JSON.stringify(EDGE_GENESIS_CODEBOOK)),
    payloadCodes
  };
}

export function decodeVkPayload(payload: VkPayload): Record<SemanticSlot, string> {
  // Can be called cold; requires no prior memory state.
  const expectedHash = hash(JSON.stringify(EDGE_GENESIS_CODEBOOK));
  if (payload.codebookHash !== expectedHash) {
    throw new Error("Codebook hash mismatch. Unable to decode payload.");
  }

  const out: Partial<Record<SemanticSlot, string>> = {};
  for (let i = 0; i < SLOT_ORDER.length; i++) {
    const slot = SLOT_ORDER[i];
    const code = payload.payloadCodes[i];
    
    let val: string | undefined;
    if (slot === 'action') {
      val = code.startsWith('A99:') ? code.slice(4) : reverseVocab.action[code];
    } else if (slot === 'ring') {
      val = code.startsWith('R99:') ? code.slice(4) : reverseVocab.ring[code];
    } else if (slot === 'verdict') {
      val = code.startsWith('V99:') ? code.slice(4) : reverseVocab.verdict[code];
    } else if (slot === 'resource') {
      val = code.startsWith('RES:') ? code.slice(4) : undefined;
    } else if (slot === 'receiptId') {
      val = code.startsWith('ID:') ? code.slice(3) : undefined;
    }

    if (val === undefined) throw new Error(`Decode failed for slot ${slot} with code ${code}`);
    out[slot] = val;
  }
  return out as Record<SemanticSlot, string>;
}

// VK rows are evidence-only. They never affect the execution outcome.
export function writeVkRow(task: string, intent: NormalizedIntent, verdict: string, receipt: Receipt): VkTrainingRow {
  const vkPayload = encodeVkPayload(intent, verdict, receipt.id);
  const codebookVersion = "v1-edge-genesis";
  const glyphHash = hash(JSON.stringify(vkPayload)); // Hash of canonical payload
  
  return {
    rowId: `vk_${hash(receipt.id).slice(0, 16)}`,
    receiptId: receipt.id,
    receiptHash: receipt.id, // In this prototype, ID is the hash
    intentHash: receipt.intentHash,
    glyphHash,
    codebookVersion,
    normalizedIntent: intent,
    verdict,
    vkPayload,
    evidenceOnly: true,
    createdAt: Date.now()
  };
}
