# OAuth 2.0 MCP Server Testing

Test MCP servers that require OAuth 2.0 authentication, with PKCE flow support, token caching, and automatic refresh.

## YAML Config

```yaml
plugin:
  name: my-oauth-plugin
  dir: ./my-plugin
  transport: streamable-http
  url: https://mcp.example.com/sse
  auth:
    type: oauth2
    token_url: https://auth.example.com/oauth/token
    client_id: ${OAUTH_CLIENT_ID}
    client_secret: ${OAUTH_CLIENT_SECRET}
    scopes:
      - read
      - write
```

For PKCE (public client) flow, omit `client_secret` and add `authorization_url`:

```yaml
  auth:
    type: oauth2
    authorization_url: https://auth.example.com/authorize
    token_url: https://auth.example.com/oauth/token
    client_id: ${OAUTH_CLIENT_ID}
    scopes: [read, write]
```

Environment variables are interpolated via `${VAR_NAME}` syntax.

## PKCE Flow

When `authorization_url` is configured, the framework runs a full Authorization Code + PKCE flow:

1. Generates a random `code_verifier` and its SHA-256 `code_challenge`.
2. Starts a local HTTP server on an ephemeral port for the redirect callback.
3. Opens the authorization URL in the browser (or prints it for manual use).
4. Waits for the OAuth provider to redirect back with an authorization `code`.
5. Exchanges the code + verifier for tokens at `token_url`.

Without `authorization_url`, it falls back to **client credentials** grant using `client_id` + `client_secret`.

## Token Caching and Refresh

Tokens are cached to `.cursor-plugin-evals/tokens/<key>.json` to avoid re-authentication on every run.

On subsequent runs:
1. Load cached tokens.
2. If not expired (with 60s buffer), use the cached access token.
3. If expired but a `refresh_token` exists, attempt a token refresh.
4. If refresh fails, fall through to a full PKCE flow.

## Manual Fallback

If the browser cannot be opened automatically (e.g., headless CI), the authorization URL is printed to stdout:

```
Open this URL in your browser:
  https://auth.example.com/authorize?response_type=code&client_id=...
```

The local callback server waits up to 120 seconds for the redirect.

## Programmatic API

```typescript
import {
  runOAuthPkceFlow, refreshAccessToken,
  cacheTokens, loadCachedTokens, isTokenExpired,
} from 'cursor-plugin-evals';
import type { OAuthFlowConfig } from 'cursor-plugin-evals';

const config: OAuthFlowConfig = {
  authorizationUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/oauth/token',
  clientId: 'my-client-id',
  scopes: ['read', 'write'],
};

// Check cache first
const cached = await loadCachedTokens('my-plugin');
if (cached && !isTokenExpired(cached)) {
  console.log('Using cached token');
} else if (cached?.refreshToken) {
  const refreshed = await refreshAccessToken(config, cached.refreshToken);
  await cacheTokens('my-plugin', refreshed);
} else {
  const tokens = await runOAuthPkceFlow(config);
  await cacheTokens('my-plugin', tokens);
  // tokens: { accessToken, refreshToken?, expiresAt? }
}
```
