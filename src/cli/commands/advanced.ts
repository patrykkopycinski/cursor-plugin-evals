import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { runEvaluation } from '../../core/runner.js';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { EXIT_FAIL, EXIT_CONFIG_ERROR, parsePositiveInt } from './helpers.js';

export function registerAdvancedCommands(program: Command): void {
  program
    .command('trace-import')
    .description('Import OTel trace JSON and generate evaluation test definitions')
    .requiredOption('-f, --file <path>', 'OTel trace JSON file path')
    .option('--llm', 'generate LLM-layer tests from prompt spans')
    .option('-o, --output <path>', 'write generated YAML to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        file: string;
        llm?: boolean;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Trace Import');

        try {
          const { readFileSync } = await import('fs');
          const { parseOtelTrace } = await import('../../trace-import/parser.js');
          const { generateTestsFromTrace } = await import('../../trace-import/generator.js');

          const filePath = resolve(process.cwd(), opts.file);
          const raw = readFileSync(filePath, 'utf-8');
          const json = JSON.parse(raw);

          const trace = parseOtelTrace(json);
          log.info(`Parsed trace ${trace.traceId} with ${trace.spans.length} span(s)`);

          const yaml = generateTestsFromTrace(trace, { llm: opts.llm });

          if (opts.output) {
            const outPath = resolve(process.cwd(), opts.output);
            writeFileSync(outPath, yaml, 'utf-8');
            log.success(`Tests written to ${outPath}`);
          } else {
            console.log(yaml);
          }
        } catch (err) {
          log.error('Trace import failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  program
    .command('optimize')
    .description('Optimize prompts and tool descriptions by iteratively evaluating variants')
    .requiredOption('-s, --suite <name>', 'suite name to optimize against')
    .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
    .option('-e, --evaluator <name>', 'target evaluator to maximize', 'tool-selection')
    .option('-i, --iterations <n>', 'max optimization iterations', parsePositiveInt, 5)
    .option('-n, --variants <n>', 'variants per iteration', parsePositiveInt, 3)
    .option('--target-score <n>', 'stop when this score is reached', parseFloat, 0.95)
    .option('-o, --output <path>', 'write optimized prompts to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        suite: string;
        config: string;
        evaluator: string;
        iterations: number;
        variants: number;
        targetScore: number;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Prompt Optimization');
        log.info(
          `Suite: ${opts.suite}, Evaluator: ${opts.evaluator}, Iterations: ${opts.iterations}`,
        );
        console.log();

        try {
          const { optimizePrompt } = await import('../../prompt-optimization/optimizer.js');
          const { formatOptimizationReport } = await import('../../prompt-optimization/report.js');

          let config;
          try {
            config = loadConfig(opts.config);
          } catch (err) {
            log.error('Configuration error', err);
            process.exitCode = EXIT_CONFIG_ERROR;
            return;
          }

          const result = await optimizePrompt(config, {
            suite: opts.suite,
            targetEvaluator: opts.evaluator,
            maxIterations: opts.iterations,
            variantsPerIteration: opts.variants,
            targetScore: opts.targetScore,
          });

          const report = formatOptimizationReport(result);
          console.log(report);

          if (opts.output) {
            const outPath = resolve(process.cwd(), opts.output);
            writeFileSync(outPath, report, 'utf-8');
            log.success(`Report written to ${outPath}`);
          }
        } catch (err) {
          log.error('Optimization failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  program
    .command('harvest')
    .description('Harvest failed production traces from Elasticsearch and generate regression test cases')
    .requiredOption('--endpoint <url>', 'Elasticsearch endpoint')
    .option('--api-key <key>', 'Elasticsearch API key')
    .option('--index <pattern>', 'Index pattern', 'traces-apm*,traces-generic.otel-*')
    .option('--from <date>', 'Start of time range', 'now-24h')
    .option('--to <date>', 'End of time range', 'now')
    .option('--score-threshold <n>', 'Score threshold for failures', parseFloat, 0.5)
    .option('--max-tests <n>', 'Max test cases to generate', parsePositiveInt, 20)
    .option('-o, --output <path>', 'Write YAML to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        endpoint: string;
        apiKey?: string;
        index: string;
        from: string;
        to: string;
        scoreThreshold: number;
        maxTests: number;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Harvest Production Traces');

        try {
          const { harvestTests, harvestedTestsToYaml } = await import('../../harvest/index.js');
          const tests = await harvestTests({
            endpoint: opts.endpoint,
            apiKey: opts.apiKey,
            index: opts.index,
            timeRange: { from: opts.from, to: opts.to },
            scoreThreshold: opts.scoreThreshold,
            maxTests: opts.maxTests,
          });

          if (tests.length === 0) {
            log.warn('No failed traces found matching criteria.');
            return;
          }

          log.success(`Harvested ${tests.length} test case(s) from production traces.`);

          const yaml = harvestedTestsToYaml(tests);
          if (opts.output) {
            const { writeFileSync } = await import('fs');
            writeFileSync(resolve(process.cwd(), opts.output), yaml, 'utf-8');
            log.success(`Written to ${opts.output}`);
          } else {
            console.log(yaml);
          }
        } catch (err) {
          log.error('Harvest failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  program
    .command('cost-report')
    .description('Analyze model comparison data and recommend cost optimizations')
    .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
    .option('-m, --model <models...>', 'models to compare (runs evals for each)')
    .option('-l, --layer <layers...>', 'filter layers')
    .option('-s, --suite <suites...>', 'filter suites')
    .option('--threshold <n>', 'minimum quality score threshold', parseFloat, 0.8)
    .option('-o, --output <path>', 'write report to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        config: string;
        model?: string[];
        layer?: string[];
        suite?: string[];
        threshold: number;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Cost Optimization Report');

        const models = opts.model ?? [];
        if (models.length < 2) {
          log.error('Cost report requires at least 2 models (--model a --model b)');
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        let config;
        try {
          config = loadConfig(opts.config);
        } catch (err) {
          log.error('Configuration error', err);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        try {
          const { analyzeCosts, formatCostReport: fmtCost } =
            await import('../../cost-advisor/index.js');

          const comparisonData: Array<{
            testName: string;
            model: string;
            score: number;
            tokenUsage?: { input: number; output: number };
          }> = [];

          for (const modelId of models) {
            log.info(`Running evaluation with model: ${modelId}`);
            const result = await runEvaluation(config, {
              layers: opts.layer,
              suites: opts.suite,
              models: [modelId],
            });

            for (const suite of result.suites) {
              for (const test of suite.tests) {
                const avgScore =
                  test.evaluatorResults.length > 0
                    ? test.evaluatorResults.reduce((s, e) => s + e.score, 0) /
                      test.evaluatorResults.length
                    : test.pass
                      ? 1
                      : 0;
                comparisonData.push({
                  testName: `${suite.name}/${test.name}`,
                  model: modelId,
                  score: avgScore,
                  tokenUsage: test.tokenUsage,
                });
              }
            }
          }

          const report = analyzeCosts(comparisonData, opts.threshold);
          const formatted = fmtCost(report);
          console.log(formatted);

          if (opts.output) {
            const outPath = resolve(process.cwd(), opts.output);
            writeFileSync(outPath, formatted, 'utf-8');
            log.success(`Report written to ${outPath}`);
          }
        } catch (err) {
          log.error('Cost analysis failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  // Registry subcommand group
  const registry = program
    .command('registry')
    .description('Browse, pull, and push evaluation suites from the community registry');

  registry
    .command('list')
    .description('List available suites in the remote registry')
    .option('--url <registryUrl>', 'custom registry URL')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(async (opts: { url?: string; verbose?: boolean; noColor?: boolean }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Registry — Available Suites');

      try {
        const { fetchRegistry } = await import('../../registry/index.js');
        const entries = await fetchRegistry(opts.url);

        if (entries.length === 0) {
          log.info('No suites found in the registry.');
          return;
        }

        for (const entry of entries) {
          log.info(`  ${entry.name.padEnd(24)} v${entry.version.padEnd(8)} [${entry.layer}]`);
          log.info(`    ${entry.description}`);
          log.info(`    by ${entry.author}`);
          console.log();
        }

        log.success(`${entries.length} suite(s) available`);
      } catch (err) {
        log.error('Failed to fetch registry', err);
        process.exitCode = EXIT_FAIL;
      }
    });

  registry
    .command('pull <name>')
    .description('Download a suite YAML from the registry into collections/')
    .option('--url <registryUrl>', 'custom registry URL')
    .option('-o, --output <dir>', 'output directory for downloaded suite', './collections')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (
        name: string,
        opts: { url?: string; output: string; verbose?: boolean; noColor?: boolean },
      ) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        try {
          const { fetchRegistry, pullSuite } = await import('../../registry/index.js');
          const entries = await fetchRegistry(opts.url);
          const entry = entries.find((e) => e.name === name);

          if (!entry) {
            log.error(`Suite "${name}" not found in registry`);
            log.info('Available suites:');
            for (const e of entries) {
              log.info(`  ${e.name}`);
            }
            process.exitCode = EXIT_FAIL;
            return;
          }

          const outDir = resolve(process.cwd(), opts.output);
          const path = await pullSuite(entry, outDir);
          log.success(`Downloaded ${entry.name} → ${path}`);
        } catch (err) {
          log.error('Failed to pull suite', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  registry
    .command('push')
    .description('Package a suite YAML and output its registry metadata')
    .requiredOption('--suite <path>', 'path to suite YAML file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(async (opts: { suite: string; verbose?: boolean; noColor?: boolean }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      try {
        const { packageSuite } = await import('../../registry/index.js');
        const suitePath = resolve(process.cwd(), opts.suite);
        const entry = packageSuite(suitePath);

        log.header('Registry — Package Suite');
        log.info('Add this entry to registry.json:\n');
        console.log(JSON.stringify(entry, null, 2));
      } catch (err) {
        log.error('Failed to package suite', err);
        process.exitCode = EXIT_FAIL;
      }
    });

  // Dataset subcommand group
  const datasetCmd = program.command('dataset').description('Manage versioned evaluation datasets');

  datasetCmd
    .command('create <name>')
    .description('Create a new dataset')
    .option('--description <text>', 'dataset description', '')
    .action(async (name: string, opts: { description: string }) => {
      try {
        const { createDataset } = await import('../../dataset/manager.js');
        const ds = await createDataset(name, opts.description);
        log.success(`Created dataset "${ds.name}" v${ds.version}`);
      } catch (err) {
        log.error('Failed to create dataset', err);
        process.exitCode = EXIT_FAIL;
      }
    });

  datasetCmd
    .command('list')
    .description('List all datasets')
    .action(async () => {
      try {
        const { listDatasets } = await import('../../dataset/manager.js');
        const datasets = await listDatasets();
        if (datasets.length === 0) {
          log.info('No datasets found.');
          return;
        }
        for (const ds of datasets) {
          log.info(
            `  ${ds.name.padEnd(24)} v${String(ds.version).padEnd(4)} ${ds.exampleCount} examples  ${ds.description}`,
          );
        }
      } catch (err) {
        log.error('Failed to list datasets', err);
        process.exitCode = EXIT_FAIL;
      }
    });

  datasetCmd
    .command('add <dataset-name>')
    .description('Add an example to a dataset (reads JSON from stdin or --json)')
    .option('--json <data>', 'example JSON data')
    .action(async (datasetName: string, opts: { json?: string }) => {
      try {
        const { addExample } = await import('../../dataset/manager.js');
        let example;
        if (opts.json) {
          example = JSON.parse(opts.json);
        } else {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
          example = JSON.parse(Buffer.concat(chunks).toString());
        }
        await addExample(datasetName, example);
        log.success(`Added example to dataset "${datasetName}"`);
      } catch (err) {
        log.error('Failed to add example', err);
        process.exitCode = EXIT_FAIL;
      }
    });

  datasetCmd
    .command('export <dataset-name>')
    .description('Export dataset as YAML suite format')
    .option('-o, --output <path>', 'write YAML to file')
    .action(async (datasetName: string, opts: { output?: string }) => {
      try {
        const { exportToYaml: dsExport } = await import('../../dataset/manager.js');
        const yaml = await dsExport(datasetName);
        if (opts.output) {
          writeFileSync(resolve(process.cwd(), opts.output), yaml, 'utf-8');
          log.success(`Exported to ${opts.output}`);
        } else {
          console.log(yaml);
        }
      } catch (err) {
        log.error('Failed to export dataset', err);
        process.exitCode = EXIT_FAIL;
      }
    });

  datasetCmd
    .command('version <dataset-name>')
    .description('Create a new version snapshot of a dataset')
    .action(async (datasetName: string) => {
      try {
        const { versionDataset } = await import('../../dataset/manager.js');
        const snapshot = await versionDataset(datasetName);
        log.success(`Created version ${snapshot.version} of dataset "${datasetName}"`);
      } catch (err) {
        log.error('Failed to version dataset', err);
        process.exitCode = EXIT_FAIL;
      }
    });

  program
    .command('serve')
    .description('Start the MCP server for agent integration')
    .option('--transport <type>', 'Transport type: stdio or http', 'stdio')
    .option('--port <port>', 'Port for HTTP transport', '6281')
    .action(async () => {
      const { startStdioServer } = await import('../../mcp/server.js');
      await startStdioServer();
    });
}
