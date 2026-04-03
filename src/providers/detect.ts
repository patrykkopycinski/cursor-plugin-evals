/**
 * Unified LLM provider detection from environment variables.
 *
 * Both `plain-llm` adapter and `llm-judge` need to resolve which LLM provider
 * to use. This module centralizes the priority chain so they stay in sync.
 *
 * Priority: Bedrock → Anthropic → Azure OpenAI → LiteLLM → OpenAI
 */

import { getBedrockConfig, type BedrockConfig } from '../adapters/bedrock.js';

export type Provider = 'bedrock' | 'anthropic' | 'azure-openai' | 'litellm' | 'openai';

export interface DetectedProvider {
  provider: Provider;
  bedrock?: BedrockConfig;
  apiKey: string;
}

/**
 * Detect the LLM provider from environment variables.
 *
 * Returns the detected provider type, optional Bedrock config, and the
 * API key to use. Bedrock uses AWS credentials instead of an API key
 * (apiKey will be empty).
 */
export function detectProvider(): DetectedProvider {
  const bedrock = getBedrockConfig();
  if (bedrock) {
    return { provider: 'bedrock', bedrock, apiKey: '' };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY };
  }

  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    return { provider: 'azure-openai', apiKey: process.env.AZURE_OPENAI_API_KEY };
  }

  if (process.env.LITELLM_API_KEY) {
    return { provider: 'litellm', apiKey: process.env.LITELLM_API_KEY };
  }

  return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY ?? '' };
}

/** Returns true if the API key (or Bedrock credentials) are available. */
export function hasProviderCredentials(): boolean {
  const detected = detectProvider();
  return detected.provider === 'bedrock' || detected.apiKey !== '';
}

/** Check if a model ID looks like a Claude/Anthropic model. */
export function isClaudeModel(model: string): boolean {
  return /claude|anthropic|sonnet|opus|haiku/i.test(model);
}
