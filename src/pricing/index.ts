import { createRequire } from 'module';
import type { TokenUsage } from '../core/types.js';

interface ModelPricing {
  input: number;
  output: number;
  cached?: number;
}

const require = createRequire(import.meta.url);
const pricingCatalog: Record<string, ModelPricing> = require('./models.json');

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
