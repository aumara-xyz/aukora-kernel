export const STARTING_CASH: number;
export const LEDGER_SCHEMA: string;
export const DEFAULT_FEE_BPS: number;
export const DEFAULT_SLIP_BPS: number;
export function createLedger(data?: unknown, opts?: { feeBps?: number; slipBps?: number }): any;
export function isValidLedger(data: unknown): boolean;
