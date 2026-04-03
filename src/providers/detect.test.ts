import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectProvider, hasProviderCredentials, isClaudeModel } from './detect.js';

describe('detectProvider', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_BEDROCK_MODEL',
    'ANTHROPIC_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_ENDPOINT',
    'LITELLM_API_KEY',
    'OPENAI_API_KEY',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('detects bedrock when AWS credentials are present', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIA...';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    const result = detectProvider();
    expect(result.provider).toBe('bedrock');
    expect(result.bedrock).toBeDefined();
    expect(result.apiKey).toBe('');
  });

  it('detects anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const result = detectProvider();
    expect(result.provider).toBe('anthropic');
    expect(result.apiKey).toBe('sk-ant-test');
  });

  it('detects azure-openai when both key and endpoint are set', () => {
    process.env.AZURE_OPENAI_API_KEY = 'azure-key';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://my-resource.openai.azure.com';
    const result = detectProvider();
    expect(result.provider).toBe('azure-openai');
    expect(result.apiKey).toBe('azure-key');
  });

  it('does not detect azure-openai when endpoint is missing', () => {
    process.env.AZURE_OPENAI_API_KEY = 'azure-key';
    const result = detectProvider();
    expect(result.provider).not.toBe('azure-openai');
  });

  it('detects litellm when LITELLM_API_KEY is set', () => {
    process.env.LITELLM_API_KEY = 'litellm-key';
    const result = detectProvider();
    expect(result.provider).toBe('litellm');
    expect(result.apiKey).toBe('litellm-key');
  });

  it('falls back to openai when no other provider matches', () => {
    const result = detectProvider();
    expect(result.provider).toBe('openai');
    expect(result.apiKey).toBe('');
  });

  it('falls back to openai with key when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    const result = detectProvider();
    expect(result.provider).toBe('openai');
    expect(result.apiKey).toBe('sk-openai');
  });

  it('respects priority: bedrock > anthropic', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIA...';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(detectProvider().provider).toBe('bedrock');
  });

  it('respects priority: anthropic > azure-openai', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.AZURE_OPENAI_API_KEY = 'azure-key';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://endpoint.openai.azure.com';
    expect(detectProvider().provider).toBe('anthropic');
  });

  it('respects priority: azure-openai > litellm', () => {
    process.env.AZURE_OPENAI_API_KEY = 'azure-key';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://endpoint.openai.azure.com';
    process.env.LITELLM_API_KEY = 'litellm-key';
    expect(detectProvider().provider).toBe('azure-openai');
  });
});

describe('hasProviderCredentials', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['ANTHROPIC_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'OPENAI_API_KEY']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
      else delete process.env[key];
    }
  });

  it('returns false when no credentials are set', () => {
    expect(hasProviderCredentials()).toBe(false);
  });

  it('returns true when an API key is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(hasProviderCredentials()).toBe(true);
  });

  it('returns true for bedrock credentials', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIA...';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    expect(hasProviderCredentials()).toBe(true);
  });
});

describe('isClaudeModel', () => {
  it.each([
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'anthropic.claude-sonnet-4-5-20251022-v2:0',
    'us.anthropic.claude-opus-4-6-v1',
    'claude-haiku-4-5',
    'sonnet-latest',
    'opus-latest',
    'haiku',
  ])('returns true for Claude model: %s', (model) => {
    expect(isClaudeModel(model)).toBe(true);
  });

  it.each([
    'gpt-5.2-mini',
    'gpt-4o',
    'gemini-2.5-pro',
    'llama-3.1-70b',
    'qwen3-4b',
  ])('returns false for non-Claude model: %s', (model) => {
    expect(isClaudeModel(model)).toBe(false);
  });
});
