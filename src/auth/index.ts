import type { AuthConfig, AuthProvider } from './types.js';
import { ApiKeyAuthProvider } from './api-key.js';
import { BearerAuthProvider } from './bearer.js';
import { OAuth2AuthProvider } from './oauth2.js';

export function createAuthProvider(config: AuthConfig): AuthProvider {
  switch (config.type) {
    case 'api-key':
      return new ApiKeyAuthProvider(config);
    case 'bearer':
      return new BearerAuthProvider(config);
    case 'oauth2':
      return new OAuth2AuthProvider(config);
  }
}

export type { AuthConfig, AuthProvider, AuthType } from './types.js';
export type { ApiKeyAuthConfig, BearerAuthConfig, OAuth2AuthConfig } from './types.js';
