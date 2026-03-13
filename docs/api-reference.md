# Programmatic API Reference

Complete reference for all public exports from `cursor-plugin-evals`.

```typescript
import { loadConfig, runEvaluation, McpPluginClient } from 'cursor-plugin-evals';
```

## Core

### loadConfig(path)

Load and parse a `plugin-eval.yaml` configuration file.

```typescript
import { loadConfig } from 'cursor-plugin-evals';

const config = loadConfig('./plugin-eval.yaml');
// config: EvalConfig
```

### runEvaluation(config, options?)

Run evaluation suites and return aggregated results.

```typescript
import { runEvaluation } from 'cursor-plugin-evals';

const result = await runEvaluation(config, {
  layers: ['static', 'unit'],
  suites: ['smoke-tests'],
  mock: false,
  models: ['gpt-4o'],
  repeat: 3,
  ci: true,
});
// result: RunResult
```

**Options:**

| Field | Type | Description |
|-------|------|-------------|
| `layers` | string[] | Filter by layer names |
| `suites` | string[] | Filter by suite names |
| `mock` | boolean | Use recorded fixtures |
| `models` | string[] | Override LLM models |
| `repeat` | number | Override repetitions |
| `ci` | boolean | Enforce CI thresholds |

### McpPluginClient

Connect to an MCP server and call tools.

```typescript
import { McpPluginClient } from 'cursor-plugin-evals';

const client = await McpPluginClient.connect({
  command: 'node',
  args: ['dist/index.js'],
  cwd: './my-plugin',
  env: { ES_URL: 'http://localhost:9200' },
  buildCommand: 'npm run build',
  transport: { type: 'streamable-http', url: 'http://localhost:3000' },
});

const tools = await client.listTools();
const result = await client.callTool('elasticsearch_api', { method: 'GET', path: '/_cat/health' });

await client.disconnect();
```

### createEvaluator(name)

Create an evaluator instance by name.

```typescript
import { createEvaluator, EVALUATOR_NAMES } from 'cursor-plugin-evals';

console.log(EVALUATOR_NAMES); // all 22 evaluator names

const evaluator = createEvaluator('tool-selection');
const result = await evaluator.evaluate({
  testName: 'test',
  toolCalls: [...],
  expected: { tools: ['elasticsearch_api'] },
});
// result: EvaluatorResult { evaluator, score, pass, explanation }
```

## Layers

### runStaticSuite(suite, pluginConfig, manifest)

Run a static analysis suite against a plugin manifest.

```typescript
import { runStaticSuite, discoverPlugin } from 'cursor-plugin-evals';

const manifest = discoverPlugin('./my-plugin');
const results = await runStaticSuite(suite, pluginConfig, manifest);
// results: TestResult[]
```

### runSkillSuite(suite, pluginConfig, defaults, evaluators)

Run a skill evaluation suite with adapters and evaluators.

```typescript
import { runSkillSuite, createEvaluator } from 'cursor-plugin-evals';

const registry = new Map();
registry.set('correctness', createEvaluator('correctness'));

const results = await runSkillSuite(suite, pluginConfig, defaults, registry);
// results: TestResult[]
```

### runConversationTest(test, suite, plugin, tools, client, defaults, model, evaluators)

Run a multi-turn conversation test.

```typescript
import { runConversationTest } from 'cursor-plugin-evals';

const result = await runConversationTest(
  test, 'my-suite', pluginConfig, tools, mcpClient, defaults, 'gpt-4o', evaluatorRegistry,
);
// result: TestResult (with metadata.turns)
```

## Analysis

### analyzeCollisions(skillsDir)

Detect routing collisions between skills.

```typescript
import { analyzeCollisions } from 'cursor-plugin-evals';

const report = await analyzeCollisions('./skills');
// report: CollisionReport { skills, pairs, errors, warnings, clean }
```

### buildComparisonFromRuns(runs)

Build a model comparison matrix from multiple evaluation runs.

```typescript
import { buildComparisonFromRuns, formatComparisonTable } from 'cursor-plugin-evals';

const comparison = buildComparisonFromRuns(runs);
console.log(formatComparisonTable(comparison));
// comparison: ComparisonResult { models, matrix }
```

### analyzeSensitivity(config, suite, variants, threshold)

Detect fragile tests by rephrasing prompts.

```typescript
import { analyzeSensitivity, formatSensitivityReport } from 'cursor-plugin-evals';

const results = await analyzeSensitivity(config, 'llm-e2e', 5, 0.15);
console.log(formatSensitivityReport(results, 0.15));
// results: SensitivityResult[]
```

### analyzeCosts(data, threshold)

Find cost-optimal models.

```typescript
import { analyzeCosts, formatCostReport } from 'cursor-plugin-evals';

const report = analyzeCosts(comparisonData, 0.8);
console.log(formatCostReport(report));
// report: CostReport
```

## Security

### checkGuardrails(rules, toolName, args)

Test tool calls against guardrail rules.

```typescript
import { checkGuardrails, DEFAULT_GUARDRAILS } from 'cursor-plugin-evals';

const violation = checkGuardrails(DEFAULT_GUARDRAILS, 'elasticsearch_api', {
  method: 'DELETE', path: '/_all',
});
// violation: GuardrailViolation | null
```

### runRedTeam(config)

Run adversarial security scans.

```typescript
import { runRedTeam, formatRedTeamReport } from 'cursor-plugin-evals';

const report = await runRedTeam({
  plugin: pluginConfig,
  categories: ['jailbreak', 'prompt-injection'],
  countPerCategory: 10,
  model: 'gpt-4o',
});
console.log(formatRedTeamReport(report));
// report: RedTeamReport
```

### runSkillSecurityChecks(skillDir)

Static security analysis of skill files.

```typescript
import { runSkillSecurityChecks, formatSecurityReport } from 'cursor-plugin-evals';

const report = await runSkillSecurityChecks('./skills/search');
console.log(formatSecurityReport([report]));
// report: SkillSecurityReport
```

## Generation

### generateTestsFromSchema(toolName, schema)

Generate integration tests from a JSON Schema.

```typescript
import { generateTestsFromSchema, formatAsYaml } from 'cursor-plugin-evals';

const tests = generateTestsFromSchema('elasticsearch_api', tool.inputSchema);
console.log(formatAsYaml(tests, 'my-plugin'));
// tests: GeneratedTest[]
```

### generateSmartTests(config)

LLM-powered test generation with personas and multilingual support.

```typescript
import { generateSmartTests, formatSmartTestsAsYaml } from 'cursor-plugin-evals';

const tests = await generateSmartTests({
  tools,
  count: 5,
  personas: ['novice', 'expert'],
  multilingual: ['es', 'de'],
  edgeCases: true,
});
const yaml = formatSmartTestsAsYaml(tests, 'my-plugin');
// tests: GeneratedTestCase[]
```

### simulateConversation(config)

Generate a simulated multi-turn conversation.

```typescript
import { simulateConversation, formatAsConversationYaml } from 'cursor-plugin-evals';

const conv = await simulateConversation({
  persona: 'expert',
  goal: 'Set up APM monitoring',
  maxTurns: 8,
  tools: mcpTools,
});
const yaml = formatAsConversationYaml([conv], ['conversation-coherence']);
// conv: SimulatedConversation
```

### optimizePrompt(config, options)

Iteratively improve prompts.

```typescript
import { optimizePrompt, formatOptimizationReport } from 'cursor-plugin-evals';

const result = await optimizePrompt(config, {
  suite: 'llm-e2e',
  targetEvaluator: 'tool-selection',
  maxIterations: 5,
  variantsPerIteration: 3,
  targetScore: 0.95,
});
console.log(formatOptimizationReport(result));
// result: OptimizationResult
```

## Data

### LlmCache

Cache LLM responses for deterministic replay.

```typescript
import { LlmCache } from 'cursor-plugin-evals';
import type { CacheConfig, CacheStats } from 'cursor-plugin-evals';

const cache = new LlmCache({ dir: '.cache/llm' });
const stats: CacheStats = cache.getStats();
```

### Recordings

Save and load recorded evaluation outputs.

```typescript
import { saveRecording, loadRecording, listRecordings } from 'cursor-plugin-evals';

await saveRecording('my-skill', runId, examples);
const recording = await loadRecording('my-skill', runId);
const ids = await listRecordings('my-skill');
// recording: RecordedRun
```

### Datasets

Manage versioned evaluation datasets.

```typescript
import { createDataset, listDatasets, addExample, versionDataset, exportToYaml, annotateExample } from 'cursor-plugin-evals';

const ds = await createDataset('my-tests', 'Description');
await addExample('my-tests', { input: { prompt: 'test' }, output: 'result' });
await annotateExample('my-tests', 0, { label: 'correct' });
await versionDataset('my-tests');
const yaml = await exportToYaml('my-tests');
const all = await listDatasets();
```

## Reporting

### printTerminalReport(result)

Print a formatted report to the terminal.

```typescript
import { printTerminalReport } from 'cursor-plugin-evals';
printTerminalReport(result);
```

### generateMarkdownReport(result)

Generate a Markdown report string.

```typescript
import { generateMarkdownReport } from 'cursor-plugin-evals';
const md = generateMarkdownReport(result);
```

### generateJsonReport(result)

Generate a JSON report string.

```typescript
import { generateJsonReport } from 'cursor-plugin-evals';
const json = generateJsonReport(result);
```

### generateHtmlReport(result)

Generate an HTML dashboard report.

```typescript
import { generateHtmlReport } from 'cursor-plugin-evals';
const html = generateHtmlReport(result);
```

## Tracing

### createTracer()

Create a tracer for OpenTelemetry span instrumentation.

```typescript
import { createTracer, withRunSpan, withTestSpan, withToolCallSpan } from 'cursor-plugin-evals';

const tracer = createTracer();
```

### exportToOtlp(endpoint)

Export traces to an OpenTelemetry collector.

```typescript
import { exportToOtlp } from 'cursor-plugin-evals';
await exportToOtlp('http://localhost:4318');
```

### parseOtelTrace(json)

Parse an OTel JSON trace export.

```typescript
import { parseOtelTrace, generateTestsFromTrace } from 'cursor-plugin-evals';

const trace = parseOtelTrace(jsonData);
const yaml = generateTestsFromTrace(trace, { llm: true });
// trace: ParsedTrace { traceId, spans }
```

## CI

### evaluateCi(result, thresholds)

Evaluate run results against CI thresholds.

```typescript
import { evaluateCi, convertFlatThresholds } from 'cursor-plugin-evals';

const ciResult = evaluateCi(runResult, thresholds);
// ciResult: CiResult { passed, violations, summary }
```

## Regression

### buildFingerprint(runId, tests)

Build a fingerprint from test results for regression comparison.

```typescript
import { buildFingerprint, saveFingerprint, loadFingerprint, detectRegressions } from 'cursor-plugin-evals';

const fp = buildFingerprint(runId, testResults);
await saveFingerprint(fp);

const baseline = await loadFingerprint('baseline-id');
const regressions = detectRegressions(baseline, fp, 0.05);
// regressions: RegressionResult[]
```

### welchTTest(sample1, sample2)

Run a Welch's t-test between two score samples.

```typescript
import { welchTTest } from 'cursor-plugin-evals';

const { tStatistic, pValue, degreesOfFreedom } = welchTTest(
  [0.9, 0.85, 0.95],
  [0.7, 0.65, 0.75],
);
```

## Notifications

```typescript
import { createNotifiers, sendNotifications } from 'cursor-plugin-evals';

const notifiers = createNotifiers({
  slack: { webhookUrl: '...' },
  github: { token: '...', repo: 'owner/repo' },
  webhook: { url: '...', headers: {} },
});

await sendNotifications(notifiers, payload);
```

## Monitoring

```typescript
import { parseOtelJsonLine, consumeStdin, createAnomalyDetector } from 'cursor-plugin-evals';

const detector = createAnomalyDetector(100, 2.0);
const event = parseOtelJsonLine(jsonLine);
// event: TraceEvent | null

for await (const e of consumeStdin()) {
  detector.addScore('latency', e.endTime - e.startTime);
}
```

## Multimodal

```typescript
import { captureScreenshot, compareImages, saveBaseline, loadBaseline } from 'cursor-plugin-evals';

const screenshot = await captureScreenshot({ url: 'http://localhost:5601' });
const diff = await compareImages('baseline.png', 'current.png');
await saveBaseline('dashboard', screenshot);
const baseline = await loadBaseline('dashboard');
```

## Plugin Discovery

```typescript
import { discoverPlugin, parseFrontmatter, parseSkillFile } from 'cursor-plugin-evals';

const manifest = discoverPlugin('./my-plugin');
// manifest: PluginManifest { name, skills, rules, agents, commands, hooks, mcpServers }
```

## Fixtures

```typescript
import { McpFixtureRecorder, McpFixtureResponder, generateMockServer } from 'cursor-plugin-evals';

// Record fixtures during live testing
const recorder = new McpFixtureRecorder(outputDir);

// Replay fixtures in mock mode
const responder = new McpFixtureResponder(fixtureDir);

// Generate a standalone mock server
await generateMockServer(fixtureDir, outputPath);
```

## See Also

- [Getting Started](./getting-started.md)
- [Configuration Reference](./configuration.md)
- [Evaluators](./evaluators.md)
