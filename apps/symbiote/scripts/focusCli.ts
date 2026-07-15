// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * FOCUS CLI — the deliberate hand on the working-focus register (core/src/focusRegister.ts).
 *
 *   bun scripts/focusCli.ts set --what "..." [--why "..."] [--who owner-typed]
 *   bun scripts/focusCli.ts show
 *   bun scripts/focusCli.ts clear
 *
 * `set` writes one governed focus row through the SAME ceremony as captured turns
 * (capture writer: manifest -> subject PoP -> one-shot grant -> receipt) and then advances
 * the node-local pointer. Setting focus is a deliberate act — this CLI or a future
 * proposal-gated lane write; never a side effect of serving a turn.
 * `clear` drops the pointer only: the row stays as receipted history (full removal is the
 * existing erase ceremony: bun scripts/captureSubjectAdapter.ts erase <key> <reason>).
 *
 * Every outcome prints LOUDLY — success and refusal alike (silent success reads as failure).
 */
import { setFocus, readCurrentFocus, writeFocusPointer, clearFocusPointer, focusPointerPath, readFocusPointerSafe } from '../core/src/focusRegister';
import { createGovernedHttpInvoke } from '../core/src/memoryKernelTransport';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function cmdSet(): Promise<void> {
  const what = arg('--what');
  if (!what) { console.error('refused: --what is required'); process.exit(1); }
  const why = arg('--why') ?? '';
  const who = arg('--who') ?? 'owner-typed';
  const at = new Date().toISOString();

  const { ensureCaptureWriter } = await import('./captureSubjectAdapter');
  const ensured = await ensureCaptureWriter();
  if (!ensured.ok) { console.error(`refused: ${ensured.refused}`); process.exit(1); }
  const writer = ensured.writer;

  const result = await setFocus(
    { what, why, who, at },
    {
      ownerRootId: writer.ownerRootId,
      deploymentUrl: writer.deploymentUrl,
      invoke: createGovernedHttpInvoke({ url: writer.deploymentUrl }),
      nextUse: () => writer.nextUse(),
    },
  );
  if (!result.ok) { console.error(`refused: ${result.refused}`); process.exit(1); }

  const pointed = writeFocusPointer({ key: result.key, at, setAt: at });
  console.log('DONE — working focus set and receipted.');
  console.log(`  row:      ${result.key}`);
  console.log(`  receipt:  ${result.receiptHash.slice(0, 16)}…`);
  console.log(`  pointer:  ${pointed ? focusPointerPath() : 'FAILED to advance (row + receipt still exist; re-run set)'}`);
  if (!pointed) process.exit(1);
}

async function cmdShow(): Promise<void> {
  const { ownerRecallByKey } = await import('./memoryRecallAdapter');
  const current = await readCurrentFocus({ recallByKey: ownerRecallByKey });
  if (!current.present) { console.log(`no working focus (${current.reason})`); return; }
  console.log('CURRENT WORKING FOCUS');
  console.log(`  what: ${current.focus.what}`);
  if (current.focus.why) console.log(`  why:  ${current.focus.why}`);
  console.log(`  who:  ${current.focus.who}`);
  console.log(`  at:   ${current.focus.at}`);
  console.log(`  row:  ${current.key}`);
}

async function cmdClear(): Promise<void> {
  const had = readFocusPointerSafe();
  const ok = clearFocusPointer();
  if (!ok) { console.error('refused: could not remove the pointer file'); process.exit(1); }
  console.log(had
    ? `DONE — working focus cleared (pointer removed). The row ${had.key} remains as receipted history; to remove it, run the erase ceremony.`
    : 'DONE — no working focus was set (nothing to clear).');
}

const cmd = process.argv[2];
const run = async () => {
  if (cmd === 'set') return cmdSet();
  if (cmd === 'show') return cmdShow();
  if (cmd === 'clear') return cmdClear();
  console.log('usage: bun scripts/focusCli.ts set --what "..." [--why "..."] [--who <label>] | show | clear');
};
run().catch((e) => { console.error(`refused: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
