import { resolve } from 'path';
import { execSync } from 'child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function errorResult(message: string) {
  return textResult({ error: message }, true);
}

export function createEvalServer(): Server {
  const server = new Server(
    { name: 'cursor-plugin-evals', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'load_config',
        description: 'Parse and validate a plugin-eval.yaml configuration file',
        inputSchema: {
          type: 'object' as const,
          properties: {
            config_path: {
              type: 'string',
              description: 'Path to plugin-eval.yaml (default: ./plugin-eval.yaml)',
            },
          },
        },
      },
      {
        name: 'discover_plugin',
        description: 'Scan a directory for plugin components (skills, rules, commands, agents, MCP servers)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            dir: { type: 'string', description: 'Directory to scan (default: .)' },
            plugin_root: {
              type: 'string',
              description: 'Path to plugin root relative to dir',
            },
          },
        },
      },
      {
        name: 'audit_coverage',
        description: 'Analyze test coverage and identify gaps for a plugin',
        inputSchema: {
          type: 'object' as const,
          properties: {
            plugin_dir: { type: 'string', description: 'Plugin directory (default: .)' },
            config_path: {
              type: 'string',
              description: 'Path to plugin-eval.yaml (default: ./plugin-eval.yaml)',
            },
          },
        },
      },
      {
        name: 'detect_gaps',
        description: 'Scan a plugin codebase and find missing tests with severity ratings',
        inputSchema: {
          type: 'object' as const,
          properties: {
            plugin_dir: { type: 'string', description: 'Plugin directory (default: .)' },
          },
        },
      },
      {
        name: 'generate_fixes',
        description: 'Auto-generate YAML test configurations and code to fill coverage gaps',
        inputSchema: {
          type: 'object' as const,
          properties: {
            plugin_dir: { type: 'string', description: 'Plugin directory (default: .)' },
          },
        },
      },
      {
        name: 'list_runs',
        description: 'Browse evaluation run history',
        inputSchema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', description: 'Max runs to return (default: 20)' },
          },
        },
      },
      {
        name: 'get_run_detail',
        description: 'Get full details for a specific evaluation run',
        inputSchema: {
          type: 'object' as const,
          properties: {
            run_id: { type: 'string', description: 'Run ID to look up' },
          },
          required: ['run_id'],
        },
      },
      {
        name: 'run_evals',
        description:
          'Run evaluation suites against a plugin. Returns structured results with pass/fail, scores, and CI gate status.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            config_path: {
              type: 'string',
              description: 'Path to plugin-eval.yaml (default: ./plugin-eval.yaml)',
            },
            suites: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific suite names',
            },
            layers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific layers (static, unit, integration, llm, performance)',
            },
            ci: {
              type: 'boolean',
              description: 'Enable CI mode — enforce thresholds',
            },
          },
        },
      },
      {
        name: 'doctor',
        description: 'Check environment prerequisites (Node, Docker, API keys, build tools)',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'analyze_collisions',
        description: 'Detect overlapping skills that may confuse routing',
        inputSchema: {
          type: 'object' as const,
          properties: {
            skills_dir: {
              type: 'string',
              description: 'Directory containing skill folders (default: .cursor-plugin/skills)',
            },
          },
        },
      },
      {
        name: 'security_audit',
        description: '3-pass security audit: static analysis, capability graph, dependency audit',
        inputSchema: {
          type: 'object' as const,
          properties: {
            plugin_dir: { type: 'string', description: 'Plugin directory (default: .)' },
            config_path: { type: 'string', description: 'Path to plugin-eval.yaml' },
          },
        },
      },
      {
        name: 'regression_check',
        description: "Compare current eval run against a baseline fingerprint using Welch's t-test",
        inputSchema: {
          type: 'object' as const,
          properties: {
            baseline_run_id: { type: 'string', description: 'Baseline fingerprint run ID' },
            config_path: { type: 'string', description: 'Path to plugin-eval.yaml' },
            alpha: {
              type: 'number',
              description: 'Significance level for t-test (default: 0.05)',
            },
          },
          required: ['baseline_run_id'],
        },
      },
      {
        name: 'compare_models',
        description: 'Run evals across multiple models and produce a comparison matrix',
        inputSchema: {
          type: 'object' as const,
          properties: {
            config_path: { type: 'string', description: 'Path to plugin-eval.yaml' },
            models: {
              type: 'array',
              items: { type: 'string' },
              description: 'Model IDs to compare (at least 2)',
            },
            layers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific layers',
            },
            suites: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific suites',
            },
          },
          required: ['models'],
        },
      },
      {
        name: 'cost_report',
        description: 'Analyze token usage and recommend cost optimizations across models',
        inputSchema: {
          type: 'object' as const,
          properties: {
            config_path: { type: 'string', description: 'Path to plugin-eval.yaml' },
            models: {
              type: 'array',
              items: { type: 'string' },
              description: 'Model IDs to compare (at least 2)',
            },
            threshold: {
              type: 'number',
              description: 'Minimum quality score threshold (default: 0.8)',
            },
          },
          required: ['models'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

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
          const dbPath = resolve(process.cwd(), '.cursor-plugin-evals', 'dashboard.db');
          const db = initDb(dbPath);
          const limit = (args?.limit as number) || 20;
          const runs = getLatestRuns(db, limit);
          db.close();

          return textResult(
            runs.map((r) => {
              let overall: Record<string, unknown> = {};
              try {
                overall = JSON.parse(r.overall_json) as Record<string, unknown>;
              } catch {
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
          const dbPath = resolve(process.cwd(), '.cursor-plugin-evals', 'dashboard.db');
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
          } catch {
            checks.push({ name: 'Docker', status: 'warn', message: 'Not running or not installed' });
          }

          try {
            execSync('docker compose version', { stdio: 'pipe', timeout: 5_000 });
            checks.push({ name: 'Docker Compose', status: 'ok', message: 'Available' });
          } catch {
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
          } catch {
            // If we can't connect, run audit with empty tools
          }

          const result = await runSecurityAudit(tools as any, pluginDir);
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

          const runs: Array<{ model: { id: string; provider: string }; result: any }> = [];
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
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'eval://config',
        name: 'Current Config',
        description: 'The current plugin-eval.yaml parsed as JSON',
        mimeType: 'application/json',
      },
      {
        uri: 'eval://latest-run',
        name: 'Latest Run',
        description: 'Most recent evaluation RunResult',
        mimeType: 'application/json',
      },
      {
        uri: 'eval://coverage',
        name: 'Coverage Matrix',
        description: 'Current test coverage matrix with gaps',
        mimeType: 'application/json',
      },
      {
        uri: 'eval://history',
        name: 'Run History',
        description: 'Last 50 evaluation runs summary',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    switch (uri) {
      case 'eval://config': {
        try {
          const { loadConfig } = await import('../core/config.js');
          const configPath = resolve(process.cwd(), './plugin-eval.yaml');
          const config = loadConfig(configPath);
          return {
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(config, null, 2) }],
          };
        } catch (err) {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  error: `Failed to load config: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
          };
        }
      }

      case 'eval://latest-run': {
        try {
          const { initDb, getLatestRuns } = await import('../dashboard/db.js');
          const dbPath = resolve(process.cwd(), '.cursor-plugin-evals', 'dashboard.db');
          const db = initDb(dbPath);
          const runs = getLatestRuns(db, 1);
          db.close();

          if (runs.length === 0) {
            return {
              contents: [
                { uri, mimeType: 'application/json', text: JSON.stringify({ message: 'No runs found' }) },
              ],
            };
          }

          return {
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(runs[0], null, 2) }],
          };
        } catch (err) {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  error: `Failed to read latest run: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
          };
        }
      }

      case 'eval://coverage': {
        try {
          const { analyzeCoverage } = await import('../coverage/analyzer.js');
          const pluginDir = process.cwd();
          const configPath = resolve(process.cwd(), './plugin-eval.yaml');
          const report = analyzeCoverage(pluginDir, configPath);
          return {
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(report, null, 2) }],
          };
        } catch (err) {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  error: `Failed to analyze coverage: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
          };
        }
      }

      case 'eval://history': {
        try {
          const { initDb, getLatestRuns } = await import('../dashboard/db.js');
          const dbPath = resolve(process.cwd(), '.cursor-plugin-evals', 'dashboard.db');
          const db = initDb(dbPath);
          const runs = getLatestRuns(db, 50);
          db.close();

          return {
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(runs, null, 2) }],
          };
        } catch (err) {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  error: `Failed to read history: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
          };
        }
      }

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createEvalServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
