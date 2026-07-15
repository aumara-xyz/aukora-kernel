import { PoP, signPoP, getTestPublicKey, hash } from '../src/crypto';
import { PrincipalRegistry } from '../src/index';
import { randomUUID } from 'crypto';
import { normalizeProposal } from '../src/normalizer';

// LOCAL_TEST_ANCHOR 
// NOT FULL AUMLOK CEREMONY
// NOT PRODUCTION IDENTITY
export function createLocalTestAnchorPoP(): PoP {
  const seed = "1111111111111111111111111111111111111111111111111111111111111111"; // strictly test identity
  const pubKey = getTestPublicKey(seed);
  const principalId = 'LOCAL_TEST_ANCHOR';
  
  PrincipalRegistry.set(principalId, pubKey);

  const intent = normalizeProposal({
    action: 'read_file',
    resource: 'data.txt',
    ring: 'local'
  });

  const argsHash = hash(JSON.stringify(intent));

  return signPoP(seed, {
    principalId,
    methodId: 'evaluateIntent',
    argsHash,
    nonce: randomUUID()
  });
}
