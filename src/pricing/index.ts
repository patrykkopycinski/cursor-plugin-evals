import type { TokenUsage } from '../core/types.js';

interface ModelPricing {
  input: number;
  output: number;
  cached?: number;
}

const pricingCatalog: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.5, output: 10.0, cached: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cached: 0.075 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0, cached: 0.3 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0, cached: 1.5 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0, cached: 0.3 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0, cached: 0.08 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

function findModelPricing(modelId: string): ModelPricing | null {
  if (pricingCatalog[modelId]) return pricingCatalog[modelId];

  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(pricingCatalog)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return pricing;
    }
  }
  return null;
}

export function calculateCost(modelId: string, usage: TokenUsage): number | null {
  const pricing = findModelPricing(modelId);
  if (!pricing) return null;

  const inputTokens = usage.input - (usage.cached ?? 0);
  const cachedTokens = usage.cached ?? 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output / 1_000_000) * pricing.output;
  const cachedCost = (cachedTokens / 1_000_000) * (pricing.cached ?? pricing.input);

  return inputCost + outputCost + cachedCost;
}

export function getPricingCatalog(): Record<string, ModelPricing> {
  return { ...pricingCatalog };
}
