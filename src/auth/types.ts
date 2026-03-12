export type AuthType = 'api-key' | 'bearer' | 'oauth2';

export interface ApiKeyAuthConfig {
  type: 'api-key';
  key: string;
  header?: string;
  prefix?: string;
}

export interface BearerAuthConfig {
  type: 'bearer';
  token: string;
}

export interface OAuth2AuthConfig {
  type: 'oauth2';
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  grantType?: 'client_credentials';
}

export type AuthConfig = ApiKeyAuthConfig | BearerAuthConfig | OAuth2AuthConfig;

export interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>;
}
