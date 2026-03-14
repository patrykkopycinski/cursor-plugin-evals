import type {
  TestResult,
  SuiteConfig,
  PluginConfig,
  UnitTestConfig,
  McpToolDefinition,
} from '../../core/types.js';
import { parseEntry } from '../../core/utils.js';
import { McpPluginClient } from '../../mcp/client.js';
import { log } from '../../cli/logger.js';

async function spawnClient(
  pluginConfig: PluginConfig,
  envOverride?: Record<string, string>,
  isolateEnv?: boolean,
): Promise<McpPluginClient> {
  if (!pluginConfig.entry && !pluginConfig.transport) {
    throw new Error('plugin.entry or plugin.transport is required for unit layer');
  }

  if (pluginConfig.transport && pluginConfig.transport !== 'stdio') {
    return McpPluginClient.connect({
      transport: {
        type: pluginConfig.transport,
        url: pluginConfig.url,
        headers: pluginConfig.headers,
      },
      env: { ...pluginConfig.env, ...envOverride },
    });
  }

  const { command, args } = parseEntry(pluginConfig.entry!);
  return McpPluginClient.connect({
    command,
    args,
    cwd: pluginConfig.dir,
    buildCommand: pluginConfig.buildCommand,
    env: isolateEnv ? (envOverride ?? {}) : { ...pluginConfig.env, ...envOverride },
    isolateEnv,
  });
}

function makeResult(
  test: UnitTestConfig,
  suite: string,
  pass: boolean,
  latencyMs: number,
  error?: string,
): TestResult {
  return {
    name: test.name,
    suite,
    layer: 'unit',
    pass,
    toolCalls: [],
    evaluatorResults: [],
    latencyMs,
    error,
  };
}

async function checkRegistration(
  test: UnitTestConfig,
  suite: string,
  pluginConfig: PluginConfig,
): Promise<TestResult> {
  const start = performance.now();
  let client: McpPluginClient | undefined;

  try {
    client = await spawnClient(pluginConfig, test.env);
    const tools = await client.listTools();
    const toolNames = new Set(tools.map((t) => t.name));

    const expected = test.expectedTools ?? [];
    const missing = expected.filter((name) => !toolNames.has(name));

    if (missing.length > 0) {
      return makeResult(
        test,
        suite,
        false,
        performance.now() - start,
        `Missing tools: [${missing.join(', ')}]`,
      );
    }

    return makeResult(test, suite, true, performance.now() - start);
  } catch (err) {
    return makeResult(
      test,
      suite,
      false,
      performance.now() - start,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await client?.disconnect();
  }
}

function validateSchema(tool: McpToolDefinition): string[] {
  const errors: string[] = [];
  const schema = tool.inputSchema;

  if (!schema || typeof schema !== 'object') {
    errors.push(`Tool "${tool.name}": inputSchema is missing or not an object`);
    return errors;
  }

  if (schema.type !== 'object') {
    errors.push(`Tool "${tool.name}": inputSchema.type should be "object", got "${schema.type}"`);
  }

  if (!tool.description || tool.description.trim().length === 0) {
    errors.push(`Tool "${tool.name}": description is empty`);
  }

  if (schema.properties && typeof schema.properties === 'object') {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (!propSchema.description || propSchema.description.trim().length === 0) {
        errors.push(`Tool "${tool.name}": property "${propName}" has no description`);
      }
    }
  }

  if (schema.required && !Array.isArray(schema.required)) {
    errors.push(`Tool "${tool.name}": required must be an array`);
  }

  return errors;
}

async function checkSchema(
  test: UnitTestConfig,
  suite: string,
  pluginConfig: PluginConfig,
): Promise<TestResult> {
  const start = performance.now();
  let client: McpPluginClient | undefined;

  try {
    client = await spawnClient(pluginConfig, test.env);
    const tools = await client.listTools();

    const targetTools = test.expectedTools
      ? tools.filter((t) => test.expectedTools!.includes(t.name))
      : tools;

    const allErrors: string[] = [];
    for (const tool of targetTools) {
      allErrors.push(...validateSchema(tool));
    }

    if (allErrors.length > 0) {
      return makeResult(test, suite, false, performance.now() - start, allErrors.join('; '));
    }

    return makeResult(test, suite, true, performance.now() - start);
  } catch (err) {
    return makeResult(
      test,
      suite,
      false,
      performance.now() - start,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await client?.disconnect();
  }
}

async function checkConditionalRegistration(
  test: UnitTestConfig,
  suite: string,
  pluginConfig: PluginConfig,
): Promise<TestResult> {
  const start = performance.now();
  let minimalClient: McpPluginClient | undefined;
  let fullClient: McpPluginClient | undefined;

  try {
    minimalClient = await spawnClient(pluginConfig, test.minimalEnv ?? {}, true);
    const minimalTools = await minimalClient.listTools();
    const minimalNames = new Set(minimalTools.map((t) => t.name));
    await minimalClient.disconnect();
    minimalClient = undefined;

    fullClient = await spawnClient(pluginConfig, test.env);
    const fullTools = await fullClient.listTools();
    const fullNames = new Set(fullTools.map((t) => t.name));

    const expected = test.expectedTools ?? [];
    const errors: string[] = [];

    for (const toolName of expected) {
      if (minimalNames.has(toolName)) {
        errors.push(`Tool "${toolName}" should NOT be registered with minimal env but was found`);
      }
      if (!fullNames.has(toolName)) {
        errors.push(`Tool "${toolName}" should be registered with full env but was NOT found`);
      }
    }

    if (errors.length > 0) {
      return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
    }

    return makeResult(test, suite, true, performance.now() - start);
  } catch (err) {
    return makeResult(
      test,
      suite,
      false,
      performance.now() - start,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await minimalClient?.disconnect();
    await fullClient?.disconnect();
  }
}

async function checkResponseFormat(
  test: UnitTestConfig,
  suite: string,
  pluginConfig: PluginConfig,
): Promise<TestResult> {
  const start = performance.now();
  let client: McpPluginClient | undefined;

  try {
    if (!test.tool) {
      return makeResult(
        test,
        suite,
        false,
        performance.now() - start,
        'response_format check requires a "tool" field',
      );
    }

    client = await spawnClient(pluginConfig, test.env);
    const result = await client.callTool(test.tool, test.args ?? {});

    if (!Array.isArray(result.content)) {
      return makeResult(
        test,
        suite,
        false,
        performance.now() - start,
        `Expected content to be an array, got ${typeof result.content}`,
      );
    }

    for (let i = 0; i < result.content.length; i++) {
      const item = result.content[i];
      if (!item.type || typeof item.type !== 'string') {
        return makeResult(
          test,
          suite,
          false,
          performance.now() - start,
          `content[${i}] missing or invalid "type" field`,
        );
      }
      if (item.type === 'text' && typeof item.text !== 'string') {
        return makeResult(
          test,
          suite,
          false,
          performance.now() - start,
          `content[${i}] has type "text" but text field is ${typeof item.text}`,
        );
      }
    }

    return makeResult(test, suite, true, performance.now() - start);
  } catch (err) {
    return makeResult(
      test,
      suite,
      false,
      performance.now() - start,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await client?.disconnect();
  }
}

const CHECK_HANDLERS: Record<
  UnitTestConfig['check'],
  (test: UnitTestConfig, suite: string, pluginConfig: PluginConfig) => Promise<TestResult>
> = {
  registration: checkRegistration,
  schema: checkSchema,
  conditional_registration: checkConditionalRegistration,
  response_format: checkResponseFormat,
};

export async function runUnitSuite(
  suite: SuiteConfig,
  pluginConfig: PluginConfig,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const test of suite.tests) {
    const unitTest = test as UnitTestConfig;
    const handler = CHECK_HANDLERS[unitTest.check];

    if (!handler) {
      results.push(
        makeResult(unitTest, suite.name, false, 0, `Unknown check type: "${unitTest.check}"`),
      );
      continue;
    }

    log.test(unitTest.name, 'running');
    const result = await handler(unitTest, suite.name, pluginConfig);
    log.test(unitTest.name, result.pass ? 'pass' : 'fail');

    if (!result.pass && result.error) {
      log.debug(result.error);
    }

    results.push(result);
  }

  return results;
}
