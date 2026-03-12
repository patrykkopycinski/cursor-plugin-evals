import type { ApiKeyAuthConfig, AuthProvider } from './types.js';

export class ApiKeyAuthProvider implements AuthProvider {
  private readonly key: string;
  private readonly header: string;
  private readonly prefix: string;

  constructor(config: ApiKeyAuthConfig) {
    this.key = config.key;
    this.header = config.header ?? 'Authorization';
    this.prefix = config.prefix ?? 'Bearer';
  }

  async getHeaders(): Promise<Record<string, string>> {
    return { [this.header]: `${this.prefix} ${this.key}` };
  }
}
