import { stringify } from 'yaml';
import type { GeneratedTest } from './schema-walker.js';

interface YamlSuite {
  name: string;
  layer: string;
  tests: Array<{
    name: string;
    tool: string;
    args: Record<string, unknown>;
    expect_error?: boolean;
  }>;
}

interface YamlConfig {
  suites: YamlSuite[];
}

export function formatAsYaml(tests: GeneratedTest[], pluginName?: string): string {
  const grouped = new Map<string, GeneratedTest[]>();
  for (const test of tests) {
    const existing = grouped.get(test.tool);
    if (existing) {
      existing.push(test);
    } else {
      grouped.set(test.tool, [test]);
    }
  }

  const suites: YamlSuite[] = [];

  for (const [toolName, toolTests] of grouped) {
    const validTests = toolTests.filter((t) => t.category === 'valid' || t.category === 'boundary');
    if (validTests.length > 0) {
      suites.push({
        name: `${toolName}-integration`,
        layer: 'integration',
        tests: validTests.map((t) => ({
          name: t.name,
          tool: t.tool,
          args: t.args,
        })),
      });
    }

    const negativeTests = toolTests.filter((t) => t.category === 'negative');
    if (negativeTests.length > 0) {
      suites.push({
        name: `${toolName}-negative`,
        layer: 'integration',
        tests: negativeTests.map((t) => ({
          name: t.name,
          tool: t.tool,
          args: t.args,
          expect_error: true,
        })),
      });
    }
  }

  const config: YamlConfig & { plugin?: { name: string } } = { suites };
  if (pluginName) {
    config.plugin = { name: pluginName };
  }

  return stringify(config, { lineWidth: 120 });
}
