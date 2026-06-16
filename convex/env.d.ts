// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
//
// Deploy-readiness ambient type ONLY — no runtime effect, no protocol change. Convex exposes environment variables as
// `process.env.*` at runtime (env vars set via `npx convex env set`); this declaration satisfies the `tsc --noEmit`
// deploy typecheck, whose convex tsconfig has no `@types/node`. Narrow on purpose: only `process.env` is available in
// the Convex isolate, so only `process.env` is typed.
declare const process: { readonly env: Record<string, string | undefined> };
