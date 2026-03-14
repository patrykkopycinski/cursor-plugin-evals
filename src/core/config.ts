import { readFileSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { EvalConfig } from './types.js';
import { resolveCollectionPath, loadCollectionSuite } from './collections.js';

const AssertionOpSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'exists',
  'not_exists',
  'length_gte',
  'length_lte',
  'type',
  'matches',
]);

const AssertionConfigSchema = z.object({
  field: z.string(),
  op: AssertionOpSchema,
  value: z.unknown().optional(),
});

const WorkflowStepSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  output: z.string().optional(),
  assert: z.array(AssertionConfigSchema).optional(),
});

const ClusterStateAssertionSchema = z.object({
  method: z.string(),
  path: z.string(),
  assert: z.array(AssertionConfigSchema),
});

const DefaultsConfigSchema = z
  .object({
    timeout: z.number().positive().optional(),
    judge_model: z.string().optional(),
    repetitions: z.number().int().positive().optional(),
    thresholds: z.record(z.string(), z.union([
      z.number().min(0).max(1),
      z.record(z.string(), z.unknown()),
    ])).optional(),
  })
  .optional();

const ExpectedOutputSchema = z.object({
  tools: z.array(z.string()).optional(),
  tool_args: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  tool_sequence: z.array(z.string()).optional(),
  golden_path: z.array(z.string()).optional(),
  response_contains: z.array(z.string()).optional(),
  response_not_contains: z.array(z.string()).optional(),
  cluster_state: z.array(ClusterStateAssertionSchema).optional(),
});

const DifficultySchema = z.enum(['simple', 'moderate', 'complex', 'adversarial']).optional();

const UnitTestSchema = z.object({
  name: z.string(),
  difficulty: DifficultySchema,
  check: z.enum(['registration', 'schema', 'conditional_registration', 'response_format']),
  expected_tools: z.array(z.string()).optional(),
  tool: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  minimal_env: z.record(z.string(), z.string()).optional(),
});

const IntegrationTestSchema = z.object({
  name: z.string(),
  difficulty: DifficultySchema,
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  assert: z.array(AssertionConfigSchema).optional(),
  setup: z.string().optional(),
  teardown: z.string().optional(),
  workflow: z.array(WorkflowStepSchema).optional(),
  expect_error: z.boolean().optional(),
  require_env: z.array(z.string()).optional(),
});

const DistractorConfigSchema = z
  .object({
    mode: z.enum(['random', 'targeted', 'none']),
    count: z.number().int().nonnegative().optional(),
  })
  .optional();

const ConversationTurnSchema = z.object({
  prompt: z.string(),
  system: z.string().optional(),
  expected: ExpectedOutputSchema.optional(),
  evaluators: z.array(z.string()).optional(),
});

const LlmTestSchema = z.object({
  name: z.string(),
  difficulty: DifficultySchema,
  type: z.enum(['single', 'conversation']).optional(),
  prompt: z.string(),
  expected: ExpectedOutputSchema,
  evaluators: z.array(z.string()),
  max_turns: z.number().int().positive().optional(),
  models: z.array(z.string()).optional(),
  system: z.string().optional(),
  turns: z.array(ConversationTurnSchema).optional(),
  distractors: DistractorConfigSchema,
});

const StaticTestSchema = z.object({
  name: z.string(),
  difficulty: DifficultySchema,
  check: z.enum([
    'manifest',
    'skill_frontmatter',
    'rule_frontmatter',
    'agent_frontmatter',
    'command_frontmatter',
    'hooks_schema',
    'mcp_config',
    'component_references',
    'cross_component_coherence',
    'naming_conventions',
  ]),
  components: z.array(z.string()).optional(),
});

const PerformanceTestSchema = z.object({
  name: z.string(),
  difficulty: DifficultySchema,
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  warmup: z.number().int().nonnegative().optional(),
  iterations: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
  thresholds: z
    .object({
      p50: z.number().positive().optional(),
      p95: z.number().positive().optional(),
      p99: z.number().positive().optional(),
    })
    .optional(),
  require_env: z.array(z.string()).optional(),
});

const TestSchema = z.union([
  UnitTestSchema,
  StaticTestSchema,
  IntegrationTestSchema,
  LlmTestSchema,
  PerformanceTestSchema,
]);

const LayerSchema = z.enum(['unit', 'static', 'integration', 'llm', 'performance', 'skill']);

const SuiteEvaluatorOverridesSchema = z.object({
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
  override: z.array(z.string()).optional(),
}).optional();

const TestFilterSchema = z.object({
  adapters: z.array(z.string()).optional(),
}).optional();

const SuiteSchema = z.object({
  name: z.string(),
  layer: LayerSchema,
  setup: z.string().optional(),
  teardown: z.string().optional(),
  defaults: DefaultsConfigSchema,
  tests: z.array(TestSchema),
  adapter: z.union([z.string(), z.array(z.string())]).optional(),
  skill_dir: z.string().optional(),
  skill_path: z.string().optional(),
  require_env: z.array(z.string()).optional(),
  evaluators: SuiteEvaluatorOverridesSchema,
  test_filter: TestFilterSchema,
});

const AuthSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('api-key'),
    key: z.string(),
    header: z.string().optional(),
    prefix: z.string().optional(),
  }),
  z.object({
    type: z.literal('bearer'),
    token: z.string(),
  }),
  z.object({
    type: z.literal('oauth2'),
    token_url: z.string(),
    client_id: z.string(),
    client_secret: z.string(),
    scopes: z.array(z.string()).optional(),
  }),
]);

const TransportTypeSchema = z.enum(['stdio', 'http', 'sse', 'streamable-http']);

const PluginSchema = z
  .object({
    name: z.string(),
    dir: z.string().optional(),
    entry: z.string().optional(),
    plugin_root: z.string().optional(),
    build_command: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    transport: TransportTypeSchema.optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    auth: AuthSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.transport && data.transport !== 'stdio' && !data.url) {
        return false;
      }
      return true;
    },
    { message: 'plugin.url is required when transport is http, sse, or streamable-http' },
  );

const InfrastructureSchema = z
  .object({
    docker_compose: z.string().optional(),
    obs_es_url: z.string().optional(),
  })
  .optional();

const TracingSchema = z
  .object({
    otel_endpoint: z.string().optional(),
    langsmith_project: z.string().optional(),
  })
  .optional();

const CollectionSuiteSchema = z.object({
  collection: z.string(),
});

const SuiteEntrySchema = z.union([
  SuiteSchema,
  CollectionSuiteSchema,
  z
    .string()
    .regex(
      /\.(ts|js|mts|mjs)$/,
      'TypeScript/JavaScript suite file path must end with .ts, .js, .mts, or .mjs',
    ),
]);

const ScoringSchema = z
  .object({
    weights: z.record(z.string(), z.number().min(0).max(1)).optional(),
  })
  .optional();

const PluginEntrySchema = z.object({
  name: z.string(),
  module: z.string(),
});

const PluginsConfigSchema = z
  .object({
    evaluators: z.array(PluginEntrySchema).optional(),
    reporters: z.array(PluginEntrySchema).optional(),
    transports: z.array(PluginEntrySchema).optional(),
  })
  .optional();

const GuardrailRuleSchema = z.object({
  name: z.string(),
  pattern: z.string(),
  action: z.enum(['block', 'warn', 'log']),
  message: z.string().optional(),
});

const EvalConfigSchema = z.object({
  plugin: PluginSchema,
  infrastructure: InfrastructureSchema,
  tracing: TracingSchema,
  defaults: DefaultsConfigSchema,
  scoring: ScoringSchema,
  plugins: PluginsConfigSchema,
  guardrails: z.array(GuardrailRuleSchema).optional(),
  suites: z.array(SuiteEntrySchema),
});

function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(`Unresolved environment variable: ${varName}`);
    }
    return envValue;
  });
}

function interpolateDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return interpolateEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateDeep(value);
    }
    return result;
  }
  return obj;
}

function snakeToCamel(obj: unknown, preserveKey = false): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map((item) => snakeToCamel(item, preserveKey));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = preserveKey
      ? key
      : key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const shouldPreserveChildren =
      key === 'args' || key === 'env' || key === 'minimal_env' || key === 'minimalEnv';
    result[camelKey] = snakeToCamel(value, shouldPreserveChildren);
  }
  return result;
}

export function loadConfig(configPath: string): EvalConfig {
  const absPath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  const configDir = dirname(absPath);

  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf-8');
  } catch (err) {
    throw new Error(`Config file not found: ${absPath}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid YAML in config: ${message}`, { cause: err });
  }

  const interpolated = interpolateDeep(parsed);
  const validated = EvalConfigSchema.parse(interpolated);

  const inlineSuites = validated.suites.filter(
    (s): s is z.infer<typeof SuiteSchema> => typeof s === 'object' && 'name' in s && 'layer' in s,
  );
  const tsSuitePaths = validated.suites.filter((s): s is string => typeof s === 'string');
  const collectionEntries = validated.suites.filter(
    (s): s is z.infer<typeof CollectionSuiteSchema> =>
      typeof s === 'object' && 'collection' in s && !('name' in s),
  );

  const collectionSuites = collectionEntries.map((entry) => {
    const collPath = resolveCollectionPath(entry.collection, configDir);
    return loadCollectionSuite(collPath);
  });

  if (!validated.plugin.dir) {
    const envDir = process.env.PLUGIN_DIR;
    if (!envDir) {
      throw new Error('Either plugin.dir or PLUGIN_DIR environment variable is required');
    }
    validated.plugin.dir = envDir;
  }

  const allSuites = [...inlineSuites, ...collectionSuites];
  const config = snakeToCamel({ ...validated, suites: allSuites }) as EvalConfig;
  if (tsSuitePaths.length > 0) {
    (config as EvalConfig & { tsSuitePaths: string[] }).tsSuitePaths = tsSuitePaths;
  }

  return config;
}
