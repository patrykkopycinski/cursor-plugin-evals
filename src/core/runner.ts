import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
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
// Non-core modules (evaluators, tracing, scoring, ci, mcp) are imported
// dynamically inside runEvaluation() / runSuiteByLayer() so the runner
// doesn't eagerly pull in heavy dependency trees at import time.
import { mergeDefaults } from './utils.js';
import { expandMatrix } from './matrix.js';
import { loadLastFailed, saveLastRun } from './last-run.js';
import { log } from '../cli/logger.js';
import { shardSuites } from './shard.js';
import type { ScoreEntry } from '../scoring/confidence.js';
import type { ShardConfig } from './shard.js';

export interface RunOptions {
  layers?: string[];
  suites?: string[];
  mock?: boolean;
  models?: string[];
  repeat?: number;
  ci?: boolean;
  concurrency?: number;
  lastFailed?: boolean;
  failedFirst?: boolean;
  shard?: ShardConfig;
}

async function buildEvaluatorRegistry(): Promise<Map<string, Evaluator>> {
  const { createEvaluator, EVALUATOR_NAMES } = await import('../evaluators/index.js');
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
      if (er.skipped) continue;
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
      const { runUnitSuite } = await import('../layers/unit/index.js');
      const tests = await runUnitSuite(suite, config.plugin);
      return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
    }

    case 'static': {
      let manifest;
      try {
        const { discoverPlugin } = await import('../plugin/discovery.js');
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
      const { runStaticSuite } = await import('../layers/static/index.js');
      const tests = await runStaticSuite(suite, manifest);
      return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
    }

    case 'integration': {
      if (!config.plugin.entry && !config.plugin.transport) {
        throw new Error('plugin.entry or plugin.transport is required for integration layer');
      }

      const { McpPluginClient } = await import('../mcp/client.js');
      const { buildConnectConfig } = await import('../mcp/connect.js');
      const connectConfig = buildConnectConfig(config.plugin);
      const client = await McpPluginClient.connect(connectConfig);

      try {
        const { runIntegrationSuite } = await import('../layers/integration/index.js');
        const tests = await runIntegrationSuite(suite, client, mergedDefaults);
        return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
      } finally {
        await client.disconnect();
      }
    }

    case 'llm': {
      const { runLlmSuite } = await import('../layers/llm/index.js');
      const tests = await runLlmSuite(suite, config.plugin, mergedDefaults, evaluatorRegistry);
      return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
    }

    case 'performance': {
      if (!config.plugin.entry && !config.plugin.transport) {
        throw new Error('plugin.entry or plugin.transport is required for performance layer');
      }

      const { McpPluginClient: McpClient } = await import('../mcp/client.js');
      const { buildConnectConfig: buildPerfConnectConfig } = await import('../mcp/connect.js');
      const connectConfig = buildPerfConnectConfig(config.plugin);
      const client = await McpClient.connect(connectConfig);

      try {
        const { runPerformanceSuite } = await import('../layers/performance/index.js');
        const tests = await runPerformanceSuite(suite, client, mergedDefaults);
        return buildSuiteResult(suite.name, suite.layer, tests, performance.now() - start);
      } finally {
        await client.disconnect();
      }
    }

    case 'skill': {
      const { runSkillSuite } = await import('../layers/skill/index.js');
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

  const evaluatorRegistry = await buildEvaluatorRegistry();
  const { SERVICE_NAME } = await import('./constants.js');
  const { createTracer, withRunSpan, withSuiteSpan } = await import('../tracing/spans.js');
  const tracer = createTracer(SERVICE_NAME);

  let filteredSuites = config.suites.flatMap(expandMatrix);

  if (options.layers && options.layers.length > 0) {
    const layerSet = new Set(options.layers);
    filteredSuites = filteredSuites.filter((s) => layerSet.has(s.layer));
  }

  if (options.suites && options.suites.length > 0) {
    const suiteSet = new Set(options.suites);
    filteredSuites = filteredSuites.filter((s) => suiteSet.has(s.name));
  }

  if (options.lastFailed || options.failedFirst) {
    const lastFailedIds = loadLastFailed();

    if (lastFailedIds.length > 0) {
      const failedSet = new Set(lastFailedIds);

      if (options.lastFailed) {
        filteredSuites = filteredSuites
          .map((suite) => {
            const matchingTests = suite.tests.filter((t) =>
              failedSet.has(`${suite.name}/${t.name}`),
            );
            if (matchingTests.length === 0) return null;
            return { ...suite, tests: matchingTests };
          })
          .filter((s): s is SuiteConfig => s !== null);
      } else if (options.failedFirst) {
        filteredSuites = filteredSuites.map((suite) => {
          const failed: typeof suite.tests = [];
          const rest: typeof suite.tests = [];
          for (const t of suite.tests) {
            if (failedSet.has(`${suite.name}/${t.name}`)) {
              failed.push(t);
            } else {
              rest.push(t);
            }
          }
          return { ...suite, tests: [...failed, ...rest] };
        });
      }
    } else if (options.lastFailed) {
      log.info('No previously failed tests found — running all suites');
    }
  }

  if (options.shard) {
    filteredSuites = shardSuites(filteredSuites, options.shard);
    log.info(
      `  Shard ${options.shard.index}/${options.shard.total}: ${filteredSuites.length} suite(s)`,
    );
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
  const skipped = allTests.filter((t) => t.skipped).length;
  const passed = allTests.filter((t) => t.pass).length;
  const failed = allTests.length - passed - skipped;
  const duration = performance.now() - runStart;

  log.summary(allTests.length, passed, failed, duration, skipped);

  const { computeDimensions } = await import('../scoring/dimensions.js');
  const { computeQualityScore, DEFAULT_WEIGHTS } = await import('../scoring/composite.js');
  const dimensions = computeDimensions({
    runId,
    timestamp: new Date().toISOString(),
    config: config.plugin.name,
    suites: suiteResults,
    overall: {
      total: allTests.length,
      passed,
      failed,
      skipped,
      passRate: (allTests.length - skipped) > 0 ? passed / (allTests.length - skipped) : 1,
      duration,
    },
  });
  const weights = config.scoring?.weights ?? DEFAULT_WEIGHTS;
  const qualityScore = computeQualityScore(dimensions, weights);

  const scoreEntries: ScoreEntry[] = [];
  for (const suite of suiteResults) {
    for (const test of suite.tests) {
      for (const er of test.evaluatorResults) {
        if (er.skipped) continue;
        scoreEntries.push({
          score: er.score,
          evaluator: er.evaluator,
          model: test.model,
        });
      }
    }
  }
  const { aggregateConfidence } = await import('../scoring/confidence.js');
  const confidenceIntervals =
    scoreEntries.length > 1 ? aggregateConfidence(scoreEntries) : undefined;

  const repetitions = options.repeat ?? 1;
  const kValues = [...new Set([1, repetitions, 10])].sort((a, b) => a - b);
  const { computeTrialMetrics } = await import('../utils/first-try-pass-rate.js');
  const trialMetrics =
    repetitions > 1 ? computeTrialMetrics(allTests, kValues) : undefined;

  const runResult: RunResult = {
    runId,
    timestamp: new Date().toISOString(),
    config: config.plugin.name,
    suites: suiteResults,
    overall: {
      total: allTests.length,
      passed,
      failed,
      skipped,
      passRate: (allTests.length - skipped) > 0 ? passed / (allTests.length - skipped) : 1,
      duration,
    },
    qualityScore,
    confidenceIntervals,
    trialMetrics,
  };

  if (config.derivedMetrics?.length) {
    const evalSummary: Record<string, { mean: number; min: number; max: number; pass: number; total: number }> = {};
    for (const suite of suiteResults) {
      for (const [name, summary] of Object.entries(suite.evaluatorSummary)) {
        if (!evalSummary[name]) {
          evalSummary[name] = { mean: 0, min: Infinity, max: -Infinity, pass: 0, total: 0 };
        }
        const e = evalSummary[name];
        const totalBefore = e.total;
        e.total += summary.total;
        e.pass += summary.pass;
        e.mean = e.total > 0 ? (e.mean * totalBefore + summary.mean * summary.total) / e.total : 0;
        e.min = Math.min(e.min, summary.min);
        e.max = Math.max(e.max, summary.max);
      }
    }
    const { evaluateDerivedMetrics } = await import('../scoring/derived.js');
    runResult.derivedMetrics = evaluateDerivedMetrics(config.derivedMetrics, evalSummary);
  }

  if (options.ci && config.ci) {
    const { evaluateCi } = await import('../ci/index.js');
    runResult.ciResult = evaluateCi(allTests, config.ci, {
      firstTryPassRate: runResult.overall.passRate,
      derivedMetrics: runResult.derivedMetrics,
    });
  }

  try {
    const { DATA_DIR } = await import('./constants.js');
    const dbPath = resolve(process.cwd(), DATA_DIR, 'dashboard.db');
    const { initDb, saveRun } = await import('../dashboard/db.js');
    const db = initDb(dbPath);
    try {
      saveRun(db, runResult);
    } finally {
      db.close();
    }
  } catch (_e) {
    // Dashboard db is optional — silently skip if better-sqlite3 isn't available
  }

  try {
    const { buildFingerprint, saveFingerprint } = await import('../regression/fingerprint.js');
    const fp = buildFingerprint(runId, allTests);
    await saveFingerprint(fp);
  } catch (_e) {
    // Fingerprint save is best-effort
  }

  try {
    const { appendHistory, loadHistory, summarizeTrend } = await import('../regression/history.js');
    await appendHistory(runResult);
    const history = await loadHistory();
    if (history.entries.length >= 2) {
      const trend = summarizeTrend(history);
      for (const line of trend.split('\n')) {
        log.debug(line);
      }
    }
  } catch (_e) {
    // Score history is best-effort
  }

  try {
    saveLastRun(runResult);
  } catch (_e) {
    // Last-run persistence is best-effort
  }

  return runResult;
}
