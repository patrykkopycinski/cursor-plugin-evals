import type {
  TestResult,
  SuiteConfig,
  DefaultsConfig,
  LlmTestConfig,
  PluginConfig,
  Evaluator,
  EvaluatorContext,
  EvaluatorResult,
  McpToolDefinition,
} from '../../core/types.js';
import { McpPluginClient } from '../../mcp/client.js';
import { runAgentLoop } from './agent-loop.js';
import { buildSystemPrompt } from './system-prompt.js';
import { generateDistractors } from './distractors.js';
import { runConversationTest } from './conversation.js';
import { mergeDefaults, parseEntry, getMissingEnvVars } from '../../core/utils.js';
import { log } from '../../cli/logger.js';

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_MODEL = 'gpt-5.4';

async function runSingleLlmTest(
  test: LlmTestConfig,
  suiteName: string,
  pluginConfig: PluginConfig,
  tools: McpToolDefinition[],
  mcpClient: McpPluginClient,
  defaults: DefaultsConfig,
  model: string,
  evaluators: Evaluator[],
  repetition?: number,
): Promise<TestResult> {
  const start = performance.now();
  const maxTurns =
    test.maxTurns ?? (defaults.thresholds?.['maxTurns'] as number | undefined) ?? DEFAULT_MAX_TURNS;
  const timeout = defaults.timeout ?? DEFAULT_TIMEOUT;

  const systemPrompt = buildSystemPrompt(pluginConfig.name, tools, test.system);

  const distractorConfig = test.distractors;
  let effectiveTools = tools;
  if (distractorConfig && distractorConfig.mode !== 'none') {
    const distractors = generateDistractors(
      distractorConfig.mode,
      distractorConfig.count ?? 5,
      tools,
    );
    if (distractors.length > 0) {
      effectiveTools = [...tools, ...distractors];
      log.debug(
        `  Injected ${distractors.length} distractor tools (mode: ${distractorConfig.mode})`,
      );
    }
  }

  try {
    const result = await runAgentLoop({
      model,
      systemPrompt,
      userPrompt: test.prompt,
      tools: effectiveTools,
      mcpClient,
      maxTurns,
      timeout,
    });

    const evaluatorContext: EvaluatorContext = {
      testName: test.name,
      prompt: test.prompt,
      toolCalls: result.toolCalls,
      finalOutput: result.finalOutput,
      expected: test.expected,
      config: defaults.thresholds as Record<string, unknown> | undefined,
      tokenUsage: result.tokenUsage ?? undefined,
    };

    const evaluatorResults: EvaluatorResult[] = [];
    for (const evaluator of evaluators) {
      try {
        const evalResult = await evaluator.evaluate(evaluatorContext);
        evaluatorResults.push(evalResult);
      } catch (err) {
        evaluatorResults.push({
          evaluator: evaluator.name,
          score: 0,
          pass: false,
          label: 'error',
          explanation: `Evaluator failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const allPass = evaluatorResults.length === 0 || evaluatorResults.every((r) => r.pass);

    return {
      name: test.name,
      suite: suiteName,
      layer: 'llm',
      pass: allPass && !result.aborted,
      toolCalls: result.toolCalls,
      evaluatorResults,
      tokenUsage: result.tokenUsage,
      latencyMs: performance.now() - start,
      model,
      repetition,
      error: result.aborted ? `Agent loop aborted after ${result.turns} turns` : undefined,
      conversation: result.messages.length > 0 ? result.messages : undefined,
    };
  } catch (err) {
    return {
      name: test.name,
      suite: suiteName,
      layer: 'llm',
      pass: false,
      toolCalls: [],
      evaluatorResults: [],
      latencyMs: performance.now() - start,
      model,
      repetition,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runLlmSuite(
  suite: SuiteConfig,
  pluginConfig: PluginConfig,
  defaults: DefaultsConfig,
  evaluatorRegistry: Map<string, Evaluator>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const mergedDefaults: DefaultsConfig = mergeDefaults(suite.defaults, defaults);
  const repetitions = mergedDefaults.repetitions ?? 1;

  if (!pluginConfig.entry && !pluginConfig.transport) {
    throw new Error('plugin.entry or plugin.transport is required for LLM layer');
  }

  let client: McpPluginClient;
  if (pluginConfig.transport && pluginConfig.transport !== 'stdio') {
    client = await McpPluginClient.connect({
      transport: {
        type: pluginConfig.transport,
        url: pluginConfig.url,
        headers: pluginConfig.headers,
      },
      buildCommand: pluginConfig.buildCommand,
      env: pluginConfig.env,
    });
  } else {
    const { command, args } = parseEntry(pluginConfig.entry!);
    client = await McpPluginClient.connect({
      command,
      args,
      cwd: pluginConfig.dir,
      buildCommand: pluginConfig.buildCommand,
      env: pluginConfig.env,
    });
  }

  try {
    const tools = await client.listTools();

    for (const test of suite.tests) {
      const llmTest = test as LlmTestConfig;
      const missingEnv = getMissingEnvVars(llmTest.requireEnv, suite.requireEnv);

      if (missingEnv.length > 0) {
        log.test(llmTest.name, 'skip');
        results.push({
          name: llmTest.name,
          suite: suite.name,
          layer: 'llm',
          pass: true,
          skipped: true,
          toolCalls: [],
          evaluatorResults: [],
          latencyMs: 0,
          error: `Skipped: missing env ${missingEnv.join(', ')}`,
        });
        continue;
      }

      const models = llmTest.models ?? [mergedDefaults.judgeModel ?? DEFAULT_MODEL];

      const testEvaluators: Evaluator[] = [];
      for (const evalName of llmTest.evaluators) {
        const evaluator = evaluatorRegistry.get(evalName);
        if (evaluator) {
          testEvaluators.push(evaluator);
        } else {
          log.warn(`Evaluator "${evalName}" not found in registry, skipping`);
        }
      }

      for (const model of models) {
        for (let rep = 1; rep <= repetitions; rep++) {
          const displayName =
            models.length > 1 || repetitions > 1
              ? `${llmTest.name} [${model}${repetitions > 1 ? ` #${rep}` : ''}]`
              : llmTest.name;

          log.test(displayName, 'running');

          let result: TestResult;

          if (llmTest.type === 'conversation') {
            result = await runConversationTest(
              llmTest,
              suite.name,
              pluginConfig,
              tools,
              client,
              mergedDefaults,
              model,
              evaluatorRegistry,
              repetitions > 1 ? rep : undefined,
            );
          } else {
            result = await runSingleLlmTest(
              llmTest,
              suite.name,
              pluginConfig,
              tools,
              client,
              mergedDefaults,
              model,
              testEvaluators,
              repetitions > 1 ? rep : undefined,
            );
          }

          log.test(displayName, result.pass ? 'pass' : 'fail');

          for (const evalResult of result.evaluatorResults) {
            log.evaluator(evalResult.evaluator, evalResult.score, evalResult.pass);
          }

          if (!result.pass && result.error) {
            log.debug(result.error);
          }

          results.push(result);
        }
      }
    }
  } finally {
    await client.disconnect();
  }

  return results;
}
