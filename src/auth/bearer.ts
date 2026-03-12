import type { BearerAuthConfig, AuthProvider } from './types.js';

export class BearerAuthProvider implements AuthProvider {
  private readonly token: string;

  constructor(config: BearerAuthConfig) {
    this.token = config.token;
  }

  async getHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${this.token}` };
  }
}
