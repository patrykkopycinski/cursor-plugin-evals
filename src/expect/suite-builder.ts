import type {
  Layer,
  SuiteConfig,
  TestConfig,
  AssertionConfig,
  ExpectedOutput,
  DefaultsConfig,
} from '../core/types.js';

interface IntegrationTestInput {
  tool: string;
  args?: Record<string, unknown>;
  assert?: AssertionConfig[];
  setup?: string;
  teardown?: string;
  expectError?: boolean;
}

interface LlmTestInput {
  prompt: string;
  expected?: Partial<ExpectedOutput>;
  evaluators?: string[];
  maxTurns?: number;
  models?: string[];
  system?: string;
}

interface SuiteHelpers {
  integration(name: string, config: IntegrationTestInput): void;
  llm(name: string, config: LlmTestInput): void;
}

interface SuiteOptions {
  name: string;
  layer: Layer;
  setup?: string;
  teardown?: string;
  defaults?: DefaultsConfig;
}

export function defineSuite(
  config: SuiteOptions,
  fn: (helpers: SuiteHelpers) => void,
): SuiteConfig {
  const tests: TestConfig[] = [];

  const helpers: SuiteHelpers = {
    integration(name, input) {
      tests.push({
        name,
        tool: input.tool,
        args: input.args ?? {},
        assert: input.assert,
        setup: input.setup,
        teardown: input.teardown,
        expectError: input.expectError,
      });
    },

    llm(name, input) {
      tests.push({
        name,
        prompt: input.prompt,
        expected: {
          tools: input.expected?.tools,
          toolArgs: input.expected?.toolArgs,
          toolSequence: input.expected?.toolSequence,
          responseContains: input.expected?.responseContains,
          responseNotContains: input.expected?.responseNotContains,
          clusterState: input.expected?.clusterState,
        },
        evaluators: input.evaluators ?? ['tool-selection'],
        maxTurns: input.maxTurns,
        models: input.models,
        system: input.system,
      });
    },
  };

  fn(helpers);

  return {
    name: config.name,
    layer: config.layer,
    setup: config.setup,
    teardown: config.teardown,
    defaults: config.defaults,
    tests,
  };
}
