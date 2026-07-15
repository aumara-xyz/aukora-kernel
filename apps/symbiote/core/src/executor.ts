import * as fs from 'fs';
import * as path from 'path';
import { KernelDecision, EDGE_NODE_PUBLIC_KEY } from './index';
import { verifyReceiptHistory, verifySignedHead, computeMerkleRoot, Receipt } from './crypto';

export function executeDecision(
  decision: KernelDecision,
  receipts: Receipt[]
): { success: boolean; data?: string; error?: string } {
  const expectedRoot = computeMerkleRoot(receipts);

  if (!verifyReceiptHistory(receipts, expectedRoot)) {
    return { success: false, error: 'chain_invalid' };
  }

  if (!verifySignedHead(EDGE_NODE_PUBLIC_KEY, expectedRoot, decision.receipt.signedHead)) {
    return { success: false, error: 'signature_invalid' };
  }

  const receiptInChain = receipts.find(r => r.id === decision.receipt.id);
  if (!receiptInChain) {
    return { success: false, error: 'receipt_not_in_chain' };
  }

  if (decision.verdict !== receiptInChain.verdict) {
    return { success: false, error: 'forged_verdict' };
  }

  if (decision.verdict !== 'golden_success') {
    return { success: false, error: 'refused' };
  }

  const intent = receiptInChain.normalizedIntent;

  if (intent.action === 'read_file' && intent.resource === 'data.txt' && intent.ring === 'local') {
    try {
      const fixturePath = path.join(__dirname, '..', 'fixtures', 'data.txt');
      const data = fs.readFileSync(fixturePath, 'utf8');
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  return { success: false, error: 'unsupported_capability' };
}
