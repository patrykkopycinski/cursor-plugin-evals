import type {
  TestResult,
  SuiteConfig,
  DefaultsConfig,
  Evaluator,
  EvaluatorContext,
  EvaluatorResult,
  PluginConfig,
  TaskOutput,
  ExpectedOutput,
  AdapterCapabilities,
  SuiteEvaluatorOverrides,
} from '../../core/types.js';
import { shouldRunEvaluator, type EvalCondition } from '../../evaluators/eval-condition.js';
import { createAdapter } from '../../adapters/index.js';
import { loadSkillDataset } from './loader.js';
import { mergeDefaults, getMissingEnvVars } from '../../core/utils.js';
import { log } from '../../cli/logger.js';
import { calculateCost } from '../../pricing/index.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { setCursorConcurrency, createWorkspacePool, type WorkspacePool } from '../../adapters/cursor-cli.js';

const DEFAULT_ADAPTER = 'mcp';
const DEFAULT_MODEL = 'gpt-5.2';
const CURSOR_CLI_CONCURRENCY = 5;

const ADAPTER_CAPABILITIES: Record<string, AdapterCapabilities> = {
  'cursor-cli': {
    hasToolCalls: true,
    hasFileAccess: true,
    hasWorkspaceIsolation: true,
    reportsInputTokens: false,
  },
  'plain-llm': {
    hasToolCalls: false,
    hasFileAccess: false,
    hasWorkspaceIsolation: false,
    reportsInputTokens: true,
  },
  mcp: {
    hasToolCalls: true,
    hasFileAccess: false,
    hasWorkspaceIsolation: false,
    reportsInputTokens: true,
  },
};

function getAdapterCapabilities(adapterName: string): AdapterCapabilities {
  return ADAPTER_CAPABILITIES[adapterName] ?? {
    hasToolCalls: false,
    hasFileAccess: false,
    hasWorkspaceIsolation: false,
    reportsInputTokens: true,
  };
}

function resolveEvaluators(
  datasetEvaluators: string[],
  suiteOverrides?: SuiteEvaluatorOverrides,
): string[] {
  if (!suiteOverrides) return datasetEvaluators;

  if (suiteOverrides.override?.length) {
    return suiteOverrides.override;
  }

  let result = [...datasetEvaluators];

  if (suiteOverrides.add?.length) {
    const existing = new Set(result);
    for (const e of suiteOverrides.add) {
      if (!existing.has(e)) result.push(e);
    }
  }

  if (suiteOverrides.remove?.length) {
    const toRemove = new Set(suiteOverrides.remove);
    result = result.filter((e) => !toRemove.has(e));
  }

  return result;
}

function resolveSkillContent(pluginDir?: string, skillPath?: string): string | undefined {
  if (skillPath) {
    const abs = pluginDir ? resolve(pluginDir, skillPath) : skillPath;
    if (existsSync(abs)) return readFileSync(abs, 'utf-8');
  }
  if (pluginDir) {
    const rootSkill = join(pluginDir, 'SKILL.md');
    if (existsSync(rootSkill)) return readFileSync(rootSkill, 'utf-8');
  }
  return undefined;
}

export async function runSkillSuite(
  suite: SuiteConfig,
  pluginConfig: PluginConfig,
  defaults: DefaultsConfig,
  evaluatorRegistry: Map<string, Evaluator>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const mergedDefaults = mergeDefaults(suite.defaults, defaults);
  const repetitions = mergedDefaults.repetitions ?? 1;

  const suiteRequireEnv = suite.requireEnv;
  const suiteMissing = getMissingEnvVars(undefined, suiteRequireEnv);
  if (suiteMissing.length > 0) {
    log.warn(`Skipping suite "${suite.name}": missing env ${suiteMissing.join(', ')}`);
    results.push({
      name: suite.name,
      suite: suite.name,
      layer: 'skill',
      pass: true,
      skipped: true,
      toolCalls: [],
      evaluatorResults: [],
      latencyMs: 0,
      error: `Skipped: missing env ${suiteMissing.join(', ')}`,
    });
    return results;
  }

  const skillDir = suite.skillDir;
  if (!skillDir) {
    throw new Error('Skill layer requires skill_dir in suite config');
  }

  const dataset = loadSkillDataset(skillDir);
  const rawAdapters =
    dataset.adapters ??
    (suite.adapter
      ? Array.isArray(suite.adapter)
        ? suite.adapter
        : [suite.adapter]
      : [DEFAULT_ADAPTER]);

  const adapterNames: string[] = rawAdapters.map((a) => (typeof a === 'string' ? a : a.type));

  const suiteEvaluators = resolveEvaluators(
    dataset.evaluators ?? ['correctness', 'groundedness'],
    suite.evaluators,
  );

  const skillContent = resolveSkillContent(
    pluginConfig.dir,
    suite.skillPath,
  );

  for (const adapterName of adapterNames) {
    const isCursorCli = adapterName === 'cursor-cli';
    if (isCursorCli) {
      setCursorConcurrency(true);
    }

    let wsPool: WorkspacePool | undefined;
    if (isCursorCli && skillDir && !suite.skipIsolation) {
      wsPool = await createWorkspacePool(
        skillDir,
        pluginConfig.dir ?? process.cwd(),
        CURSOR_CLI_CONCURRENCY,
        pluginConfig.dir,
      );
    } else if (isCursorCli && suite.skipIsolation) {
      log.debug(`Skipping workspace isolation for suite "${suite.name}" (skip_isolation: true)`);
    }

    const adapterConfig = {
      name: pluginConfig.name,
      model: isCursorCli ? 'auto' : (mergedDefaults.judgeModel ?? DEFAULT_MODEL),
      timeout: mergedDefaults.timeout ?? 120_000,
      workingDir: pluginConfig.dir,
      entry: pluginConfig.entry,
      env: pluginConfig.env,
      skillContent,
      ...(wsPool
        ? { workspacePool: wsPool, skillPath: undefined }
        : suite.skipIsolation
          ? { skillPath: undefined }
          : {}),
    };

    const adapter = createAdapter(adapterName, adapterConfig);
    const readOnlyAdapter = isCursorCli
      ? createAdapter(adapterName, { ...adapterConfig, readOnly: true })
      : null;

    const tasks: Array<() => Promise<TestResult>> = [];
    const capabilities = getAdapterCapabilities(adapterName);

    for (const example of dataset.examples) {
      const testAdapters = (example.metadata?.adapters as string[]) ?? null;
      if (testAdapters && !testAdapters.includes(adapterName)) continue;

      if (suite.testFilter?.adapters && !suite.testFilter.adapters.includes(adapterName)) continue;

      const testName =
        (example.metadata?.name as string) ??
        (example.input.prompt as string)?.slice(0, 50) ??
        'unnamed';
      const perTestEvaluators = resolveEvaluators(
        (example.metadata?.evaluators as string[]) ?? suiteEvaluators,
        suite.evaluators,
      );

      const expected = example.output as ExpectedOutput | undefined;
      const isReadOnly = isCursorCli && !expected?.tools?.length && !expected?.toolSequence?.length;

      for (let rep = 1; rep <= repetitions; rep++) {
        const displayName =
          adapterNames.length > 1 || repetitions > 1
            ? `${testName} [${adapterName}${repetitions > 1 ? ` #${rep}` : ''}]`
            : testName;

        const testAdapter = isReadOnly && readOnlyAdapter ? readOnlyAdapter : adapter;

        tasks.push(async () => {
          log.test(displayName, 'running');
          const start = performance.now();
          let taskOutput: TaskOutput;

          try {
            taskOutput = await testAdapter(example);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.test(displayName, 'fail');
            return {
              name: displayName,
              suite: suite.name,
              layer: 'skill' as const,
              pass: false,
              toolCalls: [],
              evaluatorResults: [],
              latencyMs: performance.now() - start,
              error: errMsg,
              adapter: adapterName,
            };
          }

          const evaluatorContext: EvaluatorContext = {
            testName: displayName,
            prompt: (example.input.prompt as string) ?? JSON.stringify(example.input),
            toolCalls: taskOutput.toolCalls,
            finalOutput: taskOutput.output,
            expected: example.output as EvaluatorContext['expected'],
            config: mergedDefaults.thresholds as Record<string, unknown> | undefined,
            tokenUsage: taskOutput.tokenUsage ?? undefined,
            latencyMs: taskOutput.latencyMs,
            adapterName,
            adapterCapabilities: capabilities,
          };

          const evaluatorResults: EvaluatorResult[] = [];
          for (const evalName of perTestEvaluators) {
            const evaluator = evaluatorRegistry.get(evalName);
            if (!evaluator) {
              log.warn(`Evaluator "${evalName}" not found, skipping`);
              continue;
            }

            // Check conditional activation (when clause)
            const evalWhen = dataset.evaluatorConditions?.get(evalName);
            if (evalWhen && !shouldRunEvaluator(evalWhen as EvalCondition, evaluatorContext)) {
              evaluatorResults.push({
                evaluator: evalName,
                score: 0,
                pass: true,
                skipped: true,
                label: 'condition_not_met',
                explanation: `Evaluator skipped: condition not met`,
              });
              continue;
            }

            try {
              const evalResult = await evaluator.evaluate(evaluatorContext);
              evaluatorResults.push(evalResult);
            } catch (err) {
              evaluatorResults.push({
                evaluator: evalName,
                score: 0,
                pass: false,
                label: 'error',
                explanation: `Evaluator failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          }

          const scoringResults = evaluatorResults.filter((r) => !r.skipped);
          const allPass = scoringResults.length === 0 || scoringResults.every((r) => r.pass);
          const model = mergedDefaults.judgeModel ?? DEFAULT_MODEL;
          const costUsd = taskOutput.tokenUsage
            ? calculateCost(model, taskOutput.tokenUsage)
            : undefined;

          log.test(displayName, allPass ? 'pass' : 'fail');
          for (const evalResult of evaluatorResults) {
            if (evalResult.skipped) {
              log.evaluatorSkipped(evalResult.evaluator);
            } else {
              log.evaluator(evalResult.evaluator, evalResult.score, evalResult.pass);
            }
          }

          return {
            name: displayName,
            suite: suite.name,
            layer: 'skill' as const,
            pass: allPass,
            toolCalls: taskOutput.toolCalls,
            evaluatorResults,
            tokenUsage: taskOutput.tokenUsage ?? undefined,
            latencyMs: performance.now() - start,
            model,
            repetition: repetitions > 1 ? rep : undefined,
            costUsd: costUsd ?? undefined,
            adapter: adapterName,
            conversation: taskOutput.messages.length > 0 ? taskOutput.messages : undefined,
          };
        });
      }
    }

    const effectiveConcurrency = isCursorCli ? CURSOR_CLI_CONCURRENCY : tasks.length;
    const taskResults = await runWithConcurrency(tasks, effectiveConcurrency);
    results.push(...taskResults);

    if (wsPool) {
      await wsPool.cleanup();
    }

    if (isCursorCli) {
      setCursorConcurrency(false);
    }
  }

  return results;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
