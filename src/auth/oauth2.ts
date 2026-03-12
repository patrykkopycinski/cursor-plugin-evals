import type { OAuth2AuthConfig, AuthProvider } from './types.js';

interface TokenResponse {
  access_token: string;
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

    const token = await this.fetchToken();
    return { Authorization: `Bearer ${token}` };
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
        `OAuth2 token request failed: ${res.status} ${res.statusText} — ${errorBody}`
      );
    }

    const data = (await res.json()) as TokenResponse;
    this.cachedToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;

    return data.access_token;
  }
}
