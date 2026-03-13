import { createAuthProvider } from './index.js';
import { ApiKeyAuthProvider } from './api-key.js';
import { BearerAuthProvider } from './bearer.js';
import { OAuth2AuthProvider } from './oauth2.js';
import type { ApiKeyAuthConfig, BearerAuthConfig, OAuth2AuthConfig } from './types.js';

describe('ApiKeyAuthProvider', () => {
  it('returns Authorization header with default Bearer prefix', async () => {
    const provider = new ApiKeyAuthProvider({ type: 'api-key', key: 'my-secret-key' });
    const headers = await provider.getHeaders();
    expect(headers).toEqual({ Authorization: 'Bearer my-secret-key' });
  });

  it('uses custom header name', async () => {
    const provider = new ApiKeyAuthProvider({
      type: 'api-key',
      key: 'abc123',
      header: 'X-Api-Key',
      prefix: '',
    });
    const headers = await provider.getHeaders();
    expect(headers).toEqual({ 'X-Api-Key': ' abc123' });
  });

  it('uses custom prefix', async () => {
    const provider = new ApiKeyAuthProvider({
      type: 'api-key',
      key: 'tok_xyz',
      prefix: 'ApiKey',
    });
    const headers = await provider.getHeaders();
    expect(headers).toEqual({ Authorization: 'ApiKey tok_xyz' });
  });
});

describe('BearerAuthProvider', () => {
  it('returns Authorization header with Bearer token', async () => {
    const provider = new BearerAuthProvider({ type: 'bearer', token: 'static-token-abc' });
    const headers = await provider.getHeaders();
    expect(headers).toEqual({ Authorization: 'Bearer static-token-abc' });
  });
});

describe('OAuth2AuthProvider', () => {
  const baseConfig: OAuth2AuthConfig = {
    type: 'oauth2',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'client-123',
    clientSecret: 'secret-456',
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fetches a token and returns Authorization header', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'oauth-tok', expires_in: 3600, token_type: 'bearer' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const provider = new OAuth2AuthProvider(baseConfig);
    const headers = await provider.getHeaders();

    expect(headers).toEqual({ Authorization: 'Bearer oauth-tok' });
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://auth.example.com/token');
    expect(opts?.method).toBe('POST');
    expect(opts?.body).toContain('grant_type=client_credentials');
    expect(opts?.body).toContain('client_id=client-123');
    expect(opts?.body).toContain('client_secret=secret-456');
  });

  it('includes scopes in token request', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'scoped-tok', expires_in: 3600, token_type: 'bearer' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const provider = new OAuth2AuthProvider({ ...baseConfig, scopes: ['read', 'write'] });
    await provider.getHeaders();

    const body = mockFetch.mock.calls[0][1]?.body as string;
    expect(body).toContain('scope=read+write');
  });

  it('caches token on subsequent calls', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'cached-tok', expires_in: 3600, token_type: 'bearer' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const provider = new OAuth2AuthProvider(baseConfig);
    const h1 = await provider.getHeaders();
    const h2 = await provider.getHeaders();

    expect(h1).toEqual({ Authorization: 'Bearer cached-tok' });
    expect(h2).toEqual({ Authorization: 'Bearer cached-tok' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('refreshes token when expired', async () => {
    vi.useFakeTimers();

    const mockFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'first-tok', expires_in: 120, token_type: 'bearer' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'second-tok', expires_in: 3600, token_type: 'bearer' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    const provider = new OAuth2AuthProvider(baseConfig);

    const h1 = await provider.getHeaders();
    expect(h1).toEqual({ Authorization: 'Bearer first-tok' });

    // Advance past expiry (120s token - 60s buffer = 60s effective, advance 61s)
    vi.advanceTimersByTime(61_000);

    const h2 = await provider.getHeaders();
    expect(h2).toEqual({ Authorization: 'Bearer second-tok' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws on token endpoint failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    );

    const provider = new OAuth2AuthProvider(baseConfig);
    await expect(provider.getHeaders()).rejects.toThrow(
      'OAuth2 token request failed: 401 Unauthorized',
    );
  });
});

describe('createAuthProvider', () => {
  it('creates ApiKeyAuthProvider for api-key type', () => {
    const config: ApiKeyAuthConfig = { type: 'api-key', key: 'k' };
    expect(createAuthProvider(config)).toBeInstanceOf(ApiKeyAuthProvider);
  });

  it('creates BearerAuthProvider for bearer type', () => {
    const config: BearerAuthConfig = { type: 'bearer', token: 't' };
    expect(createAuthProvider(config)).toBeInstanceOf(BearerAuthProvider);
  });

  it('creates OAuth2AuthProvider for oauth2 type', () => {
    const config: OAuth2AuthConfig = {
      type: 'oauth2',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'c',
      clientSecret: 's',
    };
    expect(createAuthProvider(config)).toBeInstanceOf(OAuth2AuthProvider);
  });
});
