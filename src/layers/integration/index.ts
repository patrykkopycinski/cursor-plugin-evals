import type {
  TestResult,
  SuiteConfig,
  DefaultsConfig,
  IntegrationTestConfig,
  ToolCallRecord,
  WorkflowStep,
} from '../../core/types.js';
import type { McpPluginClient } from '../../mcp/client.js';
import { evaluateAssertions } from './assertions.js';
import { mergeDefaults, resolveDotPath, getMissingEnvVars } from '../../core/utils.js';
import { log } from '../../cli/logger.js';

const PREV_REF_PATTERN = /\$prev\.([a-zA-Z0-9_.]+)/g;

function resolveVariableRefs(
  args: Record<string, unknown>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      const fullMatch = value.match(/^\$prev\.([a-zA-Z0-9_.]+)$/);
      if (fullMatch) {
        const val = resolveDotPath(variables, fullMatch[1]);
        if (val !== undefined) {
          resolved[key] = val;
          continue;
        }
      }

      resolved[key] = value.replace(PREV_REF_PATTERN, (_match, path: string) => {
        const val = resolveDotPath(variables, path);
        return val !== undefined ? String(val) : _match;
      });
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      resolved[key] = resolveVariableRefs(value as Record<string, unknown>, variables);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

function parseToolResponse(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): unknown {
  const textParts = result.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text!);
  const joined = textParts.join('');

  let parsed: unknown;
  try {
    parsed = JSON.parse(joined);
  } catch {
    parsed = joined;
  }

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return { ...parsed, content: result.content, isError: result.isError ?? false };
  }

  return { content: result.content, isError: result.isError ?? false, _body: parsed };
}

async function executeToolCall(
  client: McpPluginClient,
  tool: string,
  args: Record<string, unknown>,
  timeout: number,
): Promise<ToolCallRecord> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Tool call "${tool}" timed out after ${timeout}ms`)),
        timeout,
      );
    });

    const result = await Promise.race([client.callTool(tool, args), timeoutPromise]);

    return {
      tool,
      args,
      result,
      latencyMs: performance.now() - start,
    };
  } catch (err) {
    return {
      tool,
      args,
      result: {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      },
      latencyMs: performance.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runSingleTest(
  test: IntegrationTestConfig,
  suiteName: string,
  client: McpPluginClient,
  defaults: DefaultsConfig,
): Promise<TestResult> {
  const start = performance.now();
  const timeout = defaults.timeout ?? 30_000;
  const toolCalls: ToolCallRecord[] = [];

  try {
    if (test.workflow && test.workflow.length > 0) {
      return await runWorkflow(test, suiteName, client, timeout, start);
    }

    const record = await executeToolCall(client, test.tool, test.args ?? {}, timeout);
    toolCalls.push(record);

    if (record.result.isError && !test.expectError) {
      return {
        name: test.name,
        suite: suiteName,
        layer: 'integration',
        pass: false,
        toolCalls,
        evaluatorResults: [],
        latencyMs: performance.now() - start,
        error: `Tool returned error: ${record.result.content.map((c) => c.text).join('')}`,
      };
    }

    if (test.expectError && !record.result.isError) {
      return {
        name: test.name,
        suite: suiteName,
        layer: 'integration',
        pass: false,
        toolCalls,
        evaluatorResults: [],
        latencyMs: performance.now() - start,
        error: 'Expected tool to return an error but it succeeded',
      };
    }

    if (test.assert && test.assert.length > 0) {
      const parsed = parseToolResponse(record.result);
      const evaluation = evaluateAssertions(parsed, test.assert);

      if (!evaluation.pass) {
        const failures = evaluation.results
          .filter((r) => !r.pass)
          .map(
            (r) =>
              `${r.field} ${r.op}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`,
          )
          .join('; ');

        return {
          name: test.name,
          suite: suiteName,
          layer: 'integration',
          pass: false,
          toolCalls,
          evaluatorResults: [],
          latencyMs: performance.now() - start,
          error: `Assertion failures: ${failures}`,
        };
      }
    }

    return {
      name: test.name,
      suite: suiteName,
      layer: 'integration',
      pass: true,
      toolCalls,
      evaluatorResults: [],
      latencyMs: performance.now() - start,
    };
  } catch (err) {
    return {
      name: test.name,
      suite: suiteName,
      layer: 'integration',
      pass: false,
      toolCalls,
      evaluatorResults: [],
      latencyMs: performance.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runWorkflow(
  test: IntegrationTestConfig,
  suiteName: string,
  client: McpPluginClient,
  timeout: number,
  startTime: number,
): Promise<TestResult> {
  const toolCalls: ToolCallRecord[] = [];
  const variables: Record<string, unknown> = {};
  const steps = test.workflow as WorkflowStep[];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const resolvedArgs = resolveVariableRefs(step.args, variables);

    const record = await executeToolCall(client, step.tool, resolvedArgs, timeout);
    toolCalls.push(record);

    if (record.result.isError) {
      return {
        name: test.name,
        suite: suiteName,
        layer: 'integration',
        pass: false,
        toolCalls,
        evaluatorResults: [],
        latencyMs: performance.now() - startTime,
        error: `Workflow step ${i} ("${step.tool}") returned error: ${record.result.content.map((c) => c.text).join('')}`,
      };
    }

    const parsed = parseToolResponse(record.result);

    if (step.output) {
      variables[step.output] = parsed;
      variables['prev'] = parsed;
    } else {
      variables['prev'] = parsed;
    }

    if (step.assert && step.assert.length > 0) {
      const evaluation = evaluateAssertions(parsed, step.assert);

      if (!evaluation.pass) {
        const failures = evaluation.results
          .filter((r) => !r.pass)
          .map(
            (r) =>
              `${r.field} ${r.op}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`,
          )
          .join('; ');

        return {
          name: test.name,
          suite: suiteName,
          layer: 'integration',
          pass: false,
          toolCalls,
          evaluatorResults: [],
          latencyMs: performance.now() - startTime,
          error: `Workflow step ${i} assertion failures: ${failures}`,
        };
      }
    }
  }

  return {
    name: test.name,
    suite: suiteName,
    layer: 'integration',
    pass: true,
    toolCalls,
    evaluatorResults: [],
    latencyMs: performance.now() - startTime,
  };
}

export async function runIntegrationSuite(
  suite: SuiteConfig,
  client: McpPluginClient,
  defaults: DefaultsConfig,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const mergedDefaults: DefaultsConfig = mergeDefaults(suite.defaults, defaults);

  for (const test of suite.tests) {
    const integrationTest = test as IntegrationTestConfig;
    const missingEnv = getMissingEnvVars(integrationTest.requireEnv, suite.requireEnv);

    if (missingEnv.length > 0) {
      log.test(integrationTest.name, 'skip');
      results.push({
        name: integrationTest.name,
        suite: suite.name,
        layer: 'integration',
        pass: true,
        skipped: true,
        toolCalls: [],
        evaluatorResults: [],
        latencyMs: 0,
        error: `Skipped: missing env ${missingEnv.join(', ')}`,
      });
      continue;
    }

    log.test(integrationTest.name, 'running');
    const result = await runSingleTest(integrationTest, suite.name, client, mergedDefaults);
    log.test(integrationTest.name, result.pass ? 'pass' : 'fail');

    if (!result.pass && result.error) {
      log.debug(result.error);
    }

    results.push(result);
  }

  return results;
}
