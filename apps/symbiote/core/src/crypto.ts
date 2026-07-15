import { createHash } from 'crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils.js';
import { NormalizedIntent } from './normalizer';

export function hash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// --- RFC-6962 Merkle Spine ---
export function hashLeaf(data: string): string {
  const buf = Buffer.concat([Buffer.from([0x00]), Buffer.from(data, 'utf8')]);
  return createHash('sha256').update(buf).digest('hex');
}

export function hashNode(leftHex: string, rightHex: string): string {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  const buf = Buffer.concat([Buffer.from([0x01]), left, right]);
  return createHash('sha256').update(buf).digest('hex');
}

function getLargestPowerOf2(n: number): number {
  let k = 1;
  while ((k << 1) < n) k <<= 1;
  return k;
}

function computeRFC6962Tree(hashes: string[]): string {
  const n = hashes.length;
  if (n === 0) return hashLeaf('');
  if (n === 1) return hashes[0];
  const k = getLargestPowerOf2(n);
  const leftHash = computeRFC6962Tree(hashes.slice(0, k));
  const rightHash = computeRFC6962Tree(hashes.slice(k));
  return hashNode(leftHash, rightHash);
}

// #4a — proof-of-possession provenance recorded ON the receipt. Hashes/fingerprints ONLY: the receipt never
// stores a raw nonce, a signature, or any secret. principalFingerprint = hash(publicKey) (the key is public).
export interface PoPProvenance {
  principalFingerprint: string;
  methodId: string;
  argsHash: string;
  nonceHash: string;
}

export interface Receipt {
  id: string;
  verdict: 'golden_success' | 'noise_dropped' | 'refused';
  intentHash: string;
  normalizedIntent: NormalizedIntent;
  prevHash: string;
  signedHead: string; // ML-DSA signature over the Merkle root
  // v1 auth-provenance (#4a). OPTIONAL so legacy v0 receipts still verify (rollback/migration compatible).
  version?: number;                  // undefined/0 = legacy v0; 1 = provenance-bound
  seq?: number;                      // monotonic sequence number, bound into the id
  provenance?: PoPProvenance | null; // who authorized (golden_success); null when no PoP granted authority
}

export function computeMerkleRoot(receipts: Receipt[]): string {
  if (receipts.length === 0) return hashLeaf('');
  const leafHashes = receipts.map(r => hashLeaf(r.id));
  return computeRFC6962Tree(leafHashes);
}

export function verifyReceiptHistory(receipts: Receipt[], expectedRoot: string): boolean {
  if (!verifyChain(receipts)) return false;
  return computeMerkleRoot(receipts) === expectedRoot;
}

export function canonicalIntentSerialize(intent: NormalizedIntent): string {
  return JSON.stringify({ action: intent.action, resource: intent.resource, ring: intent.ring });
}

export interface ReceiptPreimageExtras { seq?: number; provenance?: PoPProvenance | null; version?: number }

function serializeProvenance(p?: PoPProvenance | null): string {
  return p ? `${p.principalFingerprint}:${p.methodId}:${p.argsHash}:${p.nonceHash}` : 'none';
}

export function hashReceiptPreimage(verdict: string, intent: NormalizedIntent, prevHash: string, extras?: ReceiptPreimageExtras): string {
  const version = extras?.version ?? 0;
  if (version === 0) {
    // legacy v0 preimage — UNCHANGED, so pre-#4a receipts keep their ids (rollback/migration compatible)
    return hash(`${verdict}:${canonicalIntentSerialize(intent)}:${prevHash}`);
  }
  // v1 binds the monotonic sequence number AND the PoP auth-provenance into the receipt id
  return hash(`v1:${extras?.seq ?? 0}:${verdict}:${canonicalIntentSerialize(intent)}:${prevHash}:${serializeProvenance(extras?.provenance)}`);
}

export function generateReceipt(verdict: Receipt['verdict'], intent: NormalizedIntent, intentHash: string, prevHash: string, seq = 0, provenance: PoPProvenance | null = null): Receipt {
  const id = hashReceiptPreimage(verdict, intent, prevHash, { seq, provenance, version: 1 });
  return {
    id,
    verdict,
    intentHash,
    normalizedIntent: intent,
    prevHash,
    signedHead: '', // Mutated post-Merkle compute
    version: 1,
    seq,
    provenance,
  };
}

export function verifyChain(receipts: Receipt[]): boolean {
  if (receipts.length === 0) return true;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    const expectedPrev = i === 0 ? 'genesis_hash' : receipts[i - 1].id;
    if (r.prevHash !== expectedPrev) return false;
    
    // Validate intentHash matches the normalized body
    if (r.intentHash !== hash(canonicalIntentSerialize(r.normalizedIntent))) return false;
    
    // Recompute ID using the shared canonical preimage (version-dispatched: v0 legacy, or v1 w/ seq+provenance).
    // Because each id feeds the next receipt's prevHash, tampering seq/provenance breaks the whole chain.
    const expectedId = hashReceiptPreimage(r.verdict, r.normalizedIntent, r.prevHash, { seq: r.seq, provenance: r.provenance, version: r.version });
    if (r.id !== expectedId) return false;
  }
  return true;
}

// --- Cryptographic PoP & Signed Head ---

export interface PoP {
  principalId: string;
  methodId: string;
  argsHash: string;
  nonce: string;
  signature: string;
  publicKey: string;
}

export function getTestPublicKey(seedHex: string): string {
  return bytesToHex(ml_dsa65.keygen(hexToBytes(seedHex)).publicKey);
}

export function serializeRequestPreimage(pop: Omit<PoP, 'signature' | 'publicKey'>): Uint8Array {
  // Canonical serialization aligned with popResolver.ts
  const payload = `aukora-req-v1|{"argsHash":"${pop.argsHash}","methodId":"${pop.methodId}","nonce":"${pop.nonce}","principalId":"${pop.principalId}"}`;
  return new TextEncoder().encode(payload);
}

export function signPoP(seedHex: string, popWithoutSig: Omit<PoP, 'signature' | 'publicKey'>): PoP {
  const seed = hexToBytes(seedHex);
  const keys = ml_dsa65.keygen(seed);
  const preimage = serializeRequestPreimage(popWithoutSig);
  const context = new TextEncoder().encode("aukora-req-v3");
  const sig = ml_dsa65.sign(preimage, keys.secretKey, { extraEntropy: false, context });
  return {
    ...popWithoutSig,
    signature: bytesToHex(sig),
    publicKey: bytesToHex(keys.publicKey)
  };
}

export function verifyPoP(pop: PoP): boolean {
  try {
    const preimage = serializeRequestPreimage(pop);
    const context = new TextEncoder().encode("aukora-req-v3");
    return ml_dsa65.verify(hexToBytes(pop.signature), preimage, hexToBytes(pop.publicKey), { context });
  } catch {
    return false;
  }
}

export function serializeSignedHead(merkleRootHex: string): Uint8Array {
  const buf = new Uint8Array(33);
  buf[0] = 0x04; // V4 Version
  buf.set(hexToBytes(merkleRootHex), 1);
  return buf;
}

export function signHead(seedHex: string, merkleRootHex: string): string {
  const seed = hexToBytes(seedHex);
  const keys = ml_dsa65.keygen(seed);
  const context = new TextEncoder().encode("aukora-chainhead-v3");
  const preimage = serializeSignedHead(merkleRootHex);
  const sig = ml_dsa65.sign(preimage, keys.secretKey, { extraEntropy: false, context });
  return bytesToHex(sig);
}

export function verifySignedHead(publicKeyHex: string, merkleRootHex: string, sigHex: string): boolean {
  try {
    const context = new TextEncoder().encode("aukora-chainhead-v3");
    const preimage = serializeSignedHead(merkleRootHex);
    return ml_dsa65.verify(hexToBytes(sigHex), preimage, hexToBytes(publicKeyHex), { context });
  } catch {
    return false;
  }
}

// ── Wave 1: domain-separated ML-DSA-65 signer discipline (ported pure from the sibling kernel, written fresh) ──
// ONE registry of immutable signing domains — one frozen label per distinct signing PURPOSE. The FIPS 204
// context bytes are minted from these strings per call (strings are immutable; no caller holds mutable context
// bytes). An attacker-influenced context would require an unknown domain, which REFUSES. Domain non-lifting: a
// signature valid under one domain can never verify under another. Synchronous (the receipt chain is sync by
// invariant). This is the single domain-separated PQC signing chokepoint — no raw ml_dsa signing elsewhere.
export const PQC_DOMAINS = Object.freeze({
  chainHead: 'aukora-chainhead-v3',     // receipt-chain heads (node signing key) — matches signHead
  req: 'aukora-req-v3',                 // per-request PoP signatures — matches signPoP
  cap: 'aukora-cap-v3',                 // capability signatures
  delegation: 'aukora-delegation-v3',   // delegation grants + revocations
  manifest: 'aukora-manifest-v3',       // release-manifest signatures
  // Networked-surface domains — REGISTERED so signatures are domain-separated, but the surfaces stay
  // DEFAULT-OFF / not wired live this wave (no channel/witness/import is live).
  channel: 'aukora-channel-v1',         // confidentiality-channel binding
  witness: 'aukora-witness-v1',         // witness-mesh records
  nodeImport: 'aukora-node-import-v1',  // cross-node import attestations (imported records grant ZERO local authority)
  // AUMLOK owner-authority v2 (#361 P0 — post-quantum convergence). The ML-DSA-65 HALF of the mandatory
  // ed25519+ml-dsa-65 hybrid suite signs owner authorizations under these purpose-separated domains, so an
  // ML-DSA promotion signature can never verify as a lifecycle or migration signature (domain non-lifting).
  aumlokPromotion: 'aumlok-promotion-v2',   // owner promotion authorizations (v2 dual-signed)
  aumlokLifecycle: 'aumlok-lifecycle-v2',   // owner key rotate/revoke (v2 dual-signed)
  aumlokMigration: 'aumlok-migration-v1',   // Ed25519(v1)->hybrid(v2) authority migration proof-of-possession
} as const);
export type PqcDomain = keyof typeof PQC_DOMAINS;

const _pqcEnc = new TextEncoder();
for (const _label of Object.values(PQC_DOMAINS)) {
  const _n = _pqcEnc.encode(_label).length;
  if (_n === 0 || _n > 255) throw new Error(`aukora_pqc_context_len:${_label}`); // FIPS 204 bound, asserted at load
}

const PQC_PUBLIC_KEY_HEX = 1952 * 2;   // ML-DSA-65 public key = 1952 bytes
const PQC_SIGNATURE_HEX = 3309 * 2;    // ML-DSA-65 signature = 3309 bytes
const _pqcHexLower = /^[0-9a-f]+$/;     // wire artifacts are canonical lowercase — exactly one accepted form

// Mint context bytes for a domain; THROW on anything not OWN-registered (so prototype keys refuse too).
function pqcContextBytes(domain: PqcDomain): Uint8Array {
  if (typeof domain !== 'string' || !Object.prototype.hasOwnProperty.call(PQC_DOMAINS, domain)) {
    throw new Error('aukora_pqc_context_unregistered');
  }
  return _pqcEnc.encode(PQC_DOMAINS[domain]);
}

function pqcParseSeed(seedHex: string): Uint8Array {
  if (typeof seedHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(seedHex)) throw new Error('aukora_pqc_seed_invalid');
  return hexToBytes(seedHex.toLowerCase());
}

/** Shape check for a pinned ML-DSA-65 public key (3904 lowercase-hex chars). */
export function isPqcPublicKeyHex(s: unknown): boolean {
  return typeof s === 'string' && s.length === PQC_PUBLIC_KEY_HEX && _pqcHexLower.test(s);
}

/** Derive the ML-DSA-65 public key (hex) from a 32-byte seed (64-hex). ALWAYS seeded (fail-closed). */
export function pqcPublicKeyFromSeed(seedHex: string): string {
  const seed = pqcParseSeed(seedHex);
  try { return bytesToHex(ml_dsa65.keygen(seed).publicKey); } finally { seed.fill(0); }
}

/** Sign message bytes under a NAMED domain. Deterministic (extraEntropy:false). THROWS on bad seed or
 *  unknown domain (fail closed at the signer). The single domain-separated PQC signing chokepoint. */
export function pqcSignWithDomain(seedHex: string, message: Uint8Array, domain: PqcDomain): string {
  const context = pqcContextBytes(domain);
  const seed = pqcParseSeed(seedHex);
  let secretKey: Uint8Array | null = null;
  try {
    secretKey = ml_dsa65.keygen(seed).secretKey;
    return bytesToHex(ml_dsa65.sign(message, secretKey, { extraEntropy: false, context }));
  } finally {
    seed.fill(0);
    secretKey?.fill(0); // best-effort hygiene; GC-era heap copies are an accepted JS residual
  }
}

/** Verify a signature under a NAMED domain. Returns FALSE on any failure (forged/tampered/non-hex/
 *  wrong-length/non-canonical-case/unknown-domain) — never throws. Cheap pre-checks before lattice math. */
export function pqcVerifyWithDomain(publicKeyHex: string, message: Uint8Array, sigHex: string, domain: PqcDomain): boolean {
  try {
    const context = pqcContextBytes(domain);
    if (typeof publicKeyHex !== 'string' || publicKeyHex.length !== PQC_PUBLIC_KEY_HEX || !_pqcHexLower.test(publicKeyHex)) return false;
    if (typeof sigHex !== 'string' || sigHex.length !== PQC_SIGNATURE_HEX || !_pqcHexLower.test(sigHex)) return false;
    return ml_dsa65.verify(hexToBytes(sigHex), message, hexToBytes(publicKeyHex), { context });
  } catch {
    return false;
  }
}
