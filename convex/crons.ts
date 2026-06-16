// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * Scheduled jobs. B3.3 witness poll — LAB cadence only. The interval is the witness's LOCAL poll rhythm, NOT a trusted
 * global clock. The tick is DORMANT until `AUKORA_B3_WITNESS_ENABLED` (it returns `witness_disabled` with the flag off),
 * so deploying this cron creates NO live witness behavior; it activates only after a future same-commit redeploy of both
 * nodes + an explicit flag flip (see `canon/AUKORA_TWO_NODE_PRINT_CHECKLIST.md` pre-flip gate). A missed poll is
 * liveness, never equivocation.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("aukora witness poll", { minutes: 10 }, internal.aukoraWitness.witnessTick, {});
export default crons;
