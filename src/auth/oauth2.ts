import type { OAuth2AuthConfig, AuthProvider } from './types.js';
import { runOAuthPkceFlow, refreshAccessToken } from './oauth2-flow.js';
import type { OAuthFlowConfig, OAuthTokens } from './oauth2-flow.js';
import { cacheTokens, loadCachedTokens, isTokenExpired } from './token-cache.js';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export class OAuth2AuthProvider implements AuthProvider {
  private readonly config: OAuth2AuthConfig;
  private cachedToken: string | null = null;
  private expiresAt: number = 0;

  constructor(config: OAuth2AuthConfig) {
    this.config = config;
  }

  async getHeaders(): Promise<Record<string, string>> {
    if (this.cachedToken && Date.now() < this.expiresAt) {
      return { Authorization: `Bearer ${this.cachedToken}` };
    }

    if (this.config.authorizationUrl) {
      return this.getHeadersWithPkce();
    }

    const token = await this.fetchToken();
    return { Authorization: `Bearer ${token}` };
  }

  private async getHeadersWithPkce(): Promise<Record<string, string>> {
    const cacheKey = `oauth2_${this.config.clientId}`;

    const cached = await loadCachedTokens(cacheKey);
    if (cached && !isTokenExpired(cached)) {
      this.cachedToken = cached.accessToken;
      this.expiresAt = cached.expiresAt ?? 0;
      return { Authorization: `Bearer ${cached.accessToken}` };
    }

    if (cached?.refreshToken) {
      try {
        const flowConfig = this.buildFlowConfig();
        const refreshed = await refreshAccessToken(flowConfig, cached.refreshToken);
        await cacheTokens(cacheKey, refreshed);
        this.cachedToken = refreshed.accessToken;
        this.expiresAt = refreshed.expiresAt ?? 0;
        return { Authorization: `Bearer ${refreshed.accessToken}` };
      } catch (_e) {
        // Refresh failed — fall through to full PKCE flow
      }
    }

    const flowConfig = this.buildFlowConfig();
    const tokens = await runOAuthPkceFlow(flowConfig);
    await cacheTokens(cacheKey, tokens);
    this.cachedToken = tokens.accessToken;
    this.expiresAt = tokens.expiresAt ?? 0;
    return { Authorization: `Bearer ${tokens.accessToken}` };
  }

  private buildFlowConfig(): OAuthFlowConfig {
    return {
      authorizationUrl: this.config.authorizationUrl!,
      tokenUrl: this.config.tokenUrl,
      clientId: this.config.clientId,
      scopes: this.config.scopes ?? [],
      redirectPort: this.config.redirectPort,
    };
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: this.config.grantType ?? 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    if (this.config.scopes?.length) {
      body.set('scope', this.config.scopes.join(' '));
    }

    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'unknown');
      throw new Error(
        `OAuth2 token request failed: ${res.status} ${res.statusText} — ${errorBody}`,
      );
    }

    const data = (await res.json()) as TokenResponse;
    this.cachedToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;

    return data.access_token;
  }
}
