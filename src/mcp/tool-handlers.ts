import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { DATA_DIR } from '../core/constants.js';
import type { AdapterConfig, RunResult } from '../core/types.js';

function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function errorResult(message: string) {
  return textResult({ error: message }, true);
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  switch (name) {
    case 'load_config': {
      try {
        const { loadConfig } = await import('../core/config.js');
        const configPath = resolve(
          process.cwd(),
          (args?.config_path as string) || './plugin-eval.yaml',
        );
        const config = loadConfig(configPath);

        const layerBreakdown: Record<string, number> = {};
        for (const suite of config.suites) {
          layerBreakdown[suite.layer] = (layerBreakdown[suite.layer] || 0) + 1;
        }

        return textResult({
          pluginName: config.plugin.name,
          pluginDir: config.plugin.dir,
          suiteCount: config.suites.length,
          testCount: config.suites.reduce((s, suite) => s + suite.tests.length, 0),
          layerBreakdown,
          ciThresholds: config.ci ?? null,
          defaults: config.defaults ?? null,
        });
      } catch (err) {
        return errorResult(
          `Failed to load config: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'discover_plugin': {
      try {
        const { discoverPlugin } = await import('../plugin/discovery.js');
        const dir = resolve(process.cwd(), (args?.dir as string) || '.');
        const pluginRoot = args?.plugin_root as string | undefined;
        const manifest = discoverPlugin(dir, pluginRoot);

        return textResult({
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          skills: manifest.skills.map((s) => ({
            name: s.name,
            description: s.description?.slice(0, 120),
          })),
          rules: manifest.rules.map((r) => ({
            path: r.path,
            description: r.description?.slice(0, 120),
          })),
          agents: manifest.agents.map((a) => ({
            name: a.name,
            description: a.description?.slice(0, 120),
          })),
          commands: manifest.commands.map((c) => ({
            name: c.name,
            path: c.path,
            description: c.description?.slice(0, 120),
          })),
          hooks: manifest.hooks.map((h) => ({
            event: h.event,
            handlerCount: h.handlers.length,
          })),
          mcpServers: manifest.mcpServers.map((m) => ({
            name: m.name,
            type: m.type,
            command: m.command,
            url: m.url,
          })),
        });
      } catch (err) {
        return errorResult(
          `Plugin discovery failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'audit_coverage': {
      try {
        const { analyzeCoverage } = await import('../coverage/analyzer.js');
        const pluginDir = resolve(process.cwd(), (args?.plugin_dir as string) || '.');
        const configPath = resolve(
          process.cwd(),
          (args?.config_path as string) || './plugin-eval.yaml',
        );
        const report = analyzeCoverage(pluginDir, configPath);
        return textResult(report);
      } catch (err) {
        return errorResult(
          `Coverage audit failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'detect_gaps': {
      try {
        const { scanCodebase } = await import('../assistant/codebase-scanner.js');
        const { auditCoverage } = await import('../assistant/coverage-analyzer.js');
        const { detectGaps } = await import('../assistant/gap-detector.js');

        const pluginDir = resolve(process.cwd(), (args?.plugin_dir as string) || '.');
        const profile = await scanCodebase(pluginDir);
        const audit = auditCoverage(profile);
        const gaps = detectGaps(profile, audit);

        return textResult(gaps);
      } catch (err) {
        return errorResult(
          `Gap detection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'generate_fixes': {
      try {
        const { scanCodebase } = await import('../assistant/codebase-scanner.js');
        const { auditCoverage } = await import('../assistant/coverage-analyzer.js');
        const { detectGaps } = await import('../assistant/gap-detector.js');
        const { generateFixes } = await import('../assistant/fix-generator.js');

        const pluginDir = resolve(process.cwd(), (args?.plugin_dir as string) || '.');
        const profile = await scanCodebase(pluginDir);
        const audit = auditCoverage(profile);
        const gaps = detectGaps(profile, audit);
        const fixes = generateFixes(gaps);

        return textResult({
          gapCount: gaps.length,
          fixCount: fixes.length,
          fixes: fixes.map((f) => ({
            gapId: f.gapId,
            description: f.description,
            files: f.files,
            testCommand: f.testCommand,
          })),
        });
      } catch (err) {
        return errorResult(
          `Fix generation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'list_runs': {
      try {
        const { initDb, getLatestRuns } = await import('../dashboard/db.js');
        const dbPath = resolve(process.cwd(), DATA_DIR, 'dashboard.db');
        const db = initDb(dbPath);
        const limit = (args?.limit as number) || 20;
        const runs = getLatestRuns(db, limit);
        db.close();

        return textResult(
          runs.map((r) => {
            let overall: Record<string, unknown> = {};
            try {
              overall = JSON.parse(r.overall_json) as Record<string, unknown>;
            } catch (_e) {
              // malformed JSON — return raw fields
            }
            return {
              id: r.id,
              timestamp: r.timestamp,
              config: r.config,
              ...overall,
            };
          }),
        );
      } catch (err) {
        return errorResult(
          `Failed to list runs: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'get_run_detail': {
      try {
        const runId = args?.run_id as string;
        if (!runId) return errorResult('run_id is required');

        const { initDb, getRun } = await import('../dashboard/db.js');
        const dbPath = resolve(process.cwd(), DATA_DIR, 'dashboard.db');
        const db = initDb(dbPath);
        const result = getRun(db, runId);
        db.close();

        if (!result) return errorResult(`Run not found: ${runId}`);
        return textResult(result);
      } catch (err) {
        return errorResult(
          `Failed to get run detail: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'run_evals': {
      let config;
      try {
        const { loadConfig } = await import('../core/config.js');
        const configPath = resolve(
          process.cwd(),
          (args?.config_path as string) || './plugin-eval.yaml',
        );
        config = loadConfig(configPath);
      } catch (err) {
        return errorResult(
          `Config error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      try {
        const { runEvaluation } = await import('../core/runner.js');
        const result = await runEvaluation(config, {
          suites: args?.suites as string[] | undefined,
          layers: args?.layers as string[] | undefined,
          ci: args?.ci as boolean | undefined,
        });

        return textResult({
          runId: result.runId,
          timestamp: result.timestamp,
          overall: result.overall,
          suites: result.suites.map((s) => ({
            name: s.name,
            layer: s.layer,
            passRate: s.passRate,
            duration: s.duration,
            tests: s.tests.map((t) => ({
              name: t.name,
              pass: t.pass,
              latencyMs: t.latencyMs,
              evaluatorResults: t.evaluatorResults,
            })),
          })),
          ciResult: result.ciResult ?? null,
          qualityScore: result.qualityScore ?? null,
        });
      } catch (err) {
        return errorResult(
          `Evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'doctor': {
      try {
        const checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; message: string }> =
          [];

        const nodeVersion = process.version;
        const major = parseInt(nodeVersion.slice(1), 10);
        checks.push({
          name: 'Node.js',
          status: major >= 20 ? 'ok' : 'fail',
          message: `${nodeVersion}${major < 20 ? ' (requires >= 20)' : ''}`,
        });

        try {
          execSync('docker info', { stdio: 'pipe', timeout: 10_000 });
          checks.push({ name: 'Docker', status: 'ok', message: 'Running' });
        } catch (_e) {
          checks.push({ name: 'Docker', status: 'warn', message: 'Not running or not installed' });
        }

        try {
          execSync('docker compose version', { stdio: 'pipe', timeout: 5_000 });
          checks.push({ name: 'Docker Compose', status: 'ok', message: 'Available' });
        } catch (_e) {
          checks.push({ name: 'Docker Compose', status: 'warn', message: 'Not available' });
        }

        const apiKeys = [
          { env: 'OPENAI_API_KEY', label: 'OpenAI API Key' },
          { env: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key' },
          { env: 'AZURE_OPENAI_API_KEY', label: 'Azure OpenAI API Key' },
          { env: 'AWS_ACCESS_KEY_ID', label: 'AWS Access Key (Bedrock)' },
          { env: 'ES_API_KEY', label: 'Elasticsearch API Key' },
        ];

        for (const key of apiKeys) {
          const present = !!process.env[key.env];
          checks.push({
            name: key.label,
            status: present ? 'ok' : 'warn',
            message: present ? 'Set' : `${key.env} not set`,
          });
        }

        return textResult(checks);
      } catch (err) {
        return errorResult(
          `Doctor failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'analyze_collisions': {
      try {
        const { analyzeCollisions } = await import('../analyzers/skill-collision.js');
        const skillsDir = resolve(
          process.cwd(),
          (args?.skills_dir as string) || '.cursor-plugin/skills',
        );
        const report = await analyzeCollisions(skillsDir);
        return textResult({
          skillCount: report.skills.length,
          errors: report.errors,
          warnings: report.warnings,
          cleanPairs: report.clean.length,
        });
      } catch (err) {
        return errorResult(
          `Collision analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'security_audit': {
      try {
        const { runSecurityAudit } = await import('../analyzers/security-audit.js');
        const { McpPluginClient } = await import('./client.js');
        const { loadConfig } = await import('../core/config.js');
        const { parseEntry } = await import('../core/utils.js');

        const pluginDir = resolve(process.cwd(), (args?.plugin_dir as string) || '.');
        const configPath = args?.config_path
          ? resolve(process.cwd(), args.config_path as string)
          : resolve(process.cwd(), './plugin-eval.yaml');

        let tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }> = [];
        try {
          const config = loadConfig(configPath);
          if (config.plugin.entry) {
            const { command, args: entryArgs } = parseEntry(config.plugin.entry);
            const client = await McpPluginClient.connect({
              command,
              args: entryArgs,
              cwd: config.plugin.dir,
              env: config.plugin.env,
              buildCommand: config.plugin.buildCommand,
            });
            const mcpTools = await client.listTools();
            tools = mcpTools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema as Record<string, unknown>,
            }));
            await client.disconnect();
          }
        } catch (_e) {
          // If we can't connect, run audit with empty tools
        }

        const result = await runSecurityAudit(tools, pluginDir);
        return textResult(result);
      } catch (err) {
        return errorResult(
          `Security audit failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'regression_check': {
      try {
        const baselineId = args?.baseline_run_id as string;
        if (!baselineId) return errorResult('baseline_run_id is required');

        const { loadFingerprint, buildFingerprint, listFingerprints } = await import(
          '../regression/fingerprint.js'
        );
        const { detectRegressions } = await import('../regression/detector.js');
        const { loadConfig } = await import('../core/config.js');
        const { runEvaluation } = await import('../core/runner.js');

        const baseline = await loadFingerprint(baselineId);
        if (!baseline) {
          const ids = await listFingerprints();
          return errorResult(
            `Baseline not found: ${baselineId}. Available: ${ids.join(', ') || '(none)'}`,
          );
        }

        const configPath = resolve(
          process.cwd(),
          (args?.config_path as string) || './plugin-eval.yaml',
        );
        const config = loadConfig(configPath);
        const result = await runEvaluation(config, {});

        const allTests = result.suites.flatMap((s) => s.tests);
        const currentFp = buildFingerprint(result.runId, allTests);
        const alpha = (args?.alpha as number) || 0.05;
        const regressions = detectRegressions(baseline, currentFp, alpha);

        return textResult({
          baselineRunId: baselineId,
          currentRunId: result.runId,
          regressions: regressions.map((r) => ({
            key: r.key,
            verdict: r.verdict,
            baselineMean: r.baselineMean,
            currentMean: r.currentMean,
            pValue: r.pValue,
          })),
          hasFails: regressions.some((r) => r.verdict === 'FAIL'),
        });
      } catch (err) {
        return errorResult(
          `Regression check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'compare_models': {
      try {
        const models = args?.models as string[];
        if (!models || models.length < 2) {
          return errorResult('At least 2 models are required');
        }

        const { loadConfig } = await import('../core/config.js');
        const { runEvaluation } = await import('../core/runner.js');
        const { buildComparisonFromRuns } = await import('../comparison/index.js');

        const configPath = resolve(
          process.cwd(),
          (args?.config_path as string) || './plugin-eval.yaml',
        );
        const config = loadConfig(configPath);

        const runs: Array<{ model: { id: string; provider: string }; result: RunResult }> = [];
        for (const modelId of models) {
          const result = await runEvaluation(config, {
            layers: args?.layers as string[] | undefined,
            suites: args?.suites as string[] | undefined,
            models: [modelId],
          });
          runs.push({ model: { id: modelId, provider: 'openai' }, result });
        }

        const comparison = buildComparisonFromRuns(runs);
        return textResult(comparison);
      } catch (err) {
        return errorResult(
          `Model comparison failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'evaluate_trace': {
      try {
        const { createOtelTraceAdapter } = await import('../adapters/otel-trace.js');
        const { createEvaluator } = await import('../evaluators/index.js');
        const traceFile = args?.trace_file as string | undefined;
        const traceId = args?.trace_id as string | undefined;
        const esEndpoint = args?.es_endpoint as string | undefined;
        const esApiKey = args?.es_api_key as string | undefined;
        const esIndex = args?.es_index as string | undefined;
        const esDocFormat = (args?.es_doc_format as 'apm' | 'otlp' | 'auto') ?? 'auto';
        const evaluatorNames = (args?.evaluators as string[]) ?? [
          'tool-selection',
          'response-quality',
          'security',
        ];
        const expectedTools = args?.expected_tools as string[] | undefined;

        if (!traceFile && !esEndpoint) {
          return errorResult('Either trace_file or es_endpoint is required');
        }

        const adapterConfig: AdapterConfig = {
          name: 'otel-trace',
          traceSource: esEndpoint
            ? {
                type: 'elasticsearch',
                endpoint: esEndpoint,
                apiKey: esApiKey,
                index: esIndex ?? 'traces-apm*,traces-generic.otel-*',
                docFormat: esDocFormat,
              }
            : {
                type: 'file',
                path: traceFile ? resolve(process.cwd(), traceFile) : undefined,
                format: 'auto',
              },
        };

        const adapter = createOtelTraceAdapter(adapterConfig);
        const example = {
          input: {
            traceId: traceId ?? 'auto',
            traceFile: traceFile ? resolve(process.cwd(), traceFile) : undefined,
          },
          output: expectedTools ? { tools: expectedTools } : undefined,
        };

        const output = await adapter(example);

        const results = [];
        for (const evalName of evaluatorNames) {
          try {
            const evaluator = createEvaluator(evalName);
            const result = await evaluator.evaluate({
              testName: `trace-eval-${traceId ?? 'auto'}`,
              prompt: output.messages.find((m) => m.role === 'user')?.content,
              toolCalls: output.toolCalls,
              finalOutput: output.output,
              expected: expectedTools ? { tools: expectedTools } : undefined,
              tokenUsage: output.tokenUsage ?? undefined,
              latencyMs: output.latencyMs,
              adapterName: 'otel-trace',
            });
            results.push(result);
          } catch (err) {
            results.push({
              evaluator: evalName,
              score: 0,
              pass: false,
              explanation: `Evaluator error: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }

        const avgScore =
          results.length > 0
            ? results.reduce((s, r) => s + r.score, 0) / results.length
            : 0;

        return textResult({
          traceId: traceId ?? output.adapter,
          toolsCalled: output.toolCalls.map((t) => t.tool),
          latencyMs: output.latencyMs,
          tokenUsage: output.tokenUsage,
          evaluatorResults: results,
          overallScore: avgScore,
          pass: results.every((r) => r.pass),
        });
      } catch (err) {
        return errorResult(
          `Trace evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'harvest_traces': {
      try {
        const { harvestTests, harvestedTestsToYaml } = await import('../harvest/index.js');
        const endpoint = args?.endpoint as string;
        if (!endpoint) return errorResult('endpoint is required');

        const tests = await harvestTests({
          endpoint,
          apiKey: args?.api_key as string | undefined,
          index: (args?.index as string) ?? 'traces-apm*,traces-generic.otel-*',
          timeRange: {
            from: (args?.time_from as string) ?? 'now-24h',
            to: (args?.time_to as string) ?? 'now',
          },
          scoreThreshold: (args?.score_threshold as number) ?? 0.5,
          maxTests: (args?.max_tests as number) ?? 20,
        });

        const yaml = harvestedTestsToYaml(tests);

        return textResult({
          testCount: tests.length,
          tests: tests.map((t) => ({
            name: t.name,
            prompt: t.prompt.slice(0, 200),
            tools: t.expected.tools,
            score: t.source.score,
            traceId: t.source.traceId,
          })),
          yaml,
        });
      } catch (err) {
        return errorResult(
          `Harvest failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'deploy_dashboard': {
      try {
        const kibanaUrl = args?.kibana_url as string;
        if (!kibanaUrl) return errorResult('kibana_url is required');

        const dashboardConfig = {
          title: (args?.title as string) ?? 'Plugin Eval Results',
        };

        if (args?.export_only) {
          const { buildDashboardNdjson } = await import('../kibana/dashboard.js');
          return textResult({ ndjson: buildDashboardNdjson(dashboardConfig) });
        }

        const { deployDashboard } = await import('../kibana/deploy.js');
        const result = await deployDashboard(
          {
            kibanaUrl,
            spaceId: (args?.space_id as string) ?? 'default',
            apiKey: args?.api_key as string | undefined,
          },
          dashboardConfig,
        );

        return textResult(result);
      } catch (err) {
        return errorResult(
          `Dashboard deployment failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    case 'cost_report': {
      try {
        const models = args?.models as string[];
        if (!models || models.length < 2) {
          return errorResult('At least 2 models are required');
        }

        const { loadConfig } = await import('../core/config.js');
        const { runEvaluation } = await import('../core/runner.js');
        const { analyzeCosts } = await import('../cost-advisor/index.js');

        const configPath = resolve(
          process.cwd(),
          (args?.config_path as string) || './plugin-eval.yaml',
        );
        const config = loadConfig(configPath);
        const threshold = (args?.threshold as number) || 0.8;

        const comparisonData: Array<{
          testName: string;
          model: string;
          score: number;
          tokenUsage?: { input: number; output: number };
        }> = [];

        for (const modelId of models) {
          const result = await runEvaluation(config, { models: [modelId] });
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

        const report = analyzeCosts(comparisonData, threshold);
        return textResult(report);
      } catch (err) {
        return errorResult(
          `Cost analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}
