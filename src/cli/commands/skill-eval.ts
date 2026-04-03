import { resolve, dirname, join } from 'node:path';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { generateMarkdownReport } from '../../reporting/markdown.js';
import { CLI_NAME } from '../../core/constants.js';
import type { RunResult } from '../../core/types.js';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { EXIT_FAIL, EXIT_CONFIG_ERROR, parsePositiveInt } from './helpers.js';
import { formatReport } from './run.js';

export function registerSkillEvalCommands(program: Command): void {
  program
    .command('skill-eval')
    .description('Run skill-level evaluations using eval.yaml datasets')
    .requiredOption('--skill-dir <path>', 'directory containing SKILL.md and eval.yaml')
    .option('-c, --config <path>', 'config file path for plugin connection', './plugin-eval.yaml')
    .option(
      '-a, --adapter <adapters...>',
      'adapter(s) to use (mcp, plain-llm, headless-coder, gemini-cli, claude-sdk)',
    )
    .option('-e, --evaluators <evaluators...>', 'evaluators to run')
    .option('-r, --repeat <n>', 'repetitions per example', parsePositiveInt)
    .option('--report <format>', 'output format: terminal, markdown, json', 'terminal')
    .option('-o, --output <path>', 'write report to file')
    .option('--optimize', 'apply AI recommendations to eval.yaml after run')
    .option('--no-llm-recommendations', 'skip LLM-powered recommendations (deterministic only)')
    .option('--setup', 'run the eval.yaml setup.script before evaluating (seed data, etc.)')
    .option('--no-sandbox', 'skip Docker sandbox — run evals directly on host (default: sandbox on)')
    .option('--start-local [version]', 'use elastic/start-local for ES setup instead of docker-compose')
    .option('--skip-isolation', 'skip workspace isolation (run in skill dir directly)')
    .option('--concurrency <n>', 'max parallel tests (default: 5 for agent adapters)', parsePositiveInt)
    .option('--filter <pattern>', 'run only tests whose name matches this substring or regex')
    .option('--last-failed', 'run only tests that failed in the previous output file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        skillDir: string;
        config: string;
        adapter?: string[];
        evaluators?: string[];
        repeat?: number;
        report: string;
        output?: string;
        optimize?: boolean;
        llmRecommendations?: boolean;
        setup?: boolean;
        sandbox: boolean;
        startLocal?: string | boolean;
        skipIsolation?: boolean;
        concurrency?: number;
        filter?: string;
        lastFailed?: boolean;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        // Sandbox mode is ON by default — skip with --no-sandbox
        if (opts.sandbox) {
          const { execSync: execSyncSandbox } = await import('child_process');
          let hasSbx = false;
          try {
            execSyncSandbox('sbx version', { stdio: 'pipe', timeout: 5_000 });
            hasSbx = true;
          } catch (_e) {
            // sbx not installed — fall through to run locally
          }

          if (hasSbx) {
            // Build args to forward, stripping --no-sandbox (not present, but guard)
            const forwardArgs = process.argv
              .slice(process.argv.indexOf('skill-eval') + 1)
              .filter((a) => a !== '--sandbox' && a !== '--no-sandbox');

            const sandboxCmd = `bash scripts/sandbox-eval.sh ${forwardArgs.join(' ')}`;
            const sandboxName = `cpe-eval-${Date.now()}`;

            log.info(`Launching Docker sandbox: ${sandboxName}`);
            log.info(`  Command: ${sandboxCmd}`);
            log.info('');

            try {
              execSyncSandbox(
                `sbx run claude --name ${sandboxName} -- "${sandboxCmd}"`,
                { stdio: 'inherit', cwd: process.cwd(), timeout: 900_000 },
              );
            } catch (err) {
              log.error('Sandbox eval failed', err);
              process.exitCode = 1;
            }
            return;
          }

          log.warn('Docker sandbox CLI (sbx) not found — falling back to local execution.');
          log.info('  Install Docker Desktop with Sandbox support for isolated eval runs.');
          log.info('  See: https://docs.docker.com/ai/sandboxes/get-started/');
          log.info('  Use --no-sandbox to silence this warning.');
          log.info('');
        }

        // --start-local: start ES via elastic/start-local before eval
        if (opts.startLocal) {
          const { execSync: execSyncLocal } = await import('child_process');
          const version = typeof opts.startLocal === 'string' ? opts.startLocal : '';
          const versionArg = version ? `-v ${version}` : '';
          const startLocalEnvPath = resolve(process.cwd(), 'elastic-start-local/.env');

          // Check if already running
          let alreadyRunning = false;
          if (existsSync(startLocalEnvPath)) {
            try {
              const envContent = readFileSync(startLocalEnvPath, 'utf-8');
              const passwordMatch = envContent.match(/ES_LOCAL_PASSWORD=(.+)/);
              if (passwordMatch) {
                execSyncLocal(
                  `curl -sf "http://elastic:${passwordMatch[1]}@localhost:9200/_cluster/health"`,
                  { stdio: 'pipe', timeout: 5_000 },
                );
                alreadyRunning = true;
                log.info('Elasticsearch already running via start-local');
                // Set env vars from existing .env
                process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
                process.env.ES_USER = 'elastic';
                process.env.ES_PASS = passwordMatch[1];
              }
            } catch (_e) {
              // Not running, will start
            }
          }

          if (!alreadyRunning) {
            log.info('Starting Elastic Stack via elastic/start-local...');
            try {
              execSyncLocal(
                `curl -fsSL https://elastic.co/start-local | sh -s -- ${versionArg}`.trim(),
                { stdio: 'inherit', cwd: process.cwd(), timeout: 120_000 },
              );
              // Read generated credentials
              if (existsSync(startLocalEnvPath)) {
                const envContent = readFileSync(startLocalEnvPath, 'utf-8');
                const passwordMatch = envContent.match(/ES_LOCAL_PASSWORD=(.+)/);
                if (passwordMatch) {
                  process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
                  process.env.ES_USER = 'elastic';
                  process.env.ES_PASS = passwordMatch[1];
                  log.info(`Elasticsearch started. Password: ${passwordMatch[1]}`);
                }
              }
            } catch (err) {
              log.error('Failed to start Elasticsearch via start-local', err);
              process.exitCode = EXIT_CONFIG_ERROR;
              return;
            }
          }
          log.info('');
        }

        log.header('Skill Evaluation');

        let config;
        try {
          config = loadConfig(opts.config);
        } catch (err) {
          log.error('Configuration error', err);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        const skillDir = resolve(process.cwd(), opts.skillDir);

        // Load .env from skill directory if present (supplements cwd .env loaded by dotenv/config)
        const skillEnvPath = join(skillDir, '.env');
        if (existsSync(skillEnvPath)) {
          const { config: dotenvConfig } = await import('dotenv');
          dotenvConfig({ path: skillEnvPath, override: false });
        }

        // Check if plugin-eval.yaml has a matching suite with skip_isolation
        const matchingSuite = config.suites.find(
          (s) => s.skillDir === skillDir || s.skillDir === opts.skillDir,
        );
        const skipIsolation = opts.skipIsolation ?? matchingSuite?.skipIsolation ?? false;

        // Load last-failed test names from previous output file
        let testFilter: { names?: Set<string>; pattern?: RegExp } | undefined;
        if (opts.lastFailed && opts.output) {
          const prevPath = resolve(process.cwd(), opts.output);
          if (existsSync(prevPath)) {
            try {
              const prev = JSON.parse(readFileSync(prevPath, 'utf-8')) as RunResult;
              const failedNames = prev.suites?.[0]?.tests
                ?.filter((t) => !t.pass)
                .map((t) => t.name) ?? [];
              if (failedNames.length > 0) {
                testFilter = { names: new Set(failedNames) };
                log.info(`Re-running ${failedNames.length} previously failed tests`);
              } else {
                log.info('No failed tests in previous run — running all tests');
              }
            } catch (_e) {
              log.warn('Could not parse previous output for --last-failed, running all tests');
            }
          }
        }
        if (opts.filter) {
          try {
            testFilter = { ...testFilter, pattern: new RegExp(opts.filter, 'i') };
          } catch (_e) {
            // Treat as substring match if not valid regex
            testFilter = { ...testFilter, pattern: new RegExp(opts.filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
          }
          log.info(`Filtering tests matching: ${opts.filter}`);
        }

        const syntheticSuite: import('../../core/types.js').SuiteConfig = {
          name: `skill:${opts.skillDir}`,
          layer: 'skill',
          tests: [],
          defaults: {
            timeout: config.defaults?.timeout ?? 120_000,
            repetitions: opts.repeat ?? config.defaults?.repetitions ?? 1,
            judgeModel: config.defaults?.judgeModel,
            thresholds: config.defaults?.thresholds ?? {},
          },
          adapter: opts.adapter,
          skillDir,
          skillPath: join(skillDir, 'SKILL.md'),
          skipIsolation,
          concurrency: opts.concurrency,
          testFilter: testFilter ? {
            names: testFilter.names,
            pattern: testFilter.pattern,
          } : undefined,
        };

        try {
          const { runSkillSuite } = await import('../../layers/skill/index.js');
          const { createEvaluator } = await import('../../evaluators/index.js');
          const { loadSkillDataset } = await import('../../layers/skill/loader.js');

          // Load dataset to access setup config and evaluators
          const dataset = loadSkillDataset(skillDir);

          // Run setup script if --setup flag is passed
          if (opts.setup) {
            const setupScript = dataset.setup?.script;
            if (setupScript) {
              // Resolve script relative to skill dir; if not found, try:
              // 1. Follow eval.yaml symlink to its real location
              // 2. Map skills/X/Y → tests/X/Y (common convention)
              let scriptPath = resolve(skillDir, setupScript);
              if (!existsSync(scriptPath)) {
                const { realpathSync } = await import('fs');
                try {
                  const evalYamlReal = realpathSync(resolve(skillDir, 'eval.yaml'));
                  const evalYamlDir = dirname(evalYamlReal);
                  const candidate = resolve(evalYamlDir, setupScript);
                  if (existsSync(candidate)) scriptPath = candidate;
                } catch (_e) { /* ignore */ }
              }
              if (!existsSync(scriptPath)) {
                // Convention: skills/domain/skill-name → tests/domain/skill-name
                // Only replace "/skills/" as a path segment (not in repo names like "agent-skills-sandbox")
                const testsCandidate = skillDir.replace(/\/skills\//, '/tests/');
                if (testsCandidate !== skillDir) {
                  const candidate = resolve(testsCandidate, setupScript);
                  if (existsSync(candidate)) scriptPath = candidate;
                }
              }

              if (existsSync(scriptPath)) {
                log.info(`Running setup script: ${setupScript}`);
                try {
                  const { execSync: execSetup } = await import('child_process');
                  execSetup(`bash "${scriptPath}"`, {
                    cwd: dirname(scriptPath),
                    stdio: 'inherit',
                    timeout: 120_000,
                    env: { ...process.env },
                  });
                  log.success('Setup script completed');
                } catch (err) {
                  log.error('Setup script failed', err);
                  process.exitCode = EXIT_FAIL;
                  return;
                }
              } else {
                log.warn(`Setup script not found: ${scriptPath}`);
                if (dataset.setup?.notes?.length) {
                  log.info('Setup notes:');
                  for (const note of dataset.setup.notes) {
                    log.info(`  - ${note}`);
                  }
                }
              }
            } else {
              log.info('No setup.script defined in eval.yaml');
            }
          }

          // Merge CLI evaluators with dataset evaluators so domain-specific
          // evaluators (e.g. esql-execution) are registered automatically
          const cliEvals = opts.evaluators ?? ['correctness', 'groundedness'];
          const datasetEvals = dataset.evaluators ?? [];
          const evalNames = [...new Set([...cliEvals, ...datasetEvals])];
          const evaluatorRegistry = new Map<string, import('../../core/types.js').Evaluator>();
          for (const name of evalNames) {
            try {
              evaluatorRegistry.set(name, createEvaluator(name));
            } catch (_e) {
              log.warn(`Evaluator "${name}" not available, skipping`);
            }
          }

          const tests = await runSkillSuite(
            syntheticSuite,
            config.plugin,
            syntheticSuite.defaults ?? {},
            evaluatorRegistry,
          );

          const passCount = tests.filter((t) => t.pass).length;
          const failCount = tests.filter((t) => !t.pass).length;
          const totalDuration = tests.reduce((s, t) => s + t.latencyMs, 0);

          const evaluatorSummary: Record<
            string,
            { mean: number; min: number; max: number; pass: number; total: number }
          > = {};
          for (const test of tests) {
            for (const er of test.evaluatorResults) {
              if (!evaluatorSummary[er.evaluator]) {
                evaluatorSummary[er.evaluator] = {
                  mean: 0,
                  min: Infinity,
                  max: -Infinity,
                  pass: 0,
                  total: 0,
                };
              }
              const s = evaluatorSummary[er.evaluator];
              s.total++;
              s.mean += er.score;
              s.min = Math.min(s.min, er.score);
              s.max = Math.max(s.max, er.score);
              if (er.pass) s.pass++;
            }
          }
          for (const s of Object.values(evaluatorSummary)) {
            if (s.total > 0) s.mean /= s.total;
          }

          const result: RunResult = {
            runId: '',
            timestamp: new Date().toISOString(),
            config: opts.config,
            overall: {
              passed: passCount,
              failed: failCount,
              skipped: 0,
              total: tests.length,
              passRate: tests.length > 0 ? passCount / tests.length : 0,
              duration: totalDuration,
            },
            suites: [
              {
                name: syntheticSuite.name,
                layer: 'skill',
                tests,
                passRate: tests.length > 0 ? passCount / tests.length : 0,
                duration: totalDuration,
                evaluatorSummary,
              },
            ],
          };

          // Print terminal report immediately (before recommendations)
          const report = formatReport(result, opts.report);
          if (report !== null) console.log(report);

          // --- Recommendations ---
          const { computeDeterministicRecommendations, computeLlmRecommendations } =
            await import('../../skill-init/recommendations.js');
          const { parse: parseYaml } = await import('yaml');

          const evalYamlPath = resolve(skillDir, 'eval.yaml');
          const evalYamlContent = existsSync(evalYamlPath) ? readFileSync(evalYamlPath, 'utf-8') : '';
          const evalYamlParsed = evalYamlContent ? (parseYaml(evalYamlContent) as Record<string, unknown>) : {};

          // Read SKILL.md for both deterministic and LLM recommendations
          const skillMdPath = resolve(skillDir, 'SKILL.md');
          const skillContentForRecs = existsSync(skillMdPath) ? readFileSync(skillMdPath, 'utf-8') : '';

          let allRecs = computeDeterministicRecommendations(result, evalYamlParsed, skillContentForRecs || undefined);

          if (opts.llmRecommendations !== false && skillContentForRecs) {
            const llmRecs = await computeLlmRecommendations(result, skillContentForRecs, evalYamlContent);
            allRecs = [...allRecs, ...llmRecs];
          }

          if (allRecs.length > 0) {
            result.recommendations = allRecs;
            const { printRecommendations } = await import('../../reporting/terminal.js');
            printRecommendations(allRecs);
          }

          // Write report file AFTER recommendations are attached to result
          if (opts.output) {
            const outPath = resolve(process.cwd(), opts.output);
            // Auto-detect format from extension when --report is terminal (default)
            const autoFormat = outPath.endsWith('.json') ? 'json' : outPath.endsWith('.html') ? 'html' : null;
            const outputContent = (autoFormat ? formatReport(result, autoFormat) : report) ?? generateMarkdownReport(result);
            writeFileSync(outPath, outputContent, 'utf-8');
            log.success(`Report written to ${outPath}`);
          }

          // --- Optimize ---
          if (opts.optimize && allRecs.length > 0) {
            const actionableRecs = allRecs.filter((r) => r.action);
            if (actionableRecs.length > 0 && evalYamlContent) {
              const { applyPatches } = await import('../../skill-init/optimizer.js');
              const { stringify } = await import('yaml');
              const patches = actionableRecs
                .map((r) => r.action)
                .filter((a): a is import('../../skill-init/recommendations.js').EvalYamlPatch => !!a);
              const patched = applyPatches(evalYamlParsed, patches);
              const header = evalYamlContent.match(/^(#[^\n]*\n)*/)?.[0] ?? '';
              writeFileSync(evalYamlPath, header + stringify(patched, { lineWidth: 120 }), 'utf-8');
              log.success(`Applied ${actionableRecs.length} optimization(s) to eval.yaml`);
            }
          }
        } catch (err) {
          log.error('Skill evaluation failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  program
    .command('skill-eval-init')
    .description('Auto-generate eval.yaml from SKILL.md using LLM analysis')
    .requiredOption('--skill-dir <path>', 'directory containing SKILL.md')
    .option('--force', 'overwrite existing eval.yaml')
    .option('-m, --model <model>', 'LLM model for generation')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        skillDir: string;
        force?: boolean;
        model?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        const skillDir = resolve(process.cwd(), opts.skillDir);
        const skillMdPath = resolve(skillDir, 'SKILL.md');
        const evalYamlPath = resolve(skillDir, 'eval.yaml');

        if (!existsSync(skillMdPath)) {
          log.error(`No SKILL.md found in ${skillDir}. Create a SKILL.md first, then run init again.`);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        if (existsSync(evalYamlPath) && !opts.force) {
          log.error(`eval.yaml already exists in ${skillDir}. Use --force to overwrite.`);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        log.header('Skill Eval Init');

        try {
          const { analyzeSkill } = await import('../../skill-init/analyzer.js');
          const { generateEval } = await import('../../skill-init/generator.js');
          const { serializeEvalYaml } = await import('../../skill-init/writer.js');

          log.info('  Analyzing SKILL.md...');
          const skillContent = readFileSync(skillMdPath, 'utf-8');
          const profile = await analyzeSkill(skillContent, opts.model);
          log.info(`  Profile: ${profile.name} (${profile.complexity}, ${profile.capabilities.length} capabilities)`);

          log.info('  Generating tests...');
          const generated = await generateEval(profile, opts.model);
          log.info(`  Generated ${generated.tests.length} tests with evaluators: ${generated.evaluators.join(', ')}`);

          const yaml = serializeEvalYaml(generated);
          writeFileSync(evalYamlPath, yaml, 'utf-8');
          log.success(`eval.yaml written to ${evalYamlPath}`);
          log.info('');
          log.info(`  Run: ${CLI_NAME} skill-eval --skill-dir ${opts.skillDir}`);
        } catch (err) {
          log.error('Init failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );
}
