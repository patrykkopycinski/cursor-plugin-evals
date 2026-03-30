import { ElasticsearchTraceSource } from '../trace-source/elasticsearch.js';
import type { ParsedTrace } from '../trace-source/types.js';
import { clusterFailures, findLowScoringTraces } from './clustering.js';
import type { ClusteringConfig, FailureCluster } from './clustering.js';

export interface HarvestConfig {
  endpoint: string;
  apiKey?: string;
  index?: string;
  timeRange?: { from: string; to: string };
  scoreThreshold?: number;
  maxTests?: number;
  outputPath?: string;
}

export interface HarvestedTestCase {
  name: string;
  prompt: string;
  expected: {
    tools?: string[];
    toolSequence?: string[];
  };
  source: {
    traceId: string;
    timestamp: string;
    score: number;
    failureCluster?: string;
  };
}

function extractPromptFromTrace(trace: ParsedTrace): string {
  // Walk spans looking for gen_ai.prompt in attributes
  for (const span of trace.spans) {
    const prompt =
      (span.attributes['gen_ai.prompt'] as string | undefined) ??
      (span.attributes['input.value'] as string | undefined) ??
      (span.attributes['llm.input_messages'] as string | undefined);
    if (prompt) return typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    // Check span events too
    for (const event of span.events) {
      const evtPrompt =
        (event.attributes['gen_ai.prompt'] as string | undefined) ??
        (event.attributes['input'] as string | undefined);
      if (evtPrompt) return evtPrompt;
    }
  }
  return '';
}

function extractToolCallsFromTrace(trace: ParsedTrace): string[] {
  const tools: string[] = [];
  for (const span of trace.spans) {
    // Tool spans typically have span name matching "tool:..." or gen_ai.tool.name attribute
    const toolName =
      (span.attributes['gen_ai.tool.name'] as string | undefined) ??
      (span.attributes['tool.name'] as string | undefined);
    if (toolName) {
      tools.push(toolName);
      continue;
    }
    if (span.name.startsWith('tool:') || span.name.startsWith('execute_tool')) {
      const name = span.name.replace(/^tool:/, '').replace(/^execute_tool:/, '');
      tools.push(name);
    }
  }
  return tools;
}

function sanitizeTestName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function findClusterForTrace(
  traceId: string,
  clusters: FailureCluster[],
): string | undefined {
  return clusters.find((c) => c.traceIds.includes(traceId))?.pattern;
}

/**
 * Harvest failed production traces from ES and convert them
 * to regression test cases for plugin-eval.yaml.
 */
export async function harvestTests(config: HarvestConfig): Promise<HarvestedTestCase[]> {
  const scoreThreshold = config.scoreThreshold ?? 0.5;
  const maxTests = config.maxTests ?? 20;

  const clusteringConfig: ClusteringConfig = {
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    index: config.index,
    timeRange: config.timeRange,
  };

  // Fetch low-scoring traces and failure clusters in parallel
  const [lowScoringTraces, clusters] = await Promise.all([
    findLowScoringTraces(clusteringConfig, scoreThreshold),
    clusterFailures(clusteringConfig).catch(() => [] as FailureCluster[]),
  ]);

  const traceSource = new ElasticsearchTraceSource({
    type: 'elasticsearch',
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    index: config.index,
    timeRange: config.timeRange,
  });

  const testCases: HarvestedTestCase[] = [];
  const toProcess = lowScoringTraces.slice(0, maxTests);

  const settled = await Promise.allSettled(
    toProcess.map(async (entry) => {
      const trace = await traceSource.getTrace(entry.traceId);
      if (!trace) return null;

      const prompt = extractPromptFromTrace(trace);
      if (!prompt) return null;

      const tools = extractToolCallsFromTrace(trace);
      const clusterPattern = findClusterForTrace(entry.traceId, clusters);

      // Derive a human-readable name from the prompt
      const promptSnippet = prompt.slice(0, 60).replace(/\s+/g, ' ').trim();
      const name = sanitizeTestName(promptSnippet) || `harvested-${entry.traceId.slice(0, 8)}`;

      const testCase: HarvestedTestCase = {
        name,
        prompt,
        expected: {
          tools: tools.length > 0 ? [...new Set(tools)] : undefined,
          toolSequence: tools.length > 1 ? tools : undefined,
        },
        source: {
          traceId: entry.traceId,
          timestamp: entry.timestamp,
          score: entry.score,
          failureCluster: clusterPattern,
        },
      };
      return testCase;
    }),
  );

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && outcome.value !== null) {
      testCases.push(outcome.value);
    }
  }

  // Sort worst score first
  return testCases.sort((a, b) => a.source.score - b.source.score);
}

/**
 * Convert harvested test cases to YAML string for plugin-eval.yaml.
 */
export function harvestedTestsToYaml(tests: HarvestedTestCase[], suiteName = 'harvested-regressions'): string {
  const lines: string[] = [`suites:`, `  - name: ${suiteName}`, `    layer: llm`, `    tests:`];

  for (const test of tests) {
    lines.push(`      # Harvested from production trace ${test.source.traceId} at ${test.source.timestamp}`);
    if (test.source.failureCluster) {
      lines.push(`      # Failure cluster: ${test.source.failureCluster}`);
    }
    lines.push(`      # Score: ${test.source.score.toFixed(3)}`);
    lines.push(`      - name: ${test.name}`);

    // Indent and quote the prompt
    const escapedPrompt = test.prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const promptLines = escapedPrompt.split('\n');
    if (promptLines.length === 1) {
      lines.push(`        prompt: "${escapedPrompt}"`);
    } else {
      lines.push(`        prompt: |`);
      for (const line of promptLines) {
        lines.push(`          ${line}`);
      }
    }

    if (test.expected.tools || test.expected.toolSequence) {
      lines.push(`        expected:`);
      if (test.expected.tools && test.expected.tools.length > 0) {
        lines.push(`          tools:`);
        for (const tool of test.expected.tools) {
          lines.push(`            - ${tool}`);
        }
      }
      if (test.expected.toolSequence && test.expected.toolSequence.length > 1) {
        lines.push(`          toolSequence:`);
        for (const tool of test.expected.toolSequence) {
          lines.push(`            - ${tool}`);
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}
