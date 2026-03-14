import type {
  TestResult,
  SuiteConfig,
  DefaultsConfig,
  Evaluator,
  EvaluatorContext,
  EvaluatorResult,
  PluginConfig,
  TaskOutput,
} from '../../core/types.js';
import { createAdapter } from '../../adapters/index.js';
import { loadSkillDataset } from './loader.js';
import { mergeDefaults } from '../../core/utils.js';
import { log } from '../../cli/logger.js';
import { calculateCost } from '../../pricing/index.js';

const DEFAULT_ADAPTER = 'mcp';
const DEFAULT_MODEL = 'gpt-5.4';

export async function runSkillSuite(
  suite: SuiteConfig,
  pluginConfig: PluginConfig,
  defaults: DefaultsConfig,
  evaluatorRegistry: Map<string, Evaluator>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const mergedDefaults = mergeDefaults(suite.defaults, defaults);
  const repetitions = mergedDefaults.repetitions ?? 1;

  const skillDir = (suite as unknown as { skillDir?: string }).skillDir;
  if (!skillDir) {
    throw new Error('Skill layer requires skillDir in suite config');
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

  const suiteEvaluators = dataset.evaluators ?? ['correctness', 'groundedness'];

  for (const adapterName of adapterNames) {
    const adapterConfig = {
      name: pluginConfig.name,
      model: mergedDefaults.judgeModel ?? DEFAULT_MODEL,
      timeout: mergedDefaults.timeout ?? 120_000,
      workingDir: pluginConfig.dir,
      entry: pluginConfig.entry,
      env: pluginConfig.env,
    };

    const adapter = createAdapter(adapterName, adapterConfig);

    for (const example of dataset.examples) {
      const testName =
        (example.metadata?.name as string) ??
        (example.input.prompt as string)?.slice(0, 50) ??
        'unnamed';
      const perTestEvaluators = (example.metadata?.evaluators as string[]) ?? suiteEvaluators;

      for (let rep = 1; rep <= repetitions; rep++) {
        const displayName =
          adapterNames.length > 1 || repetitions > 1
            ? `${testName} [${adapterName}${repetitions > 1 ? ` #${rep}` : ''}]`
            : testName;

        log.test(displayName, 'running');

        const start = performance.now();
        let taskOutput: TaskOutput;

        try {
          taskOutput = await adapter(example);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.test(displayName, 'fail');
          results.push({
            name: displayName,
            suite: suite.name,
            layer: 'skill',
            pass: false,
            toolCalls: [],
            evaluatorResults: [],
            latencyMs: performance.now() - start,
            error: errMsg,
            adapter: adapterName,
          });
          continue;
        }

        const evaluatorContext: EvaluatorContext = {
          testName: displayName,
          prompt: (example.input.prompt as string) ?? JSON.stringify(example.input),
          toolCalls: taskOutput.toolCalls,
          finalOutput: taskOutput.output,
          expected: example.output as EvaluatorContext['expected'],
          config: mergedDefaults.thresholds as Record<string, unknown> | undefined,
        };

        const evaluatorResults: EvaluatorResult[] = [];
        for (const evalName of perTestEvaluators) {
          const evaluator = evaluatorRegistry.get(evalName);
          if (!evaluator) {
            log.warn(`Evaluator "${evalName}" not found, skipping`);
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

        const allPass = evaluatorResults.length === 0 || evaluatorResults.every((r) => r.pass);
        const model = mergedDefaults.judgeModel ?? DEFAULT_MODEL;
        const costUsd = taskOutput.tokenUsage
          ? calculateCost(model, taskOutput.tokenUsage)
          : undefined;

        log.test(displayName, allPass ? 'pass' : 'fail');
        for (const evalResult of evaluatorResults) {
          log.evaluator(evalResult.evaluator, evalResult.score, evalResult.pass);
        }

        results.push({
          name: displayName,
          suite: suite.name,
          layer: 'skill',
          pass: allPass,
          toolCalls: taskOutput.toolCalls,
          evaluatorResults,
          tokenUsage: taskOutput.tokenUsage ?? undefined,
          latencyMs: performance.now() - start,
          model,
          repetition: repetitions > 1 ? rep : undefined,
          costUsd: costUsd ?? undefined,
          adapter: adapterName,
        });
      }
    }
  }

  return results;
}
