import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import type { OAuthTokens } from './oauth2-flow.js';

const DEFAULT_CACHE_DIR = resolve(process.cwd(), '.cursor-plugin-evals', 'tokens');

function cacheFilePath(key: string, dir: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(dir, `${safeKey}.json`);
}

export async function cacheTokens(
  key: string,
  tokens: OAuthTokens,
  dir?: string,
): Promise<void> {
  const cacheDir = dir ?? DEFAULT_CACHE_DIR;
  mkdirSync(cacheDir, { recursive: true });
  const filePath = cacheFilePath(key, cacheDir);
  writeFileSync(filePath, JSON.stringify(tokens, null, 2), 'utf-8');
}

export async function loadCachedTokens(
  key: string,
  dir?: string,
): Promise<OAuthTokens | null> {
  const cacheDir = dir ?? DEFAULT_CACHE_DIR;
  const filePath = cacheFilePath(key, cacheDir);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as OAuthTokens;
    if (!data.accessToken) return null;
    return data;
  } catch {
    return null;
  }
}

export function isTokenExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expiresAt) return false;
  const bufferMs = 60_000;
  return Date.now() >= tokens.expiresAt - bufferMs;
}
