/**
 * Kira Convex Mirror Contract.
 *
 * The seed brain runs locally today, but its durable shape is Convex:
 * receipts table + atoms table + head table. This module is pure and testable so the table contract
 * exists before any live Convex deployment is trusted.
 */
import {
  KiraBrainState,
  KiraReceipt,
  MemoryAtom,
  createEmptyBrain,
  verifyBrainState,
} from './kiraBrain';

export interface KiraConvexReceiptRow {
  table: 'kira_receipts';
  receiptId: string;
  sequence: number;
  previousHash: string;
  atomId: string;
  inputHash: string;
  createdAt: string;
  kind: string;
  source: string;
  scope: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface KiraConvexAtomRow {
  table: 'kira_atoms';
  atomId: string;
  kind: string;
  source: string;
  scope: string;
  text: string;
  supportQuote: string;
  tags: string[];
  tokens: string[];
  trigrams: string[];
  links: string[];
  receiptId: string;
  createdAt: string;
  advisoryOnly: true;
  grantsAuthority: false;
  // Brick 0 governance marks (adversarial review): the mirror MUST carry these — dropping them
  // silently un-jails a quarantined atom (containment reversed) or un-erases an erased one (recall
  // resurrected) on round-trip, and would export a jailed atom's forbidden text as a live row.
  erased?: true;
  erasedAt?: string;
  eraseReason?: string;
  quarantined?: true;
  quarantinedAt?: string;
  quarantineReason?: string;
}

export interface KiraConvexHeadRow {
  table: 'kira_head';
  schema: 'AUKORA_KIRA_BRAIN_V1';
  receiptCount: number;
  atomCount: number;
  // Brick 0: containment is VISIBLE on the head — a network reader of the loopback surface must
  // be able to see "N jailed / M erased", never a clean count that hides them.
  quarantinedCount: number;
  erasedCount: number;
  lastReceiptHash: string;
  updatedAt: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface KiraConvexMirror {
  receipts: KiraConvexReceiptRow[];
  atoms: KiraConvexAtomRow[];
  head: KiraConvexHeadRow;
}

export function toConvexMirror(state: KiraBrainState): KiraConvexMirror {
  const verification = verifyBrainState(state);
  if (!verification.ok) throw new Error(`kira_convex_mirror_invalid_state:${verification.errors.join(';')}`);
  const receipts: KiraConvexReceiptRow[] = state.receipts.map((r) => ({
    table: 'kira_receipts',
    receiptId: r.id,
    sequence: r.sequence,
    previousHash: r.previousHash,
    atomId: r.atomId,
    inputHash: r.inputHash,
    createdAt: r.createdAt,
    kind: r.kind,
    source: r.source,
    scope: r.scope,
    advisoryOnly: true,
    grantsAuthority: false,
  }));
  const atoms: KiraConvexAtomRow[] = state.atoms.map((a) => ({
    table: 'kira_atoms',
    atomId: a.id,
    kind: a.kind,
    source: a.source,
    scope: a.scope,
    text: a.text,
    supportQuote: a.supportQuote,
    tags: a.tags,
    tokens: a.tokens,
    trigrams: a.trigrams,
    links: a.links,
    receiptId: a.receiptId,
    createdAt: a.createdAt,
    advisoryOnly: true,
    grantsAuthority: false,
    // carry the Brick 0 marks through so containment/erasure survives the round-trip
    ...(a.erased ? { erased: true as const, erasedAt: a.erasedAt, eraseReason: a.eraseReason } : {}),
    ...(a.quarantined ? { quarantined: true as const, quarantinedAt: a.quarantinedAt, quarantineReason: a.quarantineReason } : {}),
  }));
  return {
    receipts,
    atoms,
    head: {
      table: 'kira_head',
      schema: 'AUKORA_KIRA_BRAIN_V1',
      receiptCount: receipts.length,
      atomCount: atoms.length,
      quarantinedCount: verification.quarantinedCount,
      erasedCount: verification.erasedCount,
      lastReceiptHash: receipts.at(-1)?.receiptId ?? 'genesis',
      updatedAt: state.updatedAt,
      advisoryOnly: true,
      grantsAuthority: false,
    },
  };
}

export function fromConvexMirror(mirror: KiraConvexMirror): KiraBrainState {
  const now = mirror.head.updatedAt;
  const base = createEmptyBrain(now);
  const receipts: KiraReceipt[] = mirror.receipts
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((r) => ({
      id: r.receiptId,
      sequence: r.sequence,
      previousHash: r.previousHash,
      atomId: r.atomId,
      inputHash: r.inputHash,
      createdAt: r.createdAt,
      kind: r.kind as KiraReceipt['kind'],
      source: r.source,
      scope: r.scope,
      advisoryOnly: true,
      grantsAuthority: false,
    }));
  const atoms: MemoryAtom[] = mirror.atoms.map((a) => ({
    id: a.atomId,
    kind: a.kind as MemoryAtom['kind'],
    source: a.source,
    scope: a.scope,
    text: a.text,
    supportQuote: a.supportQuote,
    tags: a.tags,
    tokens: a.tokens,
    trigrams: a.trigrams,
    links: a.links,
    receiptId: a.receiptId,
    createdAt: a.createdAt,
    advisoryOnly: true,
    grantsAuthority: false,
    ...(a.erased ? { erased: true as const, erasedAt: a.erasedAt, eraseReason: a.eraseReason } : {}),
    ...(a.quarantined ? { quarantined: true as const, quarantinedAt: a.quarantinedAt, quarantineReason: a.quarantineReason } : {}),
  }));
  const state: KiraBrainState = { ...base, updatedAt: now, receipts, atoms, advisoryOnly: true, grantsAuthority: false };
  const verification = verifyBrainState(state);
  if (!verification.ok) throw new Error(`kira_convex_mirror_invalid_rows:${verification.errors.join(';')}`);
  return state;
}

export function convexMirrorGrantsAuthority(_mirror?: KiraConvexMirror): false {
  return false;
}

export function convexContractSummary(): string {
  return [
    'Kira Convex Contract: kira_receipts + kira_atoms + kira_head.',
    'Rows mirror the local receipt-backed brain exactly; Convex persistence does not add authority.',
    'Writes require a governed apply lane; read/recall remains advisory-only.',
  ].join(' ');
}
