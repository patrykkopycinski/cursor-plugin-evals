import { randomUUID } from 'crypto';
import { resolve } from 'path';
import pLimit from 'p-limit';
import type {
  EvalConfig,
  RunResult,
  SuiteResult,
  SuiteConfig,
  TestResult,
  Evaluator,
  EvaluatorResult,
} from './types.js';
import { McpPluginClient } from '../mcp/client.js';
import { runUnitSuite } from '../layers/unit/index.js';
import { runStaticSuite } from '../layers/static/index.js';
import { runIntegrationSuite } from '../layers/integration/index.js';
import { runLlmSuite } from '../layers/llm/index.js';
import { runPerformanceSuite } from '../layers/performance/index.js';
import { runSkillSuite } from '../layers/skill/index.js';
import { createEvaluator, EVALUATOR_NAMES } from '../evaluators/index.js';
import { createTracer, withRunSpan, withSuiteSpan } from '../tracing/spans.js';
import { parseEntry, mergeDefaults } from './utils.js';
import { discoverPlugin } from '../plugin/discovery.js';
import { log } from '../cli/logger.js';
import { computeDimensions } from '../scoring/dimensions.js';
import { computeQualityScore, DEFAULT_WEIGHTS } from '../scoring/composite.js';
import { aggregateConfidence } from '../scoring/confidence.js';
import type { ScoreEntry } from '../scoring/confidence.js';

export interface RunOptions {
  layers?: string[];
  suites?: string[];
  mock?: boolean;
  models?: string[];
  repeat?: number;
  ci?: boolean;
  concurrency?: number;
}

function buildEvaluatorRegistry(): Map<string, Evaluator> {
  const registry = new Map<string, Evaluator>();
  for (const name of EVALUATOR_NAMES) {
    registry.set(name, createEvaluator(name));
  }
  return registry;
}

function computeEvaluatorSummary(
  tests: TestResult[],
): Record<string, { mean: number; min: number; max: number; pass: number; total: number }> {
  const byEvaluator = new Map<string, EvaluatorResult[]>();

  for (const test of tests) {
    for (const er of test.evaluatorResults) {
      const arr = byEvaluator.get(er.evaluator);
      if (arr) {
        arr.push(er);
      } else {
        byEvaluator.set(er.evaluator, [er]);
      }
    }
  }

  const summary: Record<
    string,
    { mean: number; min: number; max: number; pass: number; total: number }
  > = {};

  for (const [name, results] of byEvaluator) {
    const scores = results.map((r) => r.score);
    const passCount = results.filter((r) => r.pass).length;
    summary[name] = {
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      min: Math.min(...scores),
      max: Math.max(...scores),
      pass: passCount,
      total: results.length,
    };
  }

  return summary;
}

function buildSuiteResult(
  name: string,
  layer: SuiteConfig['layer'],
  tests: TestResult[],
  durationMs: number,
): SuiteResult {
  const passed = tests.filter((t) => t.pass).length;
  return {
    name,
    layer,
    tests,
    passRate: tests.length > 0 ? passed / tests.length : 1,
    duration: durationMs,
    evaluatorSummary: computeEvaluatorSummary(tests),
  };
}

async function runSuiteByLayer(
  suite: SuiteConfig,
  config: EvalConfig,
  options: RunOptions,
  evaluatorRegistry: Map<string, Evaluator>,
): Promise<SuiteResult> {
  const start = performance.now();
  const mergedDefaults = mergeDefaults(suite.defaults, config.defaults);

  if (options.repeat !== undefined) {
    mergedDefaults.repetitions = options.repeat;
  }

  log.suite(suite.name, suite.layer);

  switch (suite.layer) {
    case 'unit': {
      const tests = await runUnitSuite(suite, config.plugin);
      return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
    }

    case 'static': {
      let manifest;
      try {
        manifest = discoverPlugin(config.plugin.dir ?? '.', config.plugin.pluginRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Plugin discovery failed: ${msg}`);
        return buildSuiteResult(
          suite.name,
          suite.layer,
          [
            {
              name: 'plugin-discovery',
              suite: suite.name,
              layer: 'static',
              pass: false,
              toolCalls: [],
              evaluatorResults: [],
              latencyMs: performance.now() - start,
              error: msg,
            },
          ],
          performance.now() - start,
        );
      }
      const tests = await runStaticSuite(suite, manifest);
      return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
    }

    case 'integration': {
      if (!config.plugin.entry && !config.plugin.transport) {
        throw new Error('plugin.entry or plugin.transport is required for integration layer');
      }

      const connectConfig: Parameters<typeof McpPluginClient.connect>[0] = {
        buildCommand: config.plugin.buildCommand,
        env: config.plugin.env,
      };

      if (config.plugin.transport && config.plugin.transport !== 'stdio') {
        connectConfig.transport = {
          type: config.plugin.transport,
          url: config.plugin.url,
          headers: config.plugin.headers,
        };
      } else if (config.plugin.entry) {
        const { command, args } = parseEntry(config.plugin.entry);
        connectConfig.command = command;
        connectConfig.args = args;
        connectConfig.cwd = config.plugin.dir;
      }

      const client = await McpPluginClient.connect(connectConfig);

      try {
        const tests = await runIntegrationSuite(suite, client, mergedDefaults);
        return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
      } finally {
        await client.disconnect();
      }
    }

    case 'llm': {
      const tests = await runLlmSuite(suite, config.plugin, mergedDefaults, evaluatorRegistry);
      return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
    }

    case 'performance': {
      if (!config.plugin.entry && !config.plugin.transport) {
        throw new Error('plugin.entry or plugin.transport is required for performance layer');
      }

      const connectConfig: Parameters<typeof McpPluginClient.connect>[0] = {
        buildCommand: config.plugin.buildCommand,
        env: config.plugin.env,
      };

      if (config.plugin.transport && config.plugin.transport !== 'stdio') {
        connectConfig.transport = {
          type: config.plugin.transport,
          url: config.plugin.url,
          headers: config.plugin.headers,
        };
      } else if (config.plugin.entry) {
        const { command, args } = parseEntry(config.plugin.entry);
        connectConfig.command = command;
        connectConfig.args = args;
        connectConfig.cwd = config.plugin.dir;
      }

      const client = await McpPluginClient.connect(connectConfig);

      try {
        const tests = await runPerformanceSuite(suite, client, mergedDefaults);
        return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
      } finally {
        await client.disconnect();
      }
    }

    case 'skill': {
      const tests = await runSkillSuite(suite, config.plugin, mergedDefaults, evaluatorRegistry);
      return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
    }

    default: {
      const _exhaustive: never = suite.layer;
      throw new Error(`Unknown layer: ${_exhaustive}`);
    }
  }
}

export async function runEvaluation(
  config: EvalConfig,
  options: RunOptions = {},
): Promise<RunResult> {
  const runId = randomUUID();
  const runStart = performance.now();
  const concurrency = options.concurrency ?? 4;

  const evaluatorRegistry = buildEvaluatorRegistry();
  const tracer = createTracer('cursor-plugin-evals');

  let filteredSuites = config.suites;

  if (options.layers && options.layers.length > 0) {
    const layerSet = new Set(options.layers);
    filteredSuites = filteredSuites.filter((s) => layerSet.has(s.layer));
  }

  if (options.suites && options.suites.length > 0) {
    const suiteSet = new Set(options.suites);
    filteredSuites = filteredSuites.filter((s) => suiteSet.has(s.name));
  }

  if (filteredSuites.length === 0) {
    log.warn('No suites matched the provided filters');
  }

  log.header(`Evaluation run ${runId.slice(0, 8)}`);
  log.info(`  Suites: ${filteredSuites.length}  Concurrency: ${concurrency}`);

  const limit = pLimit(concurrency);

  const suiteResults: SuiteResult[] = await withRunSpan(tracer, runId, config.plugin.name, () =>
    Promise.all(
      filteredSuites.map((suite) =>
        limit(() =>
          withSuiteSpan(tracer, suite.name, suite.layer, () =>
            runSuiteByLayer(suite, config, options, evaluatorRegistry),
          ),
        ),
      ),
    ),
  );

  const allTests = suiteResults.flatMap((s) => s.tests);
  const passed = allTests.filter((t) => t.pass).length;
  const failed = allTests.length - passed;
  const duration = performance.now() - runStart;

  log.summary(allTests.length, passed, failed, duration);

  const dimensions = computeDimensions({
    runId,
    timestamp: new Date().toISOString(),
    config: config.plugin.name,
    suites: suiteResults,
    overall: {
      total: allTests.length,
      passed,
      failed,
      passRate: allTests.length > 0 ? passed / allTests.length : 1,
      duration,
    },
  });
  const weights = config.scoring?.weights ?? DEFAULT_WEIGHTS;
  const qualityScore = computeQualityScore(dimensions, weights);

  const scoreEntries: ScoreEntry[] = [];
  for (const suite of suiteResults) {
    for (const test of suite.tests) {
      for (const er of test.evaluatorResults) {
        scoreEntries.push({
          score: er.score,
          evaluator: er.evaluator,
          model: test.model,
        });
      }
    }
  }
  const confidenceIntervals =
    scoreEntries.length > 1 ? aggregateConfidence(scoreEntries) : undefined;

  const runResult: RunResult = {
    runId,
    timestamp: new Date().toISOString(),
    config: config.plugin.name,
    suites: suiteResults,
    overall: {
      total: allTests.length,
      passed,
      failed,
      passRate: allTests.length > 0 ? passed / allTests.length : 1,
      duration,
    },
    qualityScore,
    confidenceIntervals,
  };

  try {
    const dbPath = resolve(process.cwd(), '.cursor-plugin-evals', 'dashboard.db');
    const { initDb, saveRun } = await import('../dashboard/db.js');
    const db = initDb(dbPath);
    saveRun(db, runResult);
    db.close();
  } catch {
    // Dashboard db is optional — silently skip if better-sqlite3 isn't available
  }

  return runResult;
}
