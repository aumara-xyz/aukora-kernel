// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Wires wombMemory.ts's in-memory capture (WombMemoryStore) to kiraBrain.ts's persistent,
 * hash-chained receipt log (ingestMemory). Before this module existed, the two were parallel,
 * disconnected infrastructure: WombMemoryStore captured records for retrieval/BM25 search, but
 * produced no durable, tamper-evident receipt trail; kiraBrain.ts had the receipt chain, but
 * nothing in the womb-memory capture path ever called it.
 *
 * This module adds a single new entry point, captureWithReceipt(), that does BOTH: it calls
 * WombMemoryStore.add() exactly as before (unchanged, no regression risk to existing wombMemory
 * behavior/tests), and it calls kiraBrain's ingestMemory() to mint a real, hash-chained
 * KiraReceipt for the same content. Neither wombMemory.ts nor kiraBrain.ts is modified.
 *
 * Still advisory-only: ingestMemory() already pins advisoryOnly:true/grantsAuthority:false on every
 * receipt/atom it mints, and self-verifies via verifyBrainState() before returning — this module adds
 * no new authority surface, just a wiring point between two already-advisory-only organs.
 */
import { WombMemoryStore, type WombMemoryKind, type WombMemoryRecord } from './wombMemory';
import { ingestMemory, type KiraBrainState, type MemoryKind, type KiraReceipt, type MemoryAtom } from './kiraBrain';

/** Maps wombMemory.ts's 8-kind vocabulary onto kiraBrain.ts's 4-kind vocabulary. wombMemory's
 *  'receipt' kind maps onto kiraBrain's 'receipt' kind directly (both mean "this record is itself
 *  about a receipt/chain event"); everything else maps onto the closest semantic fit. */
const WOMB_TO_KIRA_KIND: Record<WombMemoryKind, MemoryKind> = {
  turn: 'experience',
  fusion: 'experience',
  receipt: 'receipt',
  sleep: 'experience',
  burn: 'experience',
  safety: 'note',
  preference: 'note',
  code: 'code_map',
};

export interface CaptureWithReceiptResult {
  wombRecord: WombMemoryRecord;
  kiraState: KiraBrainState;
  atom: MemoryAtom;
  receipt: KiraReceipt;
}

export interface CaptureWithReceiptOptions {
  immutable?: boolean;
  tags?: string[];
  /** kiraBrain scope label — defaults to the wombMemory kind itself if not given. */
  scope?: string;
  now?: string;
}

/** Captures one piece of content into BOTH organs: WombMemoryStore (unchanged capture/retrieval
 *  behavior) and kiraBrain's real hash-chained receipt log (new). Returns the updated
 *  KiraBrainState — callers own persisting it (e.g. via kiraBrain's saveBrainState), matching
 *  kiraBrain.ts's existing pure/functional (state-in, state-out) design. Never throws silently: if
 *  ingestMemory's own internal verifyBrainState() check fails, this throws the same way ingestMemory
 *  itself does (fail-closed, not swallowed). */
export function captureWithReceipt(
  store: WombMemoryStore,
  kiraState: KiraBrainState,
  kind: WombMemoryKind,
  title: string,
  content: string,
  source: string,
  opts?: CaptureWithReceiptOptions,
): CaptureWithReceiptResult {
  const wombRecord = store.add(kind, title, content, source, { immutable: opts?.immutable, tags: opts?.tags });
  const { state, atom, receipt } = ingestMemory(kiraState, {
    kind: WOMB_TO_KIRA_KIND[kind],
    text: content,
    source,
    scope: opts?.scope ?? kind,
    tags: opts?.tags,
    now: opts?.now,
  });
  return { wombRecord, kiraState: state, atom, receipt };
}
