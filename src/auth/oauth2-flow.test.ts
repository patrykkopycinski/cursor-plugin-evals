import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash, randomBytes } from 'crypto';

// Direct unit tests for PKCE generation (imported separately to avoid side effects)
describe('PKCE code generation', () => {
  it('generates a code_verifier of correct length and format', async () => {
    const { generateCodeVerifier } = await import('./oauth2-flow.js');
    const verifier = generateCodeVerifier();

    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThanOrEqual(32);
    // base64url: no +, /, or =
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique verifiers', async () => {
    const { generateCodeVerifier } = await import('./oauth2-flow.js');
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it('generates a valid SHA-256 code_challenge from a verifier', async () => {
    const { generateCodeVerifier, generateCodeChallenge } = await import('./oauth2-flow.js');
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    expect(typeof challenge).toBe('string');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);

    const expectedChallenge = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expectedChallenge);
  });

  it('produces different challenges for different verifiers', async () => {
    const { generateCodeChallenge } = await import('./oauth2-flow.js');
    const c1 = generateCodeChallenge('verifier-one');
    const c2 = generateCodeChallenge('verifier-two');
    expect(c1).not.toBe(c2);
  });
});

describe('refreshAccessToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends refresh_token grant and returns new tokens', async () => {
    const { refreshAccessToken } = await import('./oauth2-flow.js');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-access-tok',
          refresh_token: 'new-refresh-tok',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const tokens = await refreshAccessToken(
      {
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'client-123',
        scopes: ['read'],
      },
      'old-refresh-tok',
    );

    expect(tokens.accessToken).toBe('new-access-tok');
    expect(tokens.refreshToken).toBe('new-refresh-tok');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    const [url, opts] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://auth.example.com/token');
    expect(opts?.method).toBe('POST');
    const body = opts?.body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=old-refresh-tok');
    expect(body).toContain('client_id=client-123');
    expect(body).toContain('scope=read');
  });

  it('preserves existing refresh token if server does not return a new one', async () => {
    const { refreshAccessToken } = await import('./oauth2-flow.js');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const tokens = await refreshAccessToken(
      {
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'c',
        scopes: [],
      },
      'keep-this-refresh',
    );

    expect(tokens.refreshToken).toBe('keep-this-refresh');
  });

  it('throws on token endpoint failure', async () => {
    const { refreshAccessToken } = await import('./oauth2-flow.js');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Bad Request', { status: 400, statusText: 'Bad Request' }),
    );

    await expect(
      refreshAccessToken(
        {
          authorizationUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          clientId: 'c',
          scopes: [],
        },
        'stale-refresh',
      ),
    ).rejects.toThrow('Token refresh failed: 400 Bad Request');
  });
});

describe('token cache', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import('fs');
    const { join } = await import('path');
    const os = await import('os');
    tmpDir = mkdtempSync(join(os.tmpdir(), 'token-cache-test-'));
  });

  afterEach(async () => {
    const { rmSync } = await import('fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('caches and loads tokens', async () => {
    const { cacheTokens, loadCachedTokens } = await import('./token-cache.js');

    const tokens = { accessToken: 'at-123', refreshToken: 'rt-456', expiresAt: Date.now() + 60_000 };
    await cacheTokens('my-key', tokens, tmpDir);

    const loaded = await loadCachedTokens('my-key', tmpDir);
    expect(loaded).toEqual(tokens);
  });

  it('returns null for non-existent cache key', async () => {
    const { loadCachedTokens } = await import('./token-cache.js');
    const loaded = await loadCachedTokens('missing-key', tmpDir);
    expect(loaded).toBeNull();
  });

  it('isTokenExpired returns false when token has time left', async () => {
    const { isTokenExpired } = await import('./token-cache.js');
    expect(isTokenExpired({ accessToken: 'x', expiresAt: Date.now() + 120_000 })).toBe(false);
  });

  it('isTokenExpired returns true when token is past expiry buffer', async () => {
    const { isTokenExpired } = await import('./token-cache.js');
    expect(isTokenExpired({ accessToken: 'x', expiresAt: Date.now() + 30_000 })).toBe(true);
  });

  it('isTokenExpired returns false when no expiresAt is set', async () => {
    const { isTokenExpired } = await import('./token-cache.js');
    expect(isTokenExpired({ accessToken: 'x' })).toBe(false);
  });

  it('sanitizes cache key to safe filename', async () => {
    const { cacheTokens, loadCachedTokens } = await import('./token-cache.js');

    const tokens = { accessToken: 'at', expiresAt: Date.now() + 60_000 };
    await cacheTokens('https://example.com/auth', tokens, tmpDir);

    const loaded = await loadCachedTokens('https://example.com/auth', tmpDir);
    expect(loaded).toEqual(tokens);
  });
});
