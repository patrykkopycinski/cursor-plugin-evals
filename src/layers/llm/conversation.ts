import type {
  TestResult,
  LlmTestConfig,
  PluginConfig,
  DefaultsConfig,
  Evaluator,
  EvaluatorContext,
  EvaluatorResult,
  McpToolDefinition,
  ToolCallRecord,
  TokenUsage,
  ConversationTurn,
} from '../../core/types.js';
import type { McpPluginClient } from '../../mcp/client.js';
import { runAgentLoop } from './agent-loop.js';
import { buildSystemPrompt } from './system-prompt.js';
import { generateDistractors } from './distractors.js';
import { log } from '../../cli/logger.js';

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT = 120_000;

interface TurnResult {
  turnIndex: number;
  prompt: string;
  toolCalls: ToolCallRecord[];
  evaluatorResults: EvaluatorResult[];
  finalOutput: string;
  pass: boolean;
  tokenUsage: TokenUsage;
  turns: number;
  aborted: boolean;
}

export async function runConversationTest(
  test: LlmTestConfig,
  suiteName: string,
  pluginConfig: PluginConfig,
  tools: McpToolDefinition[],
  mcpClient: McpPluginClient,
  defaults: DefaultsConfig,
  model: string,
  evaluatorRegistry: Map<string, Evaluator>,
  repetition?: number,
): Promise<TestResult> {
  const start = performance.now();
  const maxTurns =
    test.maxTurns ?? (defaults.thresholds?.['maxTurns'] as number | undefined) ?? DEFAULT_MAX_TURNS;
  const timeout = defaults.timeout ?? DEFAULT_TIMEOUT;

  const allTurns: ConversationTurn[] = [
    {
      prompt: test.prompt,
      system: test.system,
      expected: test.expected,
      evaluators: test.evaluators,
    },
    ...(test.turns ?? []),
  ];

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

  const turnResults: TurnResult[] = [];
  const allToolCalls: ToolCallRecord[] = [];
  const totalUsage: TokenUsage = { input: 0, output: 0 };
  let messageHistory: Array<{ role: string; content: string }> = [];

  try {
    for (let i = 0; i < allTurns.length; i++) {
      const turn = allTurns[i];
      const systemPrompt = buildSystemPrompt(
        pluginConfig.name,
        effectiveTools,
        turn.system ?? test.system,
      );

      log.debug(`  Conversation turn ${i + 1}/${allTurns.length}: ${turn.prompt.slice(0, 80)}`);

      const result = await runAgentLoop({
        model,
        systemPrompt,
        userPrompt: turn.prompt,
        tools: effectiveTools,
        mcpClient,
        maxTurns,
        timeout,
        priorMessages: messageHistory.length > 0 ? messageHistory : undefined,
      });

      totalUsage.input += result.tokenUsage.input;
      totalUsage.output += result.tokenUsage.output;
      if (result.tokenUsage.cached) {
        totalUsage.cached = (totalUsage.cached ?? 0) + result.tokenUsage.cached;
      }

      allToolCalls.push(...result.toolCalls);

      messageHistory = [
        ...messageHistory,
        { role: 'user', content: turn.prompt },
        { role: 'assistant', content: result.finalOutput },
      ];

      const turnEvaluatorNames = turn.evaluators ?? test.evaluators;
      const turnEvaluators: Evaluator[] = [];
      for (const name of turnEvaluatorNames) {
        const evaluator = evaluatorRegistry.get(name);
        if (evaluator) {
          turnEvaluators.push(evaluator);
        } else {
          log.warn(`Evaluator "${name}" not found in registry, skipping`);
        }
      }

      const evaluatorContext: EvaluatorContext = {
        testName: `${test.name}[turn-${i}]`,
        prompt: turn.prompt,
        toolCalls: result.toolCalls,
        finalOutput: result.finalOutput,
        expected: turn.expected ?? test.expected,
        config: defaults.thresholds as Record<string, unknown> | undefined,
        tokenUsage: result.tokenUsage ?? undefined,
      };

      const evaluatorResults: EvaluatorResult[] = [];
      for (const evaluator of turnEvaluators) {
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

      const turnPass = evaluatorResults.length === 0 || evaluatorResults.every((r) => r.pass);

      turnResults.push({
        turnIndex: i,
        prompt: turn.prompt,
        toolCalls: result.toolCalls,
        evaluatorResults,
        finalOutput: result.finalOutput,
        pass: turnPass && !result.aborted,
        tokenUsage: result.tokenUsage,
        turns: result.turns,
        aborted: result.aborted,
      });

      if (result.aborted) {
        log.debug(`  Turn ${i + 1} aborted, stopping conversation`);
        break;
      }
    }

    const allEvaluatorResults = turnResults.flatMap((t) => t.evaluatorResults);
    const allPass = turnResults.every((t) => t.pass);

    return {
      name: test.name,
      suite: suiteName,
      layer: 'llm',
      pass: allPass,
      toolCalls: allToolCalls,
      evaluatorResults: allEvaluatorResults,
      tokenUsage: totalUsage,
      latencyMs: performance.now() - start,
      model,
      repetition,
      metadata: {
        type: 'conversation',
        turnCount: turnResults.length,
        turns: turnResults.map((t) => ({
          turnIndex: t.turnIndex,
          prompt: t.prompt,
          pass: t.pass,
          toolCalls: t.toolCalls.length,
          evaluatorResults: t.evaluatorResults,
          aborted: t.aborted,
        })),
      },
    } as TestResult;
  } catch (err) {
    return {
      name: test.name,
      suite: suiteName,
      layer: 'llm',
      pass: false,
      toolCalls: allToolCalls,
      evaluatorResults: [],
      latencyMs: performance.now() - start,
      model,
      repetition,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
