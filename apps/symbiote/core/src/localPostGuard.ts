// Local POST guard for loopback browser surfaces. This is not authority; it is
// blind-CSRF containment around existing local endpoints.

export interface LocalPostGuardOptions {
  allowedOrigins: readonly string[];
  allowedRefererOrigins?: readonly string[];
  allowNoBrowserOrigin?: boolean;
  requiredToken?: string;
  tokenHeader?: string;
}

export type LocalPostGuardResult =
  | { ok: true }
  | { ok: false; status: 403; reason: 'origin_not_allowed' | 'referer_not_allowed' | 'missing_or_bad_token' | 'bad_referer' };

interface HeaderReader {
  get(name: string): string | null;
}

function parseOriginFromReferer(referer: string): string | null {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function checkLocalPostGuard(headers: HeaderReader, opts: LocalPostGuardOptions): LocalPostGuardResult {
  const allowedOrigins = new Set(opts.allowedOrigins);
  const allowedRefererOrigins = new Set(opts.allowedRefererOrigins ?? opts.allowedOrigins);
  const origin = headers.get('origin');
  const referer = headers.get('referer');
  const allowNoBrowserOrigin = opts.allowNoBrowserOrigin ?? true;

  if (origin && !allowedOrigins.has(origin)) {
    return { ok: false, status: 403, reason: 'origin_not_allowed' };
  }

  if (!origin && referer) {
    const refererOrigin = parseOriginFromReferer(referer);
    if (!refererOrigin) return { ok: false, status: 403, reason: 'bad_referer' };
    if (!allowedRefererOrigins.has(refererOrigin)) {
      return { ok: false, status: 403, reason: 'referer_not_allowed' };
    }
  }

  if (!origin && !referer && !allowNoBrowserOrigin) {
    return { ok: false, status: 403, reason: 'origin_not_allowed' };
  }

  if (opts.requiredToken) {
    const tokenHeader = opts.tokenHeader ?? 'x-aukora-csrf';
    if (headers.get(tokenHeader) !== opts.requiredToken) {
      return { ok: false, status: 403, reason: 'missing_or_bad_token' };
    }
  }

  return { ok: true };
}
