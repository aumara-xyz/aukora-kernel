// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Minimal ambient shim for the Bun globals the spatial door uses, so the spatial typecheck gate
// (scripts/test.sh, issue #68) can catch identifier / missing-import / arg-mismatch bugs in OUR code
// WITHOUT pulling the full @types/bun dependency. Only the surface spatial actually touches is declared;
// spawn/file are intentionally permissive (we are not type-checking Bun itself, just our usage of it).
//
// SCOPE — this is a TYPECHECK-ONLY stand-in for @types/bun, intentionally loose. It has NO runtime
// effect (Bun provides the real globals when the door runs); it exists solely so the gate can flag our
// bugs. It is NOT authoritative Bun typing — if the spatial code ever needs precise Bun API types, add
// the real @types/bun (or bun-types) as a dev dependency and delete this shim.
declare const Bun: {
  serve(options: {
    hostname?: string;
    port?: number;
    idleTimeout?: number;
    fetch(req: Request): Response | Promise<Response>;
  }): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawn(...args: any[]): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  file(...args: any[]): any;
  connect(options: unknown): unknown;
};

// Bun extends import.meta with dir/path/file (used by spatial/serve.ts for asset paths).
interface ImportMeta {
  dir: string;
  path: string;
  file: string;
}
