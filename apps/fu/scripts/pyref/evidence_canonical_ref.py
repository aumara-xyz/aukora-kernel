# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aukora
# Independent Python reference for EvidencePack v1 canonical bytes, packDigest, and fence nonce
# (contract decision 17). Not imported by the package; a cross-runtime conformance oracle.
import hashlib, json, struct

PACK_DOMAIN = b'aukora-fu-evidence-pack-v1'
FENCE_DOMAIN = 'aukora-fu-evidence-fence-v1'

def canonical(value) -> str:
    # JCS-aligned for the accepted closed domain (ASCII keys, safe-int numbers, JSON string escaping).
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def pack_digest(body) -> str:
    c = canonical(body).encode('utf-8')
    pre = PACK_DOMAIN + b'\x00' + struct.pack('>Q', len(c)) + c
    return hashlib.sha256(pre).hexdigest()

def fence_nonce(pack_digest_hex: str, contents) -> str:
    for counter in range(100000):
        nonce = hashlib.sha256(f'{FENCE_DOMAIN}|{pack_digest_hex}|{counter}'.encode('utf-8')).hexdigest()
        toks = [f'<<AUKORA-DATA:{nonce}>>', f'<<AUKORA-END:{nonce}>>']
        if all(all(t not in c for t in toks) for c in contents):
            return nonce
    raise RuntimeError('E_FENCE_NONCE')

SECRET_CATALOGUE = {
    "schema": "aukora-fu-secret-catalogue-v3",
    "patterns": [
        {"id": "openrouter-key", "pattern": "sk-or-[A-Za-z0-9_\\-]{16,}", "flags": "g"},
        {"id": "openai-key", "pattern": "sk-[A-Za-z0-9]{20,}", "flags": "g"},
        {"id": "aws-access-key-id", "pattern": "AKIA[0-9A-Z]{16}", "flags": "g"},
        {"id": "pem-private-key", "pattern": "-----BEGIN [A-Z ]{0,64}PRIVATE KEY-----", "flags": "g"},
        {"id": "env-secret-assign", "pattern": "(?:API|SECRET|TOKEN|PASSWORD|PRIVATE)[A-Z0-9_]{0,64}\\s*=\\s*\\S{8,4096}", "flags": "gi"},
        {"id": "github-token", "pattern": "(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}", "flags": "g"},
        {"id": "slack-token", "pattern": "xox[baprs]-[A-Za-z0-9-]{10,}", "flags": "g"},
        {"id": "google-api-key", "pattern": "AIza[A-Za-z0-9_\\-]{35}", "flags": "g"},
        {"id": "stripe-key", "pattern": "sk_(?:live|test)_[A-Za-z0-9]{16,}", "flags": "g"},
        {"id": "npm-token", "pattern": "npm_[A-Za-z0-9]{30,}", "flags": "g"},
        {"id": "gitlab-pat", "pattern": "glpat-[A-Za-z0-9_\\-]{16,}", "flags": "g"},
        {"id": "anthropic-key", "pattern": "sk-ant-[A-Za-z0-9_\\-]{20,}", "flags": "g"},
        {"id": "sendgrid-key", "pattern": "SG\\.[A-Za-z0-9_\\-]{16,512}\\.[A-Za-z0-9_\\-]{16,}", "flags": "g"},
        {"id": "azure-account-key", "pattern": "AccountKey=[A-Za-z0-9+/]{40,}={0,2}", "flags": "g"},
    ],
    # D4: url-userinfo moved to the bounded linear scanUrlUserinfo (was an O(n^2) ReDoS regex). Listed here
    # so catalogueId binds it. The Python oracle only reproduces catalogueId/digests, not detection, so it
    # simply mirrors this field.
    "scanners": ["url-userinfo-v1", "jwt-v1"],
    "confusables": {
        "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x",
        "ѕ": "s", "і": "i", "ј": "j", "һ": "h", "ԁ": "d", "ԛ": "q",
        "ɡ": "g", "ο": "o", "Α": "A", "Β": "B", "Ε": "E", "Κ": "K",
        "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X",
    },
    "zeroWidth": ["​", "‌", "‍", "⁠", "﻿"],
}

def catalogue_id() -> str:
    return hashlib.sha256(canonical(SECRET_CATALOGUE).encode('utf-8')).hexdigest()

def _fresh():
    return {
        "schema": "aukora-fu-evidence-pack-v1", "advisoryOnly": True, "grantsAuthority": False,
        "repoId": "aumara-xyz/aukora-fu", "headCommit": "a"*40, "headTree": "b"*40,
        "baseCommit": None, "baseTree": None, "files": [], "omissions": [], "testRuns": [],
        "rootAllowlist": [], "limitsProfileId": "default-v1",
        "builderToolVersions": {"node": "v22.23.0"}, "catalogueId": catalogue_id(),
    }

def minimal_body():
    return _fresh()

def maximal_body():
    SHA_HELLO = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    SHA_ZEROS3 = "709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c"
    SHA_EMPTY = hashlib.sha256(b"").hexdigest()
    b = _fresh()
    b["files"] = [
        {"path": "a.ts", "kind": "text", "originalSizeBytes": 5, "includedByteStart": 0, "includedByteEnd": 5,
         "truncated": False, "fullSha256": SHA_HELLO, "includedSha256": SHA_HELLO, "encoding": "utf8", "content": "hello"},
        {"path": "b.png", "kind": "binary", "originalSizeBytes": 3, "includedByteStart": 0, "includedByteEnd": 3,
         "truncated": False, "fullSha256": SHA_ZEROS3, "includedSha256": SHA_ZEROS3, "encoding": "base64", "content": "AAAA"},
    ]
    b["omissions"] = [{"path": "secret.env", "reason": "secret-file", "originalSizeBytes": None, "sha256": None}]
    b["testRuns"] = [{"command": ["npm", "run", "verify"], "cwdRelative": ".", "exitCode": 0,
                      "stdoutSha256": SHA_EMPTY, "stderrSha256": SHA_EMPTY, "stdoutBytes": 0, "stderrBytes": 0,
                      "stdoutExcerpt": "", "stderrExcerpt": "", "durationMs": None, "toolVersions": {}}]
    b["rootAllowlist"] = ["a.ts", "b.png", "secret.env"]
    return b

if __name__ == '__main__':
    import sys
    KAT = {
        "CATALOGUE_ID": "1504a1587d9464712076f331fda35327f4ba14fa9d9a260d1ac0285aade07aa7",
        "MIN_DIGEST": "84e9b48d33e007101157f42dac7b0d05befb8a88f8812384ef95485fced862d2",
        "MAX_DIGEST": "03cf93eb0f97d3fde24963aa409e272ef1d8cafcceb46e534412fa32a63112e1",
        "FENCE": "3a23cb4c6895e0ca934a95f328985122a706ccf9d9188a2897e9fbef158acc28",
    }
    got = {
        "CATALOGUE_ID": catalogue_id(),
        "MIN_DIGEST": pack_digest(minimal_body()),
        "MAX_DIGEST": pack_digest(maximal_body()),
        "FENCE": fence_nonce("00"*32, ["hello", "world"]),
    }
    ok = True
    for k, want in KAT.items():
        status = "OK" if got[k] == want else "MISMATCH"
        if got[k] != want:
            ok = False
        print(f"{status:8} {k}={got[k]}")
    print("PYTHON_REFERENCE:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)
