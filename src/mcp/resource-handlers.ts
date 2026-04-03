import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../core/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const RESOURCE_DEFINITIONS = [
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
  {
    uri: 'eval://quickstart',
    name: 'Agent Quickstart Guide',
    description: 'Step-by-step guide for agents to evaluate a Cursor plugin from scratch',
    mimeType: 'text/markdown',
  },
  {
    uri: 'eval://evaluators',
    name: 'Evaluator Catalog',
    description: 'All available evaluators with config options and scoring formulas',
    mimeType: 'text/markdown',
  },
];

export async function handleResourceRead(
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
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
        const dbPath = resolve(process.cwd(), DATA_DIR, 'dashboard.db');
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
        const dbPath = resolve(process.cwd(), DATA_DIR, 'dashboard.db');
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

    case 'eval://quickstart': {
      const guide = `# Agent Quickstart: Evaluating a Cursor Plugin

## Step 1 — Discover the plugin
Call \`discover_plugin\` with \`{ dir: "." }\` to find all skills, rules, agents, commands, and MCP servers.

## Step 2 — Check prerequisites
Call \`doctor\` to verify Node.js, Docker, and API keys are available.

## Step 3 — Validate config (if exists)
Call \`load_config\` to parse plugin-eval.yaml. If no config exists, skip to Step 4.

## Step 4 — Detect coverage gaps
Call \`detect_gaps\` with \`{ plugin_dir: "." }\` to find what's missing.

## Step 5 — Generate fixes
Call \`generate_fixes\` with \`{ plugin_dir: "." }\` to auto-generate YAML tests.

## Step 6 — Run evaluations
Call \`run_evals\` with \`{ ci: true }\` to run all suites with CI threshold enforcement.

## Step 7 — Analyze results
Call \`list_runs\` then \`get_run_detail\` with the latest run ID.
Or read the \`eval://latest-run\` resource directly.

## Step 8 — Iterate
For failures: read test details, fix config or plugin, re-run.
For regressions: call \`regression_check\` against a known-good baseline.

## Available Tools (17)
| Tool | Purpose |
|------|---------|
| discover_plugin | Find all plugin components |
| doctor | Check environment prerequisites |
| load_config | Parse and validate config |
| audit_coverage | Coverage matrix with gaps |
| detect_gaps | Missing tests with severity |
| generate_fixes | Auto-generate test YAML |
| run_evals | Execute evaluation suites |
| list_runs | Browse run history |
| get_run_detail | Inspect a specific run |
| analyze_collisions | Detect skill overlaps |
| security_audit | 3-pass security audit |
| regression_check | Statistical regression detection |
| compare_models | Multi-model comparison |
| evaluate_trace | Score OTel traces without re-execution |
| harvest_traces | Harvest failed traces as regression tests |
| deploy_dashboard | Deploy Kibana eval dashboard |
| cost_report | Token usage optimization |

## Available Resources (6)
| URI | Content |
|-----|---------|
| eval://config | Current parsed config |
| eval://latest-run | Most recent run result |
| eval://coverage | Coverage matrix |
| eval://history | Last 50 runs |
| eval://quickstart | This guide |
| eval://evaluators | All evaluator configs |
`;
      return {
        contents: [{ uri, mimeType: 'text/markdown', text: guide }],
      };
    }

    case 'eval://evaluators': {
      try {
        const { readFileSync } = await import('fs');
        const catalogPath = resolve(__dirname, '../../.cursor-plugin/references/evaluator-catalog.md');
        try {
          const content = readFileSync(catalogPath, 'utf-8');
          return {
            contents: [{ uri, mimeType: 'text/markdown', text: content }],
          };
        } catch (_e) {
          const fallback = `# Evaluator Catalog

Available evaluators: keywords, regex, json-schema, response-contains,
response-not-contains, tool-use, correctness (LLM judge), content-quality
(LLM judge), security (LLM judge), schema-compliance, frontmatter,
component-references, naming-conventions, mcp-protocol, tool-poisoning,
response-time, latency-p95, code-quality, relevance.

Use \`load_config\` to see which evaluators are configured for each test suite.
`;
          return {
            contents: [{ uri, mimeType: 'text/markdown', text: fallback }],
          };
        }
      } catch (err) {
        return {
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text: `Error loading evaluator catalog: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}
