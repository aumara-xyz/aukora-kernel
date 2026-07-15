/**
 * 24Z.35 — Builder-origin signature for the runtime truth manifest (LAB tier; Ed25519).
 *
 * Turns the manifest from "validated JSON" into "builder-origin verified truth". This is BUILDER-ORIGIN attestation
 * ONLY — it proves the manifest was produced by the build process and not tampered afterward. HARD LAWS:
 *   - This is NOT production AUMLOK, NOT Peter's authority key, NOT live-apply authorization.
 *   - The signature GRANTS NO AUTHORITY (`manifestCanAuthorize` is always false).
 *   - `manifestSignerMode` is 'lab_builder_manifest'; `productionManifestSigner` is false.
 * RESIDUAL (documented): the lab builder key lives in a gitignored local file; production needs a secret-store key.
 * FIREWALL: imports no gate/apply/OpenCode/permit code; it is a builder-origin attestation, not the authority signer.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { canonicalManifestPayload } from './manifestCanonical';

export interface BuilderSignature {
  mode: 'lab_builder_manifest';
  algo: 'ed25519';
  signatureHex: string;
  publicKeyHex: string;          // raw 32-byte Ed25519 public key (hex) — self-describing; verifier pins the fingerprint
  fingerprint: string;           // sha256(publicKeyHex).slice(0,16) — the pinned builder identity
  payloadSha256: string;         // sha256 of the canonical payload (display/debug; the signature is authoritative)
  grantsAuthority: false;        // HARD
}

export interface LabBuilderKey { publicKeyHex: string; privateKeyPem: string }

function rawPubHex(pub: crypto.KeyObject): string {
  const jwk = pub.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('hex');
}
function publicKeyFromRawHex(hex: string): crypto.KeyObject {
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(hex, 'hex').toString('base64url') } as crypto.JsonWebKey, format: 'jwk' });
}
export function fingerprint(publicKeyHex: string): string {
  return crypto.createHash('sha256').update(publicKeyHex).digest('hex').slice(0, 16);
}

export function generateLabBuilderKey(): LabBuilderKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKeyHex: rawPubHex(publicKey), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
}

/** Load the lab builder key from a gitignored file, or create + persist it on first run. Returns null only if the
 *  directory is unwritable (then the manifest stays UNSIGNED and the app shows it unverified — fail honest). */
export function loadOrCreateLabBuilderKey(dir: string): LabBuilderKey | null {
  const file = path.join(dir, 'manifest-signer-lab.json');
  try {
    if (fs.existsSync(file)) {
      const k = JSON.parse(fs.readFileSync(file, 'utf-8')) as LabBuilderKey;
      if (typeof k.publicKeyHex === 'string' && typeof k.privateKeyPem === 'string') return k;
    }
    const k = generateLabBuilderKey();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(k, null, 2) + '\n');
    return k;
  } catch { return null; }
}

/** Sign the manifest's canonical payload with the lab builder key. Pure given (manifest, key). */
export function signManifest(manifest: unknown, key: LabBuilderKey): BuilderSignature {
  const payload = canonicalManifestPayload(manifest);
  const priv = crypto.createPrivateKey(key.privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, 'utf-8'), priv);   // Ed25519: algorithm null (built-in hash)
  return {
    mode: 'lab_builder_manifest', algo: 'ed25519',
    signatureHex: sig.toString('hex'), publicKeyHex: key.publicKeyHex,
    fingerprint: fingerprint(key.publicKeyHex),
    payloadSha256: crypto.createHash('sha256').update(payload).digest('hex'),
    grantsAuthority: false,
  };
}

export interface ManifestVerifyResult { verified: boolean; reason: string }

/**
 * Verify a manifest against its builder signature, PINNED to an expected fingerprint. Fails closed: a missing
 * signature, a fingerprint mismatch (someone swapped in their own key), a bad signature, or a tampered payload all
 * return verified:false. (Sync Node-crypto path — used by the edge tamper tests; the tauri app uses SubtleCrypto.)
 */
export function verifyManifest(manifest: unknown, sig: BuilderSignature | undefined | null, expectedFingerprint?: string): ManifestVerifyResult {
  if (!sig || typeof sig !== 'object') return { verified: false, reason: 'no builder signature (fails closed)' };
  if (sig.mode !== 'lab_builder_manifest' || sig.algo !== 'ed25519') return { verified: false, reason: 'unsupported signer mode/algo' };
  if (!/^[0-9a-f]+$/i.test(sig.publicKeyHex) || !/^[0-9a-f]+$/i.test(sig.signatureHex)) return { verified: false, reason: 'malformed signature/key hex' };
  if (expectedFingerprint && fingerprint(sig.publicKeyHex) !== expectedFingerprint) return { verified: false, reason: 'public-key fingerprint mismatch (not the pinned builder key)' };
  const payload = canonicalManifestPayload(manifest);
  try {
    const ok = crypto.verify(null, Buffer.from(payload, 'utf-8'), publicKeyFromRawHex(sig.publicKeyHex), Buffer.from(sig.signatureHex, 'hex'));
    return ok ? { verified: true, reason: 'builder signature verified (lab builder manifest key — NOT production AUMLOK)' } : { verified: false, reason: 'signature does not verify (tampered payload or forged signature)' };
  } catch (e) { return { verified: false, reason: `verify error: ${e instanceof Error ? e.message : String(e)}` }; }
}
