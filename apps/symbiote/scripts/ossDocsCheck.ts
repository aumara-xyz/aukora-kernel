// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): deterministic hygiene check for the open-source decision docs.
//
// PURE — no filesystem, no network. Given a doc's name + text, it returns violations if the doc
// leaks a secret-shaped value, names a private path, or falsely claims the project is ALREADY
// publicly released / certified / open-source-licensed. The three governance docs must pass this,
// and SECURITY.md must still carry owner-fill placeholders (no invented real contact).

export interface DocViolation { doc: string; category: string; detail: string }

// secret-shaped: long hex runs (hashes/keys), private-key blocks, cloud key prefixes, bearer-ish tokens.
const SECRET_PATTERNS: { category: string; re: RegExp }[] = [
  { category: 'secret-hex', re: /\b[0-9a-f]{40,}\b/i },
  { category: 'secret-privkey', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { category: 'secret-cloudkey', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { category: 'secret-token', re: /\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/ },
];
// private paths / owner-only material that must never appear in a public governance doc.
const PRIVATE_PATTERNS: { category: string; re: RegExp }[] = [
  { category: 'private-node-home', re: /\.aukora-symbiote/ },
  { category: 'private-owner-vectors', re: /scan-vectors\.local/ },
  { category: 'private-runtime-state', re: /(^|[^\w])(state\/(convex|kira)|lab_only)\b/ },
  { category: 'private-lab', re: /NEBIUS_LAB_FINDINGS|docs\/mesh\/handoff|CODEX_CHANNEL/ },
  { category: 'private-home-path', re: /\/Users\/[a-z0-9._-]+/i },
];
// FALSE present-tense release/certification claims (the project is NOT released; this is a decision doc).
// Each match is post-filtered: a NEGATED claim ("is not yet publicly released", "not certified") is
// honest, not a violation — only affirmative claims count.
const FALSE_RELEASE_PATTERNS: { category: string; re: RegExp }[] = [
  { category: 'false-released', re: /\b(is|are|now|has been|already)\b[^.\n]{0,40}?\b(open[- ]source(d)?|publicly (released|available)|released to the public)\b/i },
  { category: 'false-certified', re: /\b(is|are|now|has been)\b[^.\n]{0,30}?\bcertified (clean|for release|secure)\b/i },
  { category: 'false-licensed', re: /\bthis (project|repository|software) is licensed under\b/i },
];
const NEGATION_IN_SPAN = /\b(not|never|no|yet|pre[- ]?release|unreleased|would be|not yet)\b/i;
// an email is allowed ONLY as an explicit placeholder or example.* domain; anything else is a real contact.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const EMAIL_ALLOW = /@(example\.(com|org|net))$/i;
const PLACEHOLDER_TOKEN = /<OWNER-FILL:[^>]+>/;

export function checkOssDoc(doc: string, text: string): DocViolation[] {
  const v: DocViolation[] = [];
  const scan = (list: { category: string; re: RegExp }[]) => {
    for (const { category, re } of list) if (re.test(text)) v.push({ doc, category, detail: category });
  };
  scan(SECRET_PATTERNS);
  scan(PRIVATE_PATTERNS);
  // false-release claims: match affirmatively, but skip any span that carries a negation (honest doc).
  for (const { category, re } of FALSE_RELEASE_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of text.matchAll(g)) {
      if (!NEGATION_IN_SPAN.test(m[0])) { v.push({ doc, category, detail: category }); break; }
    }
  }
  // Real (non-placeholder, non-example) email addresses are treated as invented contact data.
  for (const m of text.match(EMAIL_RE) ?? []) {
    if (!EMAIL_ALLOW.test(m)) v.push({ doc, category: 'invented-contact-email', detail: 'a non-placeholder email address' });
  }
  return v;
}

/** SECURITY.md must keep an owner-fill placeholder — proof no real disclosure contact was invented. */
export function securityHasOwnerPlaceholder(text: string): boolean {
  return PLACEHOLDER_TOKEN.test(text);
}

export function checkAllOssDocs(docs: { name: string; text: string }[]): DocViolation[] {
  return docs.flatMap((d) => checkOssDoc(d.name, d.text));
}
