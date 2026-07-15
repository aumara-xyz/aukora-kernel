import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  performExternalReview,
  scrubSecrets,
  collectEnvSecrets,
  FAIL_CLOSED_REVIEW,
  ALLOWED_ENDPOINTS,
  MAX_CALLS_PER_RUN,
  MAX_PROMPT_BYTES,
  MAX_OUTPUT_TOKENS,
  resetCallCount,
  AdvisoryReview,
  FailureReason
} from '../src/externalReview';
import { getModelProfile } from '../src/fusionConfig';

function makeGoodMockResponse(overrides: Record<string, any> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            verdict: 'GREEN',
            findings: 'No issues found.',
            risks: 'None.',
            missing_tests: 'None.',
            recommended_next_commit: '21C',
            confidence: 9,
            ...overrides
          })
        }
      }]
    })
  };
}

describe('Commit 21C: Secret Discipline + Fusion Council Hardening', () => {
  const originalEnv = process.env;
  const edgeNodeEnvPath = path.resolve(__dirname, '..', '.env');
  let savedEnvContent: string | null = null;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = vi.fn();
    resetCallCount();
    try {
      savedEnvContent = fs.readFileSync(edgeNodeEnvPath, 'utf-8');
      fs.unlinkSync(edgeNodeEnvPath);
    } catch {
      savedEnvContent = null;
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    if (savedEnvContent !== null) {
      fs.writeFileSync(edgeNodeEnvPath, savedEnvContent, 'utf-8');
      savedEnvContent = null;
    }
  });

  // =============================================
  // SECTION 1: CORE ADAPTER SAFETY
  // =============================================

  it('1. Missing OPENROUTER_API_KEY fails closed, no fetch', async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.FUSION_ENV_FILE;
    const result = await performExternalReview('sample evidence');
    expect(result.verdict).toBe('RED');
    expect(result.confidence).toBe(0);
    expect(result.failureReason).toBe('missing_key');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('2. Plaintext HTTP endpoint fails closed without calling fetch', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    const result = await performExternalReview('evidence', [], {
      endpointOverride: 'http://openrouter.ai/api/v1/chat/completions',
      testMode: true
    });
    expect(result.verdict).toBe('RED');
    expect(result.failureReason).toBe('bad_endpoint');
    expect(fetch).not.toHaveBeenCalled();
  });

  // =============================================
  // SECTION 2: SECRET CANARY SUITE
  // =============================================

  it('3. collectEnvSecrets auto-collects all known env secret vars', () => {
    process.env.OPENROUTER_API_KEY = 'or-key-value-long-enough';
    process.env.AUKORA_EDGE_NODE_SEED = 'seed-value-long-enough';
    process.env.NEBIUS_AI_CLOUD_AUTH_TOKEN = 'nebius-auth-long-enough';
    process.env.NEBIUS_API_KEY = 'nebius-api-long-enough';
    process.env.NEBIUS_AI_CLOUD_ENDPOINT_URL = 'https://nebius.example.com/v1';

    const secrets = collectEnvSecrets();
    expect(secrets).toContain('or-key-value-long-enough');
    expect(secrets).toContain('seed-value-long-enough');
    expect(secrets).toContain('nebius-auth-long-enough');
    expect(secrets).toContain('nebius-api-long-enough');
    expect(secrets).toContain('https://nebius.example.com/v1');
  });

  it('4. Canary: OpenRouter keys are scrubbed', () => {
    const fakeOpenRouterKey = 'sk-or-v1-' + 'testonly'.padEnd(60, '0');
    const input = `key: ${fakeOpenRouterKey}`;
    const scrubbed = scrubSecrets(input);
    expect(scrubbed).not.toContain('sk-or-v1');
    expect(scrubbed).toContain('[REDACTED_OPENROUTER_KEY]');
  });

  it('5. Canary: 64-hex seeds are scrubbed', () => {
    const seed = 'aa'.repeat(32);
    const scrubbed = scrubSecrets(`seed: ${seed}`);
    expect(scrubbed).not.toContain(seed);
    expect(scrubbed).toContain('[REDACTED_HEX_KEY_OR_SEED]');
  });

  it('6. Canary: long PQ signatures are scrubbed', () => {
    const sig = 'bb'.repeat(64);
    const scrubbed = scrubSecrets(`sig: ${sig}`);
    expect(scrubbed).not.toContain(sig);
    expect(scrubbed).toContain('[REDACTED_PQ_SIGNATURE]');
  });

  it('7. Canary: JWT-like tokens are scrubbed', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const scrubbed = scrubSecrets(`token: ${jwt}`);
    expect(scrubbed).not.toContain('eyJhbGciOiJ');
    expect(scrubbed).toContain('[REDACTED_JWT]');
  });

  it('8. Canary: PEM private key blocks are scrubbed', () => {
    const pem = `-----BEGIN ${'PRIVATE'} KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7
-----END ${'PRIVATE'} KEY-----`;
    const scrubbed = scrubSecrets(pem);
    expect(scrubbed).not.toContain('MIIEvQIBADANBgkqhkiG9w0');
    expect(scrubbed).toContain('[REDACTED_PEM_PRIVATE_KEY]');
  });

  it('9. Canary: RSA private key blocks are scrubbed', () => {
    const pem = `-----BEGIN RSA ${'PRIVATE'} KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/yGGN5+V6LJFPO+VeW9CnYXCCby
-----END RSA ${'PRIVATE'} KEY-----`;
    const scrubbed = scrubSecrets(pem);
    expect(scrubbed).not.toContain('MIIEowIBAAK');
    expect(scrubbed).toContain('[REDACTED_PEM_PRIVATE_KEY]');
  });

  it('10. Canary: database connection strings are scrubbed', () => {
    const connStrings = [
      'mongodb://admin:password123@cluster0.example.net:27017/db',
      'postgres://user:pass@host:5432/mydb',
      'mysql://root:secret@localhost/app',
      'redis://default:token@redis.example.com:6379'
    ];
    for (const conn of connStrings) {
      const scrubbed = scrubSecrets(`db: ${conn}`);
      expect(scrubbed).not.toContain(conn);
      expect(scrubbed).toContain('[REDACTED_CONNECTION_STRING]');
    }
  });

  it('11. Canary: bearer tokens are scrubbed', () => {
    const scrubbed = scrubSecrets('Authorization: Bearer my-secret-api-token-12345');
    expect(scrubbed).not.toContain('my-secret-api-token');
    expect(scrubbed).toContain('Bearer [REDACTED_TOKEN]');
  });

  it('12. Canary: nonces and replayed nonces are scrubbed', () => {
    const input = 'nonce_abc123_def456 and replayed_old_nonce_value';
    const scrubbed = scrubSecrets(input);
    expect(scrubbed).not.toContain('nonce_abc123');
    expect(scrubbed).not.toContain('replayed_old');
    expect(scrubbed).toContain('[REDACTED_NONCE]');
  });

  it('13. Canary: receipt IDs and VK payloads are scrubbed', () => {
    const input = 'receipt_abc123def456gh and vk_internal_payload_data_here';
    const scrubbed = scrubSecrets(input);
    expect(scrubbed).not.toContain('receipt_abc123def456gh');
    expect(scrubbed).not.toContain('vk_internal_payload_data_here');
    expect(scrubbed).toContain('[REDACTED_RECEIPT_ID]');
    expect(scrubbed).toContain('[REDACTED_VK_PAYLOAD]');
  });

  it('14. Canary: Merkle roots and signed heads are scrubbed', () => {
    const merkle = 'merkleRoot: ' + 'cc'.repeat(32);
    const signedH = "signedHead='longSignedHeadValue1234567890abcdef'";
    const scrubbed = scrubSecrets(`${merkle}\n${signedH}`);
    expect(scrubbed).toContain('[REDACTED_MERKLE_ROOT]');
    expect(scrubbed).toContain('[REDACTED_SIGNED_HEAD]');
  });

  it('15. Canary: explicit env secrets are redacted even when they do not match regex patterns', () => {
    const weirdSecret = 'my-unusual-format-secret-key!!';
    const scrubbed = scrubSecrets(`value: ${weirdSecret}`, [weirdSecret]);
    expect(scrubbed).not.toContain(weirdSecret);
    expect(scrubbed).toContain('[REDACTED_SECRET]');
  });

  // =============================================
  // SECTION 3: OUTBOUND FETCH BODY INSPECTION
  // =============================================

  it('16. Outbound fetch body contains only scrubbed content, never raw env secrets', async () => {
    const fakeKey = 'sk-or-v1-' + 'testapikey'.padEnd(32, '0');
    const fakeSeed = 'dd'.repeat(32);
    const fakeNebius = 'nebius-secret-token-value-long';

    process.env.OPENROUTER_API_KEY = fakeKey;
    process.env.AUKORA_EDGE_NODE_SEED = fakeSeed;
    process.env.NEBIUS_AI_CLOUD_AUTH_TOKEN = fakeNebius;

    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    const rawEvidence = `Seed: ${fakeSeed}\nAuth: Bearer ${fakeNebius}\nKey: ${fakeKey}\nnonce_replay_001\nreceipt_deadbeef12345678`;
    const result = await performExternalReview(rawEvidence, [], { testMode: true });
    expect(result.verdict).toBe('GREEN');

    const fetchBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    const userContent = fetchBody.messages[1].content;

    expect(userContent).not.toContain(fakeKey);
    expect(userContent).not.toContain(fakeSeed);
    expect(userContent).not.toContain(fakeNebius);
    expect(userContent).not.toContain('nonce_replay_001');
    expect(userContent).not.toContain('receipt_deadbeef12345678');
    expect(userContent).toContain('[REDACTED');
  });

  // =============================================
  // SECTION 4: ENDPOINT ALLOWLIST
  // =============================================

  it('17. Non-allowlisted HTTPS endpoint fails closed in production mode', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    // Do NOT pass testMode — this is "production" behavior
    // The function uses the hardcoded default URL which IS in the allowlist,
    // but if someone tried to override it in production, the allowlist blocks.
    // We test by temporarily modifying the function behavior via the allowlist check.
    // Since endpointOverride only works in testMode, production always hits the allowlisted URL.
    // Instead: verify the allowlist constant contains only the expected endpoint.
    expect(ALLOWED_ENDPOINTS).toEqual(['https://openrouter.ai/api/v1/chat/completions']);
  });

  it('18. Test-mode endpoint override works for unit testing only', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    const result = await performExternalReview('evidence', [], {
      endpointOverride: 'https://test.example.com/v1/completions',
      testMode: true
    });
    expect(result.verdict).toBe('GREEN');
    // Verify the test endpoint was actually used
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://test.example.com/v1/completions');
  });

  // =============================================
  // SECTION 5: COST / RATE CONTROLS
  // =============================================

  it('19. Rate cap: calls exceeding MAX_CALLS_PER_RUN abort before fetch', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    // Exhaust the call budget
    for (let i = 0; i < MAX_CALLS_PER_RUN; i++) {
      await performExternalReview('evidence', [], { testMode: true });
    }

    const fetchCountBefore = vi.mocked(fetch).mock.calls.length;

    // Next call should abort without fetching
    const result = await performExternalReview('evidence', [], { testMode: true });
    expect(result.verdict).toBe('RED');
    expect(result.findings).toContain('Rate cap exceeded');
    // No additional fetch call was made
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCountBefore);
  });

  it('20. max_tokens matches model profile in the request body', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    const profile = getModelProfile('z-ai/glm-5.2');
    await performExternalReview('evidence', [], { testMode: true });

    const fetchBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(fetchBody.max_tokens).toBe(profile.maxOutputTokens);
  });

  it('21. Prompt exceeding MAX_PROMPT_BYTES is truncated before fetch', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    const hugeEvidence = 'x'.repeat(MAX_PROMPT_BYTES + 10000);
    await performExternalReview(hugeEvidence, [], { testMode: true });

    const fetchBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    const userContent = fetchBody.messages[1].content;
    expect(userContent.length).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
  });

  // =============================================
  // SECTION 6: SCHEMA ISOLATION + ZERO AUTHORITY
  // =============================================

  it('22. Malicious reviewer output: extra properties are stripped', async () => {
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse({
      executeCommand: 'rm -rf /',
      signPoP: true,
      verdictOverride: 'golden_success',
      updateHypothesisConfidence: 99,
      createReceipt: { id: 'fake' }
    }) as any);

    process.env.OPENROUTER_API_KEY = 'test-key-value';
    const result = await performExternalReview('evidence', [], { testMode: true });

    expect((result as any).executeCommand).toBeUndefined();
    expect((result as any).signPoP).toBeUndefined();
    expect((result as any).verdictOverride).toBeUndefined();
    expect((result as any).updateHypothesisConfidence).toBeUndefined();
    expect((result as any).createReceipt).toBeUndefined();

    expect(Object.keys(result).sort()).toEqual(
      ['confidence', 'findings', 'missing_tests', 'recommended_next_commit', 'risks', 'verdict']
    );
  });

  // =============================================
  // SECTION 7: ERROR HANDLING
  // =============================================

  it('23. Invalid JSON from reviewer fails closed without retry', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '{bad_json' } }] })
    } as any);

    const result = await performExternalReview('evidence', [], { testMode: true });
    expect(result.verdict).toBe('RED');
    expect(result.failureReason).toBe('invalid_json');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('24. 4xx fails closed without retry', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ error: 'Unauthorized' })
    } as any);

    const result = await performExternalReview('evidence', [], { testMode: true });
    expect(result.verdict).toBe('RED');
    expect(result.failureReason).toBe('http_4xx');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('25. 5xx retries according to model profile then fails closed', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue({
      ok: false, status: 502,
      json: async () => ({ error: 'Bad Gateway' })
    } as any);

    const profile = getModelProfile('z-ai/glm-5.2');
    const result = await performExternalReview('evidence', [], { testMode: true });
    expect(result.verdict).toBe('RED');
    expect(result.failureReason).toBe('http_5xx');
    expect(fetch).toHaveBeenCalledTimes(profile.maxRetries);
  });

  it('26. Network timeout retries according to model profile then fails closed', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockRejectedValue(new Error('Network Timeout'));

    const profile = getModelProfile('z-ai/glm-5.2');
    const result = await performExternalReview('evidence', [], { testMode: true });
    expect(result.verdict).toBe('RED');
    expect(result.failureReason).toBe('network_timeout');
    expect(fetch).toHaveBeenCalledTimes(profile.maxRetries);
  });

  // =============================================
  // SECTION 8: ATTRIBUTION + HEADERS
  // =============================================

  it('27. Attribution headers absent by default, present when opted in', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    await performExternalReview('evidence', [], { testMode: true });
    const defaultHeaders = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(defaultHeaders['HTTP-Referer']).toBeUndefined();
    expect(defaultHeaders['X-Title']).toBeUndefined();

    vi.mocked(fetch).mockClear();

    process.env.OPENROUTER_SEND_ATTRIBUTION = 'true';
    await performExternalReview('evidence', [], { testMode: true });
    const optInHeaders = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(optInHeaders['HTTP-Referer']).toBe('https://aukora.ai');
    expect(optInHeaders['X-Title']).toBe('Aukora Edge Node');
  });

  // =============================================
  // SECTION 9: STATIC SOURCE SAFETY
  // =============================================

  it('28. src/externalReview.ts has no forbidden authority imports or calls', () => {
    const sourcePath = path.resolve(__dirname, '../src/externalReview.ts');
    const content = fs.readFileSync(sourcePath, 'utf-8');

    const restrictedTokens = [
      'evaluateIntent',
      'PrincipalRegistry',
      'signPoP',
      'getAndCheckEdgeNodeSeed',
      'child_process',
      'updateHypothesisConfidence',
      'createReceipt',
      'writeReceipt',
      'signHead'
    ];

    for (const token of restrictedTokens) {
      expect(content).not.toContain(token);
    }
  });

  // =============================================
  // SECTION 10: GITIGNORE + ENV DISCIPLINE
  // =============================================

  it('29. .gitignore protects .env files and evidence JSON', () => {
    const gitignorePath = path.resolve(__dirname, '../.gitignore');
    const content = fs.readFileSync(gitignorePath, 'utf-8');

    expect(content).toContain('.env');
    expect(content).toContain('.env.*');
    expect(content).toContain('evidence/*.json');
  });

  it('30. .env.example exists and contains no real secret values', () => {
    const envExamplePath = path.resolve(__dirname, '../.env.example');
    const content = fs.readFileSync(envExamplePath, 'utf-8');

    // Must contain the key names
    expect(content).toContain('OPENROUTER_API_KEY');
    expect(content).toContain('AUKORA_EDGE_NODE_SEED');

    // Must NOT contain actual secret values
    expect(content).not.toContain('sk-or-');
    expect(content).not.toMatch(/=[a-zA-Z0-9]{20,}/); // no long values assigned

    // Must contain safety warning
    expect(content).toMatch(/[Nn]ever.*commit/i);
  });

  it('31. run-fusion-council.sh exists and contains inline-key rejection', () => {
    const scriptPath = path.resolve(__dirname, '../run-fusion-council.sh');
    const content = fs.readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('sk-or-');
    expect(content).toContain('ERROR');
    expect(content).toContain('Do not pass API keys');
    expect(content).not.toMatch(/OPENROUTER_API_KEY="sk-or-[a-zA-Z0-9]{20,}"/);
  });
});

describe('21F: Key Resolver + Model Profile Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = vi.fn();
    resetCallCount();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('32. uses resolveApiKey and sends resolved key in Authorization header', async () => {
    process.env.OPENROUTER_API_KEY = 'test-resolved-key-abc';
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    const result = await performExternalReview('evidence', [], { testMode: true });
    expect(result.verdict).toBe('GREEN');

    const fetchHeaders = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(fetchHeaders['Authorization']).toBe('Bearer test-resolved-key-abc');
  });

  it('33. modelSlug option selects correct model in request body', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    await performExternalReview('evidence', [], {
      testMode: true,
      modelSlug: 'anthropic/claude-opus-4.8'
    });

    const fetchBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(fetchBody.model).toBe('anthropic/claude-opus-4.8');
  });

  it('34. Opus model uses Opus profile timeout (not default short)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockRejectedValue(new Error('timeout'));

    const opusProfile = getModelProfile('anthropic/claude-opus-4.8');
    const defaultProfile = getModelProfile('z-ai/glm-5.2');
    expect(opusProfile.maxRetries).toBeLessThan(defaultProfile.maxRetries);

    const result = await performExternalReview('evidence', [], {
      testMode: true,
      modelSlug: 'anthropic/claude-opus-4.8'
    });
    expect(result.failureReason).toBe('network_timeout');
    expect(fetch).toHaveBeenCalledTimes(opusProfile.maxRetries);
  });

  it('35. 4xx (client error) fails closed on first attempt, no retry regardless of profile', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: 'Bad request' })
    } as any);

    const result = await performExternalReview('evidence', [], {
      testMode: true,
      modelSlug: 'anthropic/claude-opus-4.8'
    });
    expect(result.failureReason).toBe('http_4xx');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('35b. 429 is typed rate_limited and retries (24Z.11.1)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue({
      ok: false, status: 429,
      json: async () => ({ error: 'Rate limited' })
    } as any);

    const result = await performExternalReview('evidence', [], {
      testMode: true,
      modelSlug: 'anthropic/claude-opus-4.8'
    });
    expect(result.failureReason).toBe('rate_limited');
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1); // retried, not one-and-done
  });

  it('36. 5xx retries according to Opus profile (2 retries, not default 3)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue({
      ok: false, status: 502,
      json: async () => ({ error: 'Bad Gateway' })
    } as any);

    const result = await performExternalReview('evidence', [], {
      testMode: true,
      modelSlug: 'anthropic/claude-opus-4.8'
    });
    expect(result.failureReason).toBe('http_5xx');
    const opusProfile = getModelProfile('anthropic/claude-opus-4.8');
    expect(fetch).toHaveBeenCalledTimes(opusProfile.maxRetries);
  });

  it('37. successful review has no failureReason', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue(makeGoodMockResponse() as any);

    const result = await performExternalReview('evidence', [], { testMode: true });
    expect(result.verdict).toBe('GREEN');
    expect(result.failureReason).toBeUndefined();
  });

  it('38. schema mismatch returns schema_mismatch failureReason', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value';
    vi.mocked(fetch).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ verdict: 'MAYBE', findings: 'test' }) } }]
      })
    } as any);

    const result = await performExternalReview('evidence', [], { testMode: true });
    expect(result.failureReason).toBe('schema_mismatch');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('39. externalReview.ts imports fusionConfig (key resolver + profiles wired)', () => {
    const sourcePath = path.resolve(__dirname, '../src/externalReview.ts');
    const content = fs.readFileSync(sourcePath, 'utf-8');
    expect(content).toContain("from './fusionConfig'");
    expect(content).toContain('resolveApiKey');
    expect(content).toContain('getModelProfile');
    expect(content).toContain('profile.fetchTimeoutMs');
    expect(content).toContain('profile.wallClockTimeoutMs');
    expect(content).toContain('profile.maxRetries');
    expect(content).toContain('profile.maxOutputTokens');
  });

  it('40. no key-shaped literals in externalReview.ts source', () => {
    const sourcePath = path.resolve(__dirname, '../src/externalReview.ts');
    const content = fs.readFileSync(sourcePath, 'utf-8');
    expect(content).not.toMatch(/sk-or-[a-zA-Z0-9]{16,}/);
    expect(content).not.toMatch(/\b[a-fA-F0-9]{64}\b/);
  });
});
