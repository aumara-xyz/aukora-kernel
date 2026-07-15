// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.88f — THE SINGLE SOURCE OF TRUTH for the sensitive-path policy.
 *
 * Guardian's seal-confirm proved (3rd time) the gate's drift root cause: the classifier (risk.ts) and the kernel cage
 * (egress-sandbox.ts) each hand-maintained their OWN deny-lists, which diverged — the write/edit TOOL (in-process) could plant
 * a ~/.zshrc the shell-sandbox blocks, because only the classifier list backstops the tool and it had drifted.
 *
 * THE FIX: define the policy ONCE here; BOTH consumers GENERATE their matchers from it and can never diverge. This module has
 * ZERO imports on purpose — the apply copies it verbatim next to risk.ts (session/aukora) AND next to egress-sandbox.ts (core),
 * and both import it RELATIVELY. The standalone unit tests import it relatively too. One source, identical coverage everywhere.
 *
 * Each entry is a JS-regex SOURCE string (a path-segment pattern). `readDenyRegexes()` builds RegExp for the classifier;
 * `sbplDeny()` transforms the same sources into a Seatbelt SBPL `(deny <op> (regex #"…") …)` clause for the kernel cage.
 */

// ── READ-deny: credential-bearing paths. Reads are allow-by-default (she reads many files), so this list + the egress-scrub
//    are the backstops. The CLASSIFIER applies these case-insensitively; the KERNEL cage applies them verb- & symlink-agnostically.
export const READ_DENY_SOURCES: Array<[string, string]> = [
  ['(^|/)[^/]*\\.env($|[./])', 'env file'],
  ['(^|/)\\.?secrets?(/|\\.|$)', 'secrets'],
  ['(^|/)\\.kube(/|\\.|$)', 'kubernetes config (cluster creds)'],
  ['(^|/)\\.azure(/|\\.|$)', 'azure cli credentials'],
  ['\\.(key|pem|p12|pfx|keystore|jks|asc|ppk|pkcs12|gpg)$', 'key material'],
  ['auth\\.json$', 'auth file'],
  ['(^|/)\\.(npmrc|pgpass|git-credentials)$', 'token-bearing dotfile'],
  ['(^|/)\\.docker(/|\\.|$)', 'docker registry auth'],
  ['admin[-_]?key', 'admin key'],
  ['(^|/)\\.ssh(/|\\.|$)', 'ssh keys'],
  ['(^|/)\\.aws(/|\\.|$)', 'aws credentials'],
  // Fixed 2026-07-02 (issue #24 follow-up): the boundary group (/|\.|$) required the char right after
  // "aukora" to be /, ., or end-of-string — so ~/.aukora-symbiote (this repo's own canonical state
  // home since Round 4/authority/symbiotePaths.ts) never matched at all, since "-" satisfies none of
  // those. The new (-symbiote)? group covers both the old and the new home directory name.
  ['(^|/)\\.aukora(-symbiote)?(/|\\.|$)', 'aukora identity dir (keyfile/session/memory)'],
  ['aumlok', 'AUMLOK authority'],
  ['(^|/)\\.codex(/|\\.|$)', 'codex auth'],
  ['(^|/)\\.config/(opencode|openrouter|together|anthropic|gcloud|gh|cagent)', 'provider/cli config'],
  ['(^|/)\\.gnupg(/|\\.|$)', 'gnupg keyring'],
  ['(^|/)\\.claude(/|\\.|$)', 'claude cli config + ~/.claude.json sibling (oauth/org tokens)'],
  ['(^|/)\\.m2(/|\\.|$)', 'maven settings (server passwords)'],
  ['(^|/)\\.config/(doctl|fly|flyctl|railway|supabase|stripe|heroku|op|hub|pulumi|netlify|wrangler|cloudflared|circleci|sentry|planetscale|turso|render|deno|configstore|helm|hcloud|k9s)(/|$)', 'cloud-CLI credentials'],
  ['(^|/)\\.terraform\\.d(/|\\.|$)', 'terraform credentials'],
  ['(^|/)\\.pypirc$', 'pypi upload token'],
  ['(^|/)\\.cargo/credentials', 'cargo registry token'],
  ['(^|/)\\.gem/credentials$', 'rubygems token'],
  ['(^|/)\\.config/git/credentials$', 'git credential store'],
  ['(^|/)\\.netrc$', 'netrc credentials'],
  ['(^|/)\\.dockercfg$|(^|/)\\.s3cfg$|(^|/)\\.boto$', 'legacy cloud cred sibling file'], // 88f-confirm #12
  ['(^|/)Library/Keychains/', 'macOS keychain (all saved secrets + browser safe-storage key)'], // 88f-confirm #5
  ['(^|/)(Library/Application Support|\\.config|\\.mozilla)/(Firefox|firefox|Google/Chrome|google-chrome|Chromium|chromium|BraveSoftware|Microsoft Edge|microsoft-edge)(/|$)', 'browser profile (credential store, macOS+Linux)'], // 88f-confirm #6/#13
  ['(^|/)\\.vault-token($|\\.)', 'HashiCorp Vault token'], // 88f-confirm r3 #3
  ['(^|/)\\.config/sops(/|$)|(^|/)\\.sops(/|\\.|$)|(^|/)\\.age(/|$)|(^|/)age/keys\\.txt$', 'sops/age private decryption keys'], // 88f-confirm r3 #4
  ['(^|/)\\.oci(/|\\.|$)|(^|/)\\.bluemix(/|\\.|$)', 'oracle/ibm cloud cli credentials'], // 88f-confirm r3 #10
  ['(^|/)\\.config/helm(/|$)', 'helm repo/registry credentials'], // 88f-confirm r3 #9
  ['(^|/)\\.config/containers(/|$)|(^|/)\\.local/share/containers(/|$)', 'container registry creds (podman/skopeo)'], // 88f-confirm r3 #14
  ['(^|/)\\.(zsh_history|bash_history|sh_history|bash_sessions|python_history|node_repl_history|psql_history|mysql_history|rediscli_history|sqlite_history|lesshst)$|(^|/)\\.local/share/fish/fish_history$', 'shell/REPL history (pasted secrets)'], // 88f-confirm r2 #5
  ['(^|/)\\.local/share/(keyrings|gnome-keyring|kwalletd?)(/|$)|\\.keyring$', 'Linux secret-service keyring'], // 88f-confirm r2 #6
  ['(^|/)\\.config/JetBrains(/|$)|(^|/)Library/Application Support/JetBrains(/|$)', 'JetBrains config (DB passwords / AI tokens)'], // 88f-confirm r2 #9
  ['(^|/)(Library/Application Support|\\.config)/(Code|Code - Insiders|VSCodium|Cursor)/User/globalStorage(/|$)|(^|/)state\\.vscdb$', 'editor SecretStorage (VS Code/Cursor)'], // 88f-confirm r2 #10
  ['id_rsa|(^|/)\\.[A-Za-z0-9_.-]+/([^/]+/)*credentials(/|$)', 'credentials under a cred-store dotdir (workspace src/credentials/ stays readable)'], // 88f-confirm r3 #11
  ['(^|/)admin-key\\.txt$|(^|/)aukora-convex-backend(/|$)', 'convex self-hosted admin key'],
];

// ── WRITE-protect: authority paths that must never be written EVEN INSIDE the workspace (the deny-by-default write floor allows
//    workspace writes, so these are re-denied on top). Verb- and symlink-agnostic at the kernel; classifier-checked in-process.
export const WRITE_PROTECT_SOURCES: Array<[string, string]> = [
  ['(^|/)[^/]*\\.env(\\.|$)', 'env file'],
  ['(^|/)secrets?(/|\\.|$)', 'secrets'],
  ['\\.(key|pem|p12|keystore)$', 'key material'],
  ['auth\\.json$', 'auth file'],
  ['admin[-_]?key', 'admin key'],
  // Fixed 2026-07-02 (issue #24 follow-up): same boundary-match gap as READ_DENY_SOURCES above —
  // (-symbiote)? covers the new canonical ~/.aukora-symbiote/ home too.
  ['(^|/)\\.aukora(-symbiote)?/', 'aukora identity dir'],
  ['aumlok', 'AUMLOK authority'],
  ['id_rsa|credentials', 'credentials'],
  ['manifestSigner|kernelSigner|(^|/)aukora-memory-signer-daemon|signerDaemon', 'signer authority code (daemon/manifest/kernel — a generic app signer.ts stays writable)'],
  ['structuredTruth', 'structured-truth authority'],
  ['(^|/)node-template/convex/', 'kernel/convex authority code'],
  ['(^|/)\\.github/workflows/', 'CI workflow'],
  ['(^|/)PATENTS?', 'patent file'],
  ['package\\.json$|package-lock|bun\\.lock|yarn\\.lock|pnpm-lock', 'dependency/manifest'],
  ['(^|/)\\.git/', 'git internals'],
  ['(^|/)aukora-ide/gate/', 'aukora gate code (self-protected)'],
  ['(^|/)aukora-ide/memory/', 'aukora governed-memory code (self-protected)'],
  ['(^|/)aukora-ide-memory\\.jsonl$', 'aukora memory store (self-protected)'],
  ['(^|/)aukora-ide-receipts\\.jsonl$', 'aukora receipt log (self-protected)'],
  ['(^|/)session/aukora/', 'applied aukora gate (self-protected)'],
  ['(^|/)session/tools\\.ts$', 'gate insertion chokepoint (self-protected)'],
  ['(^|/)risk\\.ts$', 'aukora risk classifier (self-protected)'],
  ['(^|/)risk-vectors\\.json$', 'aukora risk fixture (self-protected)'],
  ['(^|/)sensitivePolicy\\.ts$', 'single-source policy (self-protected)'],
  ['(^|/)(aukoraGate|governedToolBoundary|opencodeAskBridge)\\.ts$', 'aukora gate module (self-protected)'],
  ['apply-aukora-ide-gate|aukora-ide-patch-|patch-self-knowledge|aukora-ide-disable-updater', 'aukora apply/patch script (self-protected)'],
  ['(^|/)provider/transform\\.ts$', 'egress-scrub wiring (self-protected)'],
  ['(^|/)(opencode-)?tool/(perceive|see|memory|skillWrite)\\.ts$', 'aukora tool (self-protected)'],
  ['(^|/)(packages/(opencode|core)/src/)?tool/(bash|shell|webfetch)\\.ts$', 'model-exec/egress chokepoint (self-protected)'],
  ['(^|/)egress-sandbox\\.ts$', 'egress sandbox + no-egress profile (self-protected)'],
  ['(^|/)session/(bootRecall|recallRegion|system)\\.ts$', 'boot-recall/system-prompt (self-protected)'],
  ['(^|/)recallRegion\\.ts$', 'boot-recall region (canonical) (self-protected)'],
  ['(^|/)secretShape\\.ts$', 'anti-secret-stash backstop (self-protected)'],
  ['(^|/)aukora-ide/embedder/', 'local embedder sidecar (self-protected)'],
  ['(^|/)skill/index\\.ts$', 'skill registry + injection fence (self-protected)'],
  ['(^|/)tool/skill\\.ts$', 'skill body fence (self-protected)'],
  ['(^|/)AUKORA_SELF\\.md$', 'self-knowledge source (self-protected)'],
  ['(^|/)AGENTS\\.aukora\\.md$', 'self-knowledge template (self-protected)'],
  ['(^|/)packages/app/AGENTS\\.md$', 'live self-knowledge (self-protected)'],
  ['(^|/)opencode-dev/AGENTS\\.md$', 'live self-knowledge at the monorepo root (self-protected) — her identity loads from here'], // 24Z GRAVITRON-stabilize step3
  ['(^|/)aukora-ide/identity/MATERNAL_ANCHOR\\.(v1|v2)\\.md$', 'signed identity — immutable'],
  ['aukora-gate-integrity|aukora-gate-fslock|aukora-sandbox-ro-poc', 'gate guard script (self-protected)'],
  ['(^|/)\\.gate-integrity\\.sha256$', 'gate integrity manifest (self-protected)'],
  ['(^|/)aukora-ide-session\\.json$', 'AUMLOK session record (self-protected)'],
  ['(^|/)open-aukora-ide\\.sh$', 'aukora launcher (self-protected)'],
  ['(^|/)aukora-ui-plugin\\.mjs$', 'aukora UI graft plugin (self-protected)'],
  ['(^|/)electron\\.vite\\.config\\.ts$', 'gate wiring config (self-protected)'],
  ['(^|/)packages/app/vite\\.config\\.ts$', 'gate wiring config (self-protected)'],
  ['(^|/)packages/desktop/src/main/index\\.ts$', 'desktop main wiring (self-protected)'],
  ['(^|/)session/prompt\\.ts$', 'session shell endpoint (self-protected)'],
  ['build-node\\.ts$', 'server bundle build (self-protected)'],
  ['(^|/)\\.opencode/(tool|tools|plugin|plugins|node_modules|commands?)(/|$)', 'opencode autoload/exec subdir (NOT skills)'], // 24Z.91: commands? covers the plural command-template dir (Codex P0 / Fusion 24Z.90 gate-bypass)
  ['(^|/)\\.opencode/(config\\.jsonc?|config)$', 'opencode config file'],
  ['(^|/)\\.opencode/?$', 'opencode config root'],
  ['(^|/)\\.config/opencode/(tool|tools|plugin|plugins|commands?)/', 'global opencode autoload dir'], // 24Z.91: +commands? (global command-template dir)
  ['/opencode/(tool|tools|plugin|plugins|node_modules|commands?)/', 'global opencode autoload/deps'], // 24Z.91: +commands?
  ['(^|/)opencode\\.jsonc?$', 'opencode config (path-plugin declarer)'],
  ['(^|/)\\.husky/', 'git hook (lifecycle code-exec)'],
  ['(^|/)bunfig\\.toml$', 'bun preload/install-script policy'],
  ['(^|/)packages/[^/]+/scripts?/([^/]+/)*[^/]+$', 'lab lifecycle/build script body'],
  ['(^|/)packages/[^/]+/tsconfig(\\.[a-z0-9-]+)?\\.json$', 'per-package tsconfig'],
  ['(^|/)\\.vscode/(tasks|launch|settings|extensions)\\.json$', 'VS Code config'],
  ['(^|/)\\.zed/(settings|tasks)\\.json$', 'Zed config'],
  ['(^|/)\\.idea/', 'JetBrains project config'],
  ['(^|/)(vite|vitest|rollup|esbuild|playwright|webpack|tsup|rspack|rolldown|turbo|astro|electron-builder|electron\\.vite|drizzle|next|nuxt|svelte|svgo|karma|cypress|app|content)\\.config\\.(ts|mts|cts|js|mjs|cjs|jsx|tsx)$', 'build/test bundler config'],
  ['(^|/)(sst|tauri)\\.config\\.(ts|mts|cts|js|mjs|cjs)$', 'IaC/desktop config'],
  ['(^|/)tauri\\.conf(\\.[a-z0-9]+)?\\.json$', 'tauri.conf lifecycle'],
  ['(^|/)(babel|postcss|tailwind|jest|stylelint|commitlint|lint-staged|prettier|mocha|nyc|ava)\\.config\\.(ts|mts|cts|js|mjs|cjs)$', 'build/lint/test config'],
  ['(^|/)\\.(babelrc|mocharc|stylelintrc|prettierrc)\\.(js|mjs|cjs|ts|mts)$', 'executable rc config'],
  ['(^|/)eslint\\.config\\.(js|mjs|cjs|ts|mts)$', 'eslint flat-config'],
  ['(^|/)\\.pnpmfile\\.cjs$', 'pnpm install hook'],
  ['(^|/)\\.envrc$', 'direnv .envrc'],
  ['(^|/)turbo\\.json$', 'turbo pipeline'],
  ['(^|/)\\.pre-commit-config\\.yaml$', 'pre-commit hook config'],
  ['(^|/)\\.(npmrc|yarnrc)$|(^|/)\\.yarnrc\\.yml$', 'package-manager registry/yarnPath config'],
  ['(^|/)\\.gitattributes$', 'git clean/smudge/diff filters'],
  ['(^|/)(opencode-dev|tauri-womb|node-template)/([^/]+/)*scripts?/([^/]+/)*[^/]+$', 'lab build/release script body'],
  ['(^|/)\\.?mise(/[^/]+)?\\.toml$|(^|/)\\.config/mise/config\\.toml$|(^|/)\\.tool-versions$', 'mise/asdf config'],
  ['(^|/)\\.yarn/(releases|plugins)/[^/]+\\.(cjs|js|mjs)$', 'yarn berry yarnPath/plugin code'],
  ['(^|/)\\.devcontainer/|(^|/)devcontainer\\.json$', 'devcontainer config'],
  ['(^|/)(pre-commit|prepare-commit-msg|commit-msg|post-commit|pre-rebase|post-checkout|post-merge|pre-merge-commit|post-rewrite|pre-push|applypatch-msg|pre-applypatch|post-applypatch|sendemail-validate)$', 'git hook script (any hooksPath)'],
  ['(^|/)\\.storybook/[^/]+\\.(ts|mts|cts|js|mjs|cjs|jsx|tsx)$', 'storybook config'],
  ['(^|/)(vitest|jest)\\.(config|workspace|setup|projects)\\.(ts|mts|cts|js|mjs|cjs|jsx|tsx)$', 'vitest/jest config/workspace/setup'],
  // 88f-confirm #2/#3/#15 — executable/auto-spawned tool caches the HOST process re-runs verbatim with NO integrity check
  ['(^|/)\\.cache/[^/]+/bin(/|$)', 'cached tool binary dir (host re-spawns — auto-exec)'],
  ['(^|/)\\.cache/(convex|opencode)(/|$)', 'aukora tool cache (re-spawned backend/ripgrep binary)'],
  ['(^|/)Library/Caches/[^/]+/bin(/|$)', 'cached tool binary dir (auto-exec)'],
  ['(^|/)\\.local/(share|state)/(.*/)?bin(/|$)', 'XDG data-home tool binary dir (pipx/pnpm re-spawns — auto-exec)'], // 88f-confirm r2 #8
  ['(^|/)(setup\\.py|setup\\.cfg|pyproject\\.toml)$', 'python build config (pip install . execs its build backend)'], // 88f-confirm r2 #3
  // 88f-confirm #10/#11/#14 — autorun/exec-config coverage gaps the bundler-config set missed
  ['(^|/)\\.eslintrc\\.(js|cjs|mjs|ts|cts|mts)$', 'eslint legacy rc executable form (declarative .json/.yml stay writable)'],
  ['(^|/)(conftest\\.py|sitecustomize\\.py|usercustomize\\.py)$', 'python startup/test autorun hook (auto-imported)'],
  ['(^|/)(gulpfile|Gruntfile|gruntfile)\\.(js|mjs|cjs|ts)$', 'gulp/grunt task runner body'],
  ['(^|/)karma\\.conf\\.(js|mjs|cjs|ts)$', 'karma config body (executed at test)'],
  ['(^|/)\\.(zshenv|zshrc|zprofile|zlogin|zlogout|bashrc|bash_profile|bash_login|bash_logout|bash_aliases|profile|kshrc|cshrc|tcshrc|login|inputrc|xinitrc|xprofile)$', 'shell rc/profile'],
  ['(^|/)\\.gitconfig$|(^|/)\\.config/git/config$', 'git config (exec-keys)'],
  ['(^|/)\\.(vimrc|gvimrc|ideavimrc|tmux\\.conf|screenrc|digrc|curlrc|wgetrc|gdbinit|lldbinit|editrc|nanorc)$', 'editor/tool rc'],
  ['(^|/)\\.config/(nvim|fish|nushell|tmux|zsh|starship\\.toml|direnv)(/|$)', 'editor/shell config dir'],
  ['(^|/)\\.(oh-my-zsh|zsh\\.d|bashrc\\.d|bash_completion\\.d|zprofile\\.d)(/|$)', 'shell plugin/fragment dir'],
  ['(^|/)Library/Launch(Agents|Daemons)/', 'launchd autorun plist'],
  ['com\\.apple\\.loginitems', 'login item'],
  ['(^|/)\\.config/autostart/', 'XDG autostart'],
];

// ── WRITE-allow roots (deny-by-default): scratch + tool caches the model legitimately writes OUTSIDE its workspace. The
//    workspace root itself is added dynamically (the cage gets the spawn cwd; the classifier gets md.cwd). Everything ELSE
//    outside these (home dotfiles, all configs, other repos, /etc) is denied — no list to be incomplete, only the destination.
export const WRITE_ALLOW_ROOTS = ['/tmp/', '/private/tmp/', '/dev/']; // 88f-confirm #9 — /var/folders narrowed to its T leaf (below); C=Caches/0=daemon-state no longer blanket-writable
export const WRITE_ALLOW_CACHE_SOURCES = [
  '/\\.cache/', '/\\.npm/(_cacache|_logs)', '/\\.bun/(install|cache)', '/\\.cargo/(registry|git|\\.package-cache)', '/\\.rustup/',
  '/\\.pnpm-store/', '/\\.yarn/(cache|berry/cache)', '/\\.local/(state|share)/(pnpm|pipx|virtualenvs|uv|gem|cabal|cache|containers/storage|fnm|rtx|mise)(/|$)', '/\\.deno/(deps|gen|npm)', '/\\.gradle/(caches|wrapper)', '/Library/Caches/', // 88f-confirm r3 #13 — .local narrowed to package stores
  '/(private/)?var/folders/[^/]+/[^/]+/T(/|$)', // 88f-confirm #9 — only the T scratch leaf, not C (caches) / 0 (daemon state)
];

// 88f-confirm r2 #11 — the CHILD-ENV allowlist, single-sourced (was hand-duplicated in egress-sandbox.ts AND the shell-env patcher
// → drift risk). Safe infrastructure vars only; everything else (provider keys, AUKORA_*, tokens) is stripped from model child envs.
// BOTH the kernel-cage safeChildEnv AND the in-process shell/pty env-strip derive from this ONE source.
export const ENV_ALLOW_SOURCE = '^(PATH|HOME|PWD|OLDPWD|SHELL|USER|LOGNAME|LANG|LANGUAGE|LC_[A-Z]+|TERM|TERMINFO|COLORTERM|TMPDIR|TZ|COLUMNS|LINES|HOSTNAME|DISPLAY|NO_COLOR|FORCE_COLOR|XDG_[A-Z_]+)$';
export function envAllowRegex(): RegExp { return new RegExp(ENV_ALLOW_SOURCE); }

// Build classifier RegExp (case-insensitive — a case-variant spelling on the case-insensitive FS must not slip).
export function readDenyRegexes(): Array<[RegExp, string]> {
  return READ_DENY_SOURCES.map(([s, l]) => [new RegExp(s, 'i'), l]);
}
export function writeProtectRegexes(): Array<[RegExp, string]> {
  return WRITE_PROTECT_SOURCES.map(([s, l]) => [new RegExp(s, 'i'), l]);
}

// Transform a JS-regex SOURCE into a Seatbelt SBPL regex literal. SBPL matches the ABSOLUTE path, so the `(^|/)` path-boundary
// becomes a literal `/`; `\\` stays; `"` is forbidden inside #"…" (our sources have none). Returns the inner pattern (no #"").
function toSbpl(src: string): string {
  return src.replace(/\(\^\|\/\)/g, '/'); // path-boundary → leading slash (abs path)
}
// 88f-confirm #1 — Seatbelt's SBPL regex literal PARSES some JS escapes but does NOT honor them: it read `\b` as a backspace
// (cat -v showed ^H), silently killing the whole alternative in the KERNEL cage while it stayed live in the JS-RegExp classifier
// — a one-way under-block (cage allowed an authority path the classifier denied). My earlier "does \b parse?" probe was the wrong
// test (it parses fine; it just never MATCHES). This detector lists every source using a construct the cage can't honor; the
// round-trip cage-honor test asserts it is EMPTY, so no future pattern can pass the classifier yet die in the cage. Honored: `\.`,
// `(?:…)`, `$`, `^`, char classes, alternation, `*`/`+`/`?`. NOT honored: `\b \B \d \D \w \W \s \S`, lookaround, backrefs.
const SBPL_INCOMPATIBLE = /\\[bBdDwWsS1-9]|\(\?[=!<]/;
export function findSbplIncompatible(): Array<[string, string]> {
  return [...READ_DENY_SOURCES, ...WRITE_PROTECT_SOURCES, ...SOCKET_DENY_SOURCES, ...WRITE_ALLOW_CACHE_SOURCES.map((s) => [s, 'cache-allow'] as [string, string])]
    .filter(([s]) => SBPL_INCOMPATIBLE.test(s));
}
// Build a full `(deny <op> (regex #"…") …)` SBPL clause from a set of sources.
export function sbplDeny(op: 'file-read*' | 'file-write*', sources: Array<[string, string]>): string {
  const clauses = sources.map(([s]) => '(regex #"' + toSbpl(s) + '")').join(' ');
  return '(deny ' + op + ' ' + clauses + ')';
}
// 88f-confirm r3 #7/#12 — the cage re-allows `(remote unix-socket)` for benign local IPC, but that BLANKET-allows the Docker
// daemon socket (→ spawn a privileged container = full host escape) and the ssh-agent / gpg-agent sockets (sign/decrypt with keys
// the cage can't read). Deny those specific sockets AFTER the unix-socket allow (last-match-wins). SBPL `(remote unix-socket (regex …))` is honored.
export const SOCKET_DENY_SOURCES: Array<[string, string]> = [
  ['docker\\.sock', 'docker daemon socket (container escape)'],
  ['/podman/|podman.*\\.sock|/containerd|buildkit', 'podman/containerd/buildkit socket (container escape)'],
  ['/colima/|/\\.lima/|limactl', 'colima/lima VM socket (container escape)'],
  ['/com\\.apple\\.launchd\\.|Listeners$', 'launchd-vended socket incl. ssh-agent SSH_AUTH_SOCK (key use)'],
  ['S\\.gpg-agent|/gpg-agent', 'gpg-agent socket (decrypt/sign with keys the cage cannot read)'],
];
export function sbplSocketFloor(): string {
  const clauses = SOCKET_DENY_SOURCES.map(([s]) => '(remote unix-socket (regex #"' + s + '"))').join(' ');
  return '(deny network-outbound ' + clauses + ')';
}

// Build the deny-by-default WRITE floor: deny all writes, re-allow the workspace + scratch + caches, then re-deny the
// authority WRITE_PROTECT set on top. `workspaceAbs` is the spawn cwd (already absolute). Order matters (SBPL last-match-wins).
export function sbplWriteFloor(workspaceAbs: string): string {
  // FAIL-OPEN to the old behavior if the workspace is unknown: only re-deny the authority set (no deny-by-default), so a
  // missing cwd can never deny ALL the model's writes. In practice the spawn always has a cwd, so deny-by-default is on.
  if (!workspaceAbs || !workspaceAbs.startsWith('/')) return sbplDeny('file-write*', WRITE_PROTECT_SOURCES);
  const allowRoots = WRITE_ALLOW_ROOTS.map((r) => '(subpath "' + r.replace(/\/$/, '') + '")').join(' ');
  const allowCaches = WRITE_ALLOW_CACHE_SOURCES.map((s) => '(regex #"' + s + '")').join(' ');
  return '(deny file-write*)' +
    '(allow file-write* (subpath "' + workspaceAbs.replace(/\/$/, '') + '") ' + allowRoots + ' ' + allowCaches + ')' +
    sbplDeny('file-write*', WRITE_PROTECT_SOURCES);
}
// Is an absolute write target OUTSIDE the workspace + allow-roots/caches? (classifier deny-by-default for the write tool.)
export function isWriteOutsideWorkspace(absPath: string, workspaceAbs: string): boolean {
  if (!workspaceAbs || !workspaceAbs.startsWith('/')) return false; // FAIL-OPEN: unknown workspace → no deny-by-default (the write-protect list still applies separately)
  if (!absPath.startsWith('/')) return false; // relative → resolved against workspace by the caller; treat as inside
  const p = absPath;
  if (workspaceAbs && workspaceAbs.startsWith('/') && (p === workspaceAbs || p.startsWith(workspaceAbs.replace(/\/$/, '') + '/'))) return false;
  for (const r of WRITE_ALLOW_ROOTS) if (p.startsWith(r) || p === r.replace(/\/$/, '')) return false;
  for (const s of WRITE_ALLOW_CACHE_SOURCES) if (new RegExp(s, 'i').test(p)) return false;
  return true;
}
