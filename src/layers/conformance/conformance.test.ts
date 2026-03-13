import { describe, it, expect, vi } from 'vitest';
import { ALL_CHECKS, CHECKS_BY_CATEGORY } from './checks.js';
import { computeTier, runConformanceChecks } from './runner.js';
import { formatConformanceReport } from './report.js';
import type { ConformanceCategory, ConformanceReport, ConformanceResult } from './types.js';
import type { McpPluginClient } from '../../mcp/client.js';

describe('check definitions', () => {
  it('all checks have unique IDs', () => {
    const ids = ALL_CHECKS.map((c) => c.check.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all checks reference valid categories', () => {
    const validCategories: ConformanceCategory[] = [
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
    for (const def of ALL_CHECKS) {
      expect(validCategories).toContain(def.check.category);
    }
  });

  it('all checks have non-empty name and description', () => {
    for (const def of ALL_CHECKS) {
      expect(def.check.name.length).toBeGreaterThan(0);
      expect(def.check.description.length).toBeGreaterThan(0);
    }
  });

  it('has at least 25 checks', () => {
    expect(ALL_CHECKS.length).toBeGreaterThanOrEqual(25);
  });

  it('CHECKS_BY_CATEGORY covers all categories', () => {
    const categories: ConformanceCategory[] = [
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
    for (const cat of categories) {
      expect(CHECKS_BY_CATEGORY).toHaveProperty(cat);
    }
  });

  it('CHECKS_BY_CATEGORY sums to ALL_CHECKS length', () => {
    const total = Object.values(CHECKS_BY_CATEGORY).reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(ALL_CHECKS.length);
  });
});

describe('computeTier', () => {
  it('returns tier 1 for 100% pass rate', () => {
    expect(computeTier(1.0)).toBe(1);
  });

  it('returns tier 2 for 80-99% pass rate', () => {
    expect(computeTier(0.8)).toBe(2);
    expect(computeTier(0.9)).toBe(2);
    expect(computeTier(0.99)).toBe(2);
  });

  it('returns tier 3 for below 80%', () => {
    expect(computeTier(0.79)).toBe(3);
    expect(computeTier(0.5)).toBe(3);
    expect(computeTier(0)).toBe(3);
  });
});

function createMockClient(overrides?: {
  tools?: Array<{ name: string; inputSchema: Record<string, unknown>; description?: string }>;
  resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  capabilities?: Record<string, unknown>;
  serverVersion?: { name: string; version?: string };
}): McpPluginClient {
  const tools = overrides?.tools ?? [
    { name: 'echo', description: 'echoes input', inputSchema: { type: 'object' } },
  ];
  const resources = overrides?.resources ?? [];
  const capabilities = overrides?.capabilities ?? { tools: {} };
  const serverVersion = overrides?.serverVersion ?? { name: 'test-server', version: '1.0.0' };

  return {
    listTools: vi.fn().mockResolvedValue(tools),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }),
    listResources: vi.fn().mockResolvedValue(resources),
    readResource: vi.fn().mockResolvedValue({ contents: [{ uri: 'test://a', text: 'data' }] }),
    disconnect: vi.fn(),
    connected: true,
    rawClient: {
      getServerCapabilities: vi.fn().mockReturnValue(capabilities),
      getServerVersion: vi.fn().mockReturnValue(serverVersion),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      getPrompt: vi.fn().mockRejectedValue(new Error('unknown prompt')),
      request: vi.fn().mockRejectedValue(Object.assign(new Error('method not found'), { code: -32601 })),
    },
  } as unknown as McpPluginClient;
}

describe('runConformanceChecks', () => {
  it('produces a report with correct structure', async () => {
    const client = createMockClient();
    const report = await runConformanceChecks(client);

    expect(report.serverName).toBe('test-server');
    expect(report.totalChecks).toBeGreaterThan(0);
    expect(report.passed + report.failed + report.skipped).toBe(report.totalChecks);
    expect(report.tier).toBeGreaterThanOrEqual(1);
    expect(report.tier).toBeLessThanOrEqual(3);
    expect(report.results.length).toBe(report.totalChecks);
    expect(report.byCategory).toBeDefined();
  });

  it('filters by category', async () => {
    const client = createMockClient();
    const report = await runConformanceChecks(client, {
      categories: ['initialization'],
    });

    for (const r of report.results) {
      expect(r.check.category).toBe('initialization');
    }
  });

  it('filters to required-only checks', async () => {
    const client = createMockClient();
    const report = await runConformanceChecks(client, { requiredOnly: true });

    for (const r of report.results) {
      expect(r.check.required).toBe(true);
    }
  });

  it('skips capability-gated checks when capability is absent', async () => {
    const client = createMockClient({ capabilities: {} });
    const report = await runConformanceChecks(client, {
      categories: ['tool-listing'],
    });

    const skipped = report.results.filter((r) => r.skipped);
    expect(skipped.length).toBe(report.results.length);
  });

  it('calculates pass rate excluding skipped checks', async () => {
    const client = createMockClient({ capabilities: {} });
    const report = await runConformanceChecks(client, {
      categories: ['tool-listing'],
    });

    expect(report.passRate).toBe(1);
    expect(report.skipped).toBe(report.totalChecks);
  });
});

describe('formatConformanceReport', () => {
  function makeReport(overrides?: Partial<ConformanceReport>): ConformanceReport {
    const results: ConformanceResult[] = [
      {
        check: {
          id: 'init-responds',
          category: 'initialization',
          name: 'Server responds',
          description: 'test',
          required: true,
        },
        passed: true,
        message: 'OK',
        durationMs: 5,
      },
      {
        check: {
          id: 'tool-list-array',
          category: 'tool-listing',
          name: 'tools/list returns array',
          description: 'test',
          required: true,
        },
        passed: false,
        message: 'Connection refused',
        durationMs: 12,
      },
      {
        check: {
          id: 'prompt-list-array',
          category: 'prompt-listing',
          name: 'prompts/list returns array',
          description: 'test',
          required: true,
        },
        passed: true,
        skipped: true,
        message: 'skipped',
        durationMs: 0,
      },
    ];

    const allCats: ConformanceCategory[] = [
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
    const byCategory = {} as ConformanceReport['byCategory'];
    for (const cat of allCats) {
      byCategory[cat] = { passed: 0, total: 0 };
    }
    byCategory['initialization'] = { passed: 1, total: 1 };
    byCategory['tool-listing'] = { passed: 0, total: 1 };

    return {
      serverName: 'test-server',
      totalChecks: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
      passRate: 0.5,
      tier: 3,
      results,
      byCategory,
      ...overrides,
    };
  }

  it('returns a non-empty string', () => {
    const output = formatConformanceReport(makeReport());
    expect(output.length).toBeGreaterThan(0);
  });

  it('includes server name', () => {
    const output = formatConformanceReport(makeReport());
    expect(output).toContain('test-server');
  });

  it('includes tier badge', () => {
    const output = formatConformanceReport(makeReport({ tier: 1 }));
    expect(output).toContain('TIER 1');
  });

  it('includes pass/fail counts', () => {
    const output = formatConformanceReport(makeReport());
    expect(output).toContain('1 passed');
    expect(output).toContain('1 failed');
    expect(output).toContain('1 skipped');
  });

  it('includes failure messages', () => {
    const output = formatConformanceReport(makeReport());
    expect(output).toContain('Connection refused');
  });

  it('shows skipped indicator', () => {
    const output = formatConformanceReport(makeReport());
    expect(output).toContain('skipped');
  });

  it('shows pass rate', () => {
    const output = formatConformanceReport(makeReport());
    expect(output).toContain('50.0%');
  });
});
