import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

export interface OAuthFlowConfig {
  discoveryUrl?: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
  redirectPort?: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function buildAuthorizationUrl(
  config: OAuthFlowConfig,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  if (config.scopes.length > 0) {
    params.set('scope', config.scopes.join(' '));
  }

  return `${config.authorizationUrl}?${params.toString()}`;
}

function waitForCallback(
  server: Server,
  expectedState: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timed out'));
    }, timeoutMs);

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`);

      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h1>Authorization failed</h1><p>You can close this window.</p></body></html>',
        );
        clearTimeout(timer);
        server.close();
        reject(new Error(`OAuth authorization error: ${error}`));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid callback</h1></body></html>');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h1>Authorization successful</h1><p>You can close this window.</p></body></html>',
      );
      clearTimeout(timer);
      server.close();
      resolve(code);
    });
  });
}

async function exchangeCodeForTokens(
  config: OAuthFlowConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown');
    throw new Error(`Token exchange failed: ${res.status} ${res.statusText} — ${errorBody}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

export async function runOAuthPkceFlow(config: OAuthFlowConfig): Promise<OAuthTokens> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('hex');

  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(config.redirectPort ?? 0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (config.redirectPort ?? 0);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = buildAuthorizationUrl(config, redirectUri, codeChallenge, state);

  try {
    const openModule = await import('open');
    await openModule.default(authUrl);
  } catch (_e) {
    console.log(`Open this URL in your browser:\n  ${authUrl}`);
  }

  const code = await waitForCallback(server, state, 120_000);
  return exchangeCodeForTokens(config, code, codeVerifier, redirectUri);
}

export async function refreshAccessToken(
  config: OAuthFlowConfig,
  refreshToken: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  });

  if (config.scopes.length > 0) {
    body.set('scope', config.scopes.join(' '));
  }

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown');
    throw new Error(`Token refresh failed: ${res.status} ${res.statusText} — ${errorBody}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

export { generateCodeVerifier, generateCodeChallenge };
