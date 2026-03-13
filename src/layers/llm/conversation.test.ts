import { describe, it, expect, vi } from 'vitest';
import { runConversationTest } from './conversation.js';
import type {
  LlmTestConfig,
  PluginConfig,
  DefaultsConfig,
  Evaluator,
  McpToolDefinition,
} from '../../core/types.js';
import type { McpPluginClient } from '../../mcp/client.js';

vi.mock('./agent-loop.js', () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock('./system-prompt.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
}));

vi.mock('./distractors.js', () => ({
  generateDistractors: vi.fn(() => []),
}));

vi.mock('../../cli/logger.js', () => ({
  log: { debug: vi.fn(), warn: vi.fn(), test: vi.fn(), evaluator: vi.fn() },
}));

import { runAgentLoop } from './agent-loop.js';

const mockedRunAgentLoop = vi.mocked(runAgentLoop);

const sampleTools: McpToolDefinition[] = [
  {
    name: 'search',
    description: 'Search for documents',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

const mockClient = {
  callTool: vi.fn(),
  listTools: vi.fn(),
  disconnect: vi.fn(),
} as unknown as McpPluginClient;

const pluginConfig: PluginConfig = { name: 'test-plugin', dir: '/tmp/test' };
const defaults: DefaultsConfig = {};

function makeEvaluator(name: string, pass: boolean, score = pass ? 1 : 0): Evaluator {
  return {
    name,
    evaluate: vi.fn(async () => ({ evaluator: name, score, pass })),
  };
}

function agentResult(finalOutput: string, toolNames: string[] = []) {
  return {
    finalOutput,
    toolCalls: toolNames.map((t) => ({
      tool: t,
      args: {},
      result: { content: [{ type: 'text', text: 'ok' }] },
      latencyMs: 10,
    })),
    tokenUsage: { input: 100, output: 50 },
    turns: 1,
    aborted: false,
  };
}

describe('runConversationTest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('accumulates message history across turns', async () => {
    mockedRunAgentLoop
      .mockResolvedValueOnce(agentResult('Response to first prompt'))
      .mockResolvedValueOnce(agentResult('Response to second prompt'));

    const test: LlmTestConfig = {
      name: 'multi-turn test',
      type: 'conversation',
      prompt: 'First question',
      expected: {},
      evaluators: [],
      turns: [{ prompt: 'Follow-up question' }],
    };

    const registry = new Map<string, Evaluator>();

    await runConversationTest(
      test,
      'test-suite',
      pluginConfig,
      sampleTools,
      mockClient,
      defaults,
      'gpt-4o',
      registry,
    );

    expect(mockedRunAgentLoop).toHaveBeenCalledTimes(2);

    const firstCall = mockedRunAgentLoop.mock.calls[0][0];
    expect(firstCall.userPrompt).toBe('First question');
    expect(firstCall.priorMessages).toBeUndefined();

    const secondCall = mockedRunAgentLoop.mock.calls[1][0];
    expect(secondCall.userPrompt).toBe('Follow-up question');
    expect(secondCall.priorMessages).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Response to first prompt' },
    ]);
  });

  it('tracks per-turn evaluator results', async () => {
    mockedRunAgentLoop
      .mockResolvedValueOnce(agentResult('Turn 1 response', ['search']))
      .mockResolvedValueOnce(agentResult('Turn 2 response'));

    const passEval = makeEvaluator('pass-eval', true);
    const failEval = makeEvaluator('fail-eval', false);

    const registry = new Map<string, Evaluator>([
      ['pass-eval', passEval],
      ['fail-eval', failEval],
    ]);

    const test: LlmTestConfig = {
      name: 'eval-per-turn',
      type: 'conversation',
      prompt: 'First',
      expected: {},
      evaluators: ['pass-eval'],
      turns: [{ prompt: 'Second', evaluators: ['fail-eval'] }],
    };

    const result = await runConversationTest(
      test,
      'test-suite',
      pluginConfig,
      sampleTools,
      mockClient,
      defaults,
      'gpt-4o',
      registry,
    );

    expect(result.evaluatorResults).toHaveLength(2);
    expect(result.evaluatorResults[0].evaluator).toBe('pass-eval');
    expect(result.evaluatorResults[0].pass).toBe(true);
    expect(result.evaluatorResults[1].evaluator).toBe('fail-eval');
    expect(result.evaluatorResults[1].pass).toBe(false);

    expect(result.pass).toBe(false);
  });

  it('aggregates tool calls from all turns', async () => {
    mockedRunAgentLoop
      .mockResolvedValueOnce(agentResult('Turn 1', ['search']))
      .mockResolvedValueOnce(agentResult('Turn 2', ['search', 'search']));

    const test: LlmTestConfig = {
      name: 'tool-aggregation',
      type: 'conversation',
      prompt: 'First',
      expected: {},
      evaluators: [],
      turns: [{ prompt: 'Second' }],
    };

    const registry = new Map<string, Evaluator>();

    const result = await runConversationTest(
      test,
      'test-suite',
      pluginConfig,
      sampleTools,
      mockClient,
      defaults,
      'gpt-4o',
      registry,
    );

    expect(result.toolCalls).toHaveLength(3);
  });

  it('aggregates token usage from all turns', async () => {
    mockedRunAgentLoop
      .mockResolvedValueOnce(agentResult('Turn 1'))
      .mockResolvedValueOnce(agentResult('Turn 2'));

    const test: LlmTestConfig = {
      name: 'token-aggregation',
      type: 'conversation',
      prompt: 'First',
      expected: {},
      evaluators: [],
      turns: [{ prompt: 'Second' }],
    };

    const registry = new Map<string, Evaluator>();

    const result = await runConversationTest(
      test,
      'test-suite',
      pluginConfig,
      sampleTools,
      mockClient,
      defaults,
      'gpt-4o',
      registry,
    );

    expect(result.tokenUsage).toEqual({ input: 200, output: 100 });
  });

  it('stops conversation on abort', async () => {
    mockedRunAgentLoop
      .mockResolvedValueOnce({
        ...agentResult('Turn 1'),
        aborted: true,
      })
      .mockResolvedValueOnce(agentResult('Turn 2'));

    const test: LlmTestConfig = {
      name: 'abort-test',
      type: 'conversation',
      prompt: 'First',
      expected: {},
      evaluators: [],
      turns: [{ prompt: 'Second' }],
    };

    const registry = new Map<string, Evaluator>();

    const result = await runConversationTest(
      test,
      'test-suite',
      pluginConfig,
      sampleTools,
      mockClient,
      defaults,
      'gpt-4o',
      registry,
    );

    expect(mockedRunAgentLoop).toHaveBeenCalledTimes(1);
    expect(result.pass).toBe(false);
  });

  it('includes per-turn metadata', async () => {
    mockedRunAgentLoop
      .mockResolvedValueOnce(agentResult('Turn 1'))
      .mockResolvedValueOnce(agentResult('Turn 2'));

    const test: LlmTestConfig = {
      name: 'metadata-test',
      type: 'conversation',
      prompt: 'First',
      expected: {},
      evaluators: [],
      turns: [{ prompt: 'Second' }],
    };

    const registry = new Map<string, Evaluator>();

    const result = await runConversationTest(
      test,
      'test-suite',
      pluginConfig,
      sampleTools,
      mockClient,
      defaults,
      'gpt-4o',
      registry,
    );

    const meta = result.metadata as Record<string, unknown>;
    expect(meta.type).toBe('conversation');
    expect(meta.turnCount).toBe(2);
    expect(Array.isArray(meta.turns)).toBe(true);
    const turns = meta.turns as Array<{ turnIndex: number; prompt: string; pass: boolean }>;
    expect(turns[0].turnIndex).toBe(0);
    expect(turns[0].prompt).toBe('First');
    expect(turns[1].turnIndex).toBe(1);
    expect(turns[1].prompt).toBe('Second');
  });

  it('returns error result when agent loop throws', async () => {
    mockedRunAgentLoop.mockRejectedValue(new Error('LLM exploded'));

    const test: LlmTestConfig = {
      name: 'error-test',
      type: 'conversation',
      prompt: 'First',
      expected: {},
      evaluators: [],
    };

    const registry = new Map<string, Evaluator>();

    const result = await runConversationTest(
      test,
      'test-suite',
      pluginConfig,
      sampleTools,
      mockClient,
      defaults,
      'gpt-4o',
      registry,
    );

    expect(mockedRunAgentLoop).toHaveBeenCalledTimes(1);
    expect(result.pass).toBe(false);
    expect(result.error).toBe('LLM exploded');
  });
});
