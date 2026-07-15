import { VkTrainingRow, decodeVkPayload } from './vk';
import { hash, verifyChain, verifyReceiptHistory, verifySignedHead, Receipt } from './crypto';
import { EDGE_NODE_PUBLIC_KEY } from './index';

export interface ExportedVkRow {
  rowId: string;
  receiptId: string;
  receiptHash: string;
  intentHash: string;
  normalizedIntent: any;
  verdict: string;
  vkPayload: any;
  glyphHash: string;
  codebookVersion: string;
  codebookHash: string;
  evidenceOnly: boolean;
  createdAt: number;
}

export function exportVkRow(row: VkTrainingRow): string {
  const safeExport: ExportedVkRow = {
    rowId: row.rowId,
    receiptId: row.receiptId,
    receiptHash: row.receiptHash,
    intentHash: row.intentHash,
    normalizedIntent: row.normalizedIntent,
    verdict: row.verdict,
    vkPayload: row.vkPayload,
    glyphHash: row.glyphHash,
    codebookVersion: row.codebookVersion,
    codebookHash: row.vkPayload.codebookHash,
    evidenceOnly: row.evidenceOnly,
    createdAt: row.createdAt
  };

  return JSON.stringify(safeExport);
}

export function loadVkRow(jsonRow: string): VkTrainingRow {
  const parsed = JSON.parse(jsonRow);

  // 1. Verify codebook hash consistency
  if (parsed.vkPayload.codebookHash !== parsed.codebookHash) {
    throw new Error('Integrity Check Failed: Codebook hash mismatch between row and payload.');
  }

  // 2. Recompute glyphHash from canonical payload and verify
  const expectedGlyphHash = hash(JSON.stringify(parsed.vkPayload));
  if (expectedGlyphHash !== parsed.glyphHash) {
    throw new Error('Integrity Check Failed: glyphHash does not match canonical payload.');
  }

  // 3. Cold-decode the payload to prove codebook compatibility
  const decoded = decodeVkPayload(parsed.vkPayload);

  // 4. Cross-bind top-level fields to decoded payload
  if (decoded.action !== parsed.normalizedIntent.action) throw new Error('Cross-binding Failed: decoded action mismatch');
  if (decoded.resource !== parsed.normalizedIntent.resource) throw new Error('Cross-binding Failed: decoded resource mismatch');
  if (decoded.ring !== parsed.normalizedIntent.ring) throw new Error('Cross-binding Failed: decoded ring mismatch');
  if (decoded.verdict !== parsed.verdict) throw new Error('Cross-binding Failed: decoded verdict mismatch');
  if (decoded.receiptId !== parsed.receiptId) throw new Error('Cross-binding Failed: decoded receiptId mismatch');

  // 5. Verify intent hash matches normalizedIntent payload
  const expectedIntentHash = hash(JSON.stringify(parsed.normalizedIntent));
  if (expectedIntentHash !== parsed.intentHash) throw new Error('Cross-binding Failed: intentHash mismatch');

  const row: VkTrainingRow = {
    rowId: parsed.rowId,
    receiptId: parsed.receiptId,
    receiptHash: parsed.receiptHash,
    intentHash: parsed.intentHash,
    normalizedIntent: parsed.normalizedIntent,
    verdict: parsed.verdict,
    vkPayload: parsed.vkPayload,
    glyphHash: parsed.glyphHash,
    codebookVersion: parsed.codebookVersion,
    evidenceOnly: parsed.evidenceOnly,
    createdAt: parsed.createdAt
  };

  return row;
}

export function verifyVkRowAgainstSignedChain(
  row: VkTrainingRow,
  receipts: Receipt[],
  expectedRoot: string,
  signedHead: string
): boolean {
  // 1. Find matching receipt
  const receipt = receipts.find(r => r.id === row.receiptId);
  if (!receipt) throw new Error('Verification Failed: No matching receipt found in chain.');

  // 2. Assert structural and cryptographic field binding
  if (row.receiptId !== receipt.id) throw new Error('Verification Failed: receiptId mismatch.');
  if (row.receiptHash !== row.receiptId) throw new Error('Verification Failed: receiptHash mismatch.');
  if (row.intentHash !== receipt.intentHash) throw new Error('Verification Failed: intentHash mismatch.');
  if (JSON.stringify(row.normalizedIntent) !== JSON.stringify(receipt.normalizedIntent)) throw new Error('Verification Failed: normalizedIntent mismatch.');
  if (row.verdict !== receipt.verdict) throw new Error('Verification Failed: verdict mismatch.');

  // 3. Verify the chain integrity
  if (!verifyChain(receipts)) throw new Error('Verification Failed: verifyChain failed.');
  if (!verifyReceiptHistory(receipts, expectedRoot)) throw new Error('Verification Failed: verifyReceiptHistory failed.');
  
  // 4. Verify cryptographic authority binding against PINNED node key
  if (!verifySignedHead(EDGE_NODE_PUBLIC_KEY, expectedRoot, signedHead)) throw new Error('Verification Failed: signed head signature invalid.');

  return true;
}
