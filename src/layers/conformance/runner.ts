import type { McpPluginClient } from '../../mcp/client.js';
import type { ConformanceCategory, ConformanceReport, ConformanceResult } from './types.js';
import { ALL_CHECKS, CHECKS_BY_CATEGORY } from './checks.js';

export interface ConformanceOptions {
  categories?: ConformanceCategory[];
  requiredOnly?: boolean;
}

function computeTier(passRate: number): 1 | 2 | 3 {
  if (passRate >= 1) return 1;
  if (passRate >= 0.8) return 2;
  return 3;
}

const ALL_CATEGORIES: ConformanceCategory[] = [
  'initialization',
  'tool-listing',
  'tool-execution',
  'resource-listing',
  'resource-reading',
  'prompt-listing',
  'prompt-getting',
  'error-handling',
  'cancellation',
  'capability-negotiation',
];

export { computeTier };

export async function runConformanceChecks(
  client: McpPluginClient,
  options?: ConformanceOptions,
): Promise<ConformanceReport> {
  const selectedCategories = options?.categories ?? ALL_CATEGORIES;
  const requiredOnly = options?.requiredOnly ?? false;

  let checks = ALL_CHECKS.filter((c) =>
    selectedCategories.includes(c.check.category),
  );

  if (requiredOnly) {
    checks = checks.filter((c) => c.check.required);
  }

  const results: ConformanceResult[] = [];
  for (const def of checks) {
    results.push(await def.run(client));
  }

  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.passed).length;
  const scorable = results.length - skipped;
  const passRate = scorable > 0 ? passed / scorable : 1;

  const byCategory = {} as ConformanceReport['byCategory'];
  for (const cat of ALL_CATEGORIES) {
    const catResults = results.filter((r) => r.check.category === cat);
    const catScorable = catResults.filter((r) => !r.skipped);
    byCategory[cat] = {
      passed: catScorable.filter((r) => r.passed).length,
      total: catScorable.length,
    };
  }

  const serverInfo = client.rawClient.getServerVersion();
  const serverName = serverInfo?.name ?? 'unknown';

  return {
    serverName,
    totalChecks: results.length,
    passed,
    failed,
    skipped,
    passRate,
    tier: computeTier(passRate),
    results,
    byCategory,
  };
}

export { ALL_CATEGORIES, CHECKS_BY_CATEGORY };
