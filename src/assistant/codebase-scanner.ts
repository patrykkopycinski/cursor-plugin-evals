import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, relative, basename, dirname } from 'node:path';
import { discoverPlugin } from '../plugin/discovery.js';
import type {
  Layer,
  PluginManifest,
  SkillComponent,
  McpToolDefinition,
  McpServerComponent,
} from '../core/types.js';
import type {
  CodebaseProfile,
  ProjectKind,
  ToolCoverage,
  EvalFileInfo,
  ConfigQualityIssue,
} from './types.js';

const ALL_LAYERS: Layer[] = ['unit', 'static', 'integration', 'llm', 'performance', 'skill'];

const ALL_EVALUATORS = [
  'tool-selection', 'tool-args', 'tool-sequence', 'response-quality',
  'cluster-state', 'mcp-protocol', 'security', 'tool-poisoning',
  'skill-trigger', 'content-quality', 'path-efficiency', 'correctness',
  'groundedness', 'g-eval', 'keywords', 'similarity',
  'context-faithfulness', 'conversation-coherence', 'criteria', 'rag',
  'plan-quality', 'task-completion', 'visual-regression', 'trajectory',
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findFiles(dir: string, pattern: RegExp, maxDepth = 5, depth = 0): Promise<string[]> {
  if (depth >= maxDepth) return [];
  const results: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    const s = await stat(full).catch(() => null);
    if (!s) continue;

    if (s.isDirectory()) {
      results.push(...await findFiles(full, pattern, maxDepth, depth + 1));
    } else if (pattern.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

function detectProjectKind(rootDir: string, manifest: PluginManifest | null): ProjectKind {
  if (manifest && (manifest.skills.length > 0 || manifest.mcpServers.length > 0)) {
    return 'cursor-plugin';
  }
  if (manifest && manifest.skills.length > 0 && manifest.mcpServers.length === 0) {
    return 'skill-repository';
  }
  return 'unknown';
}

/**
 * Scan TypeScript/JavaScript source files for MCP tool registrations.
 * Looks for patterns like:
 *   server.tool('tool_name', ...)
 *   registerTool('tool_name', ...)
 *   name: 'tool_name' (inside tool definitions)
 */
async function discoverMcpToolNames(rootDir: string, mcpServers: McpServerComponent[]): Promise<string[]> {
  const toolNames = new Set<string>();

  const searchDirs: string[] = [rootDir];
  for (const srv of mcpServers) {
    if (srv.args && srv.args.length > 0) {
      const entryPoint = srv.args[srv.args.length - 1];
      const srcDir = join(rootDir, dirname(entryPoint).replace('/dist/', '/src/').replace('/dist', '/src'));
      searchDirs.push(srcDir);

      const parentDir = dirname(srcDir);
      if (parentDir !== rootDir) {
        searchDirs.push(parentDir);
      }
    }
  }

  const toolRegex = /(?:server\.tool|registerTool)\s*\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_-]*)['"`]/g;

  for (const dir of new Set(searchDirs)) {
    const tsFiles = await findFiles(dir, /\.(ts|js)$/, 4);
    for (const file of tsFiles) {
      if (file.includes('.test.') || file.includes('.spec.') || file.includes('__tests__')) continue;
      try {
        const content = await readFile(file, 'utf-8');
        let match: RegExpExecArray | null;
        while ((match = toolRegex.exec(content)) !== null) {
          toolNames.add(match[1]);
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return [...toolNames].sort();
}

interface YamlSuiteStub {
  layer?: string;
  tests?: Array<{
    name?: string;
    tool?: string;
    prompt?: string;
    evaluators?: string[];
    difficulty?: string;
    expected?: { tools?: string[] };
    check?: string;
    expectError?: boolean;
  }>;
  examples?: Array<{
    input?: unknown;
    output?: unknown;
  }>;
  evaluators?: string[];
  adapters?: unknown[];
}

interface YamlEvalConfig {
  suites?: YamlSuiteStub[];
}

async function parseYamlFile(filePath: string): Promise<YamlSuiteStub | null> {
  try {
    const { parse } = await import('yaml');
    const raw = await readFile(filePath, 'utf-8');
    return parse(raw) as YamlSuiteStub;
  } catch {
    return null;
  }
}

async function scanEvalFiles(rootDir: string): Promise<EvalFileInfo[]> {
  const yamlFiles = await findFiles(rootDir, /^(plugin-eval|eval)\.ya?ml$/);
  const results: EvalFileInfo[] = [];

  for (const file of yamlFiles) {
    const parsed = await parseYamlFile(file);
    if (!parsed) continue;

    const evalConfig = parsed as unknown as YamlEvalConfig;

    if (evalConfig.suites && Array.isArray(evalConfig.suites)) {
      for (const suite of evalConfig.suites) {
        const tests = suite.tests ?? [];
        const tools = new Set<string>();
        const evaluators = new Set<string>();
        const difficulties = new Set<string>();

        if (suite.evaluators) {
          for (const e of suite.evaluators) evaluators.add(e);
        }

        for (const t of tests) {
          if (!t || typeof t !== 'object') continue;
          const test = t as Record<string, unknown>;
          if (test.tool) tools.add(String(test.tool));
          if (test.difficulty) difficulties.add(String(test.difficulty));
          if (test.expected && typeof test.expected === 'object') {
            const expected = test.expected as Record<string, unknown>;
            if (Array.isArray(expected.tools)) {
              for (const tool of expected.tools) tools.add(String(tool));
            }
          }
          if (Array.isArray(test.evaluators)) {
            for (const e of test.evaluators) evaluators.add(String(e));
          }
          if (test.expectedTools && Array.isArray(test.expectedTools)) {
            for (const tool of test.expectedTools) tools.add(String(tool));
          }
        }

        results.push({
          path: relative(rootDir, file),
          layer: suite.layer as Layer | undefined,
          testCount: tests.length,
          tools: [...tools],
          evaluators: [...evaluators],
          difficulties: [...difficulties],
        });
      }
    } else {
      const tests = parsed.tests ?? parsed.examples ?? [];
      const tools = new Set<string>();
      const evaluators = new Set<string>();
      const difficulties = new Set<string>();

      if (parsed.evaluators) {
        for (const e of parsed.evaluators) evaluators.add(e);
      }

      for (const t of tests) {
        if (!t || typeof t !== 'object') continue;
        const test = t as Record<string, unknown>;
        if (test.tool) tools.add(String(test.tool));
        if (test.difficulty) difficulties.add(String(test.difficulty));
        if (test.expected && typeof test.expected === 'object') {
          const expected = test.expected as Record<string, unknown>;
          if (Array.isArray(expected.tools)) {
            for (const tool of expected.tools) tools.add(String(tool));
          }
        }
        if (Array.isArray(test.evaluators)) {
          for (const e of test.evaluators) evaluators.add(String(e));
        }
      }

      results.push({
        path: relative(rootDir, file),
        layer: parsed.layer as Layer | undefined,
        testCount: tests.length,
        tools: [...tools],
        evaluators: [...evaluators],
        difficulties: [...difficulties],
      });
    }
  }

  return results;
}

function buildToolCoverage(evalFiles: EvalFileInfo[]): Map<string, ToolCoverage> {
  const coverage = new Map<string, ToolCoverage>();

  for (const ef of evalFiles) {
    for (const tool of ef.tools) {
      const existing = coverage.get(tool) ?? {
        tool,
        layers: [],
        evaluators: [],
        testCount: 0,
        difficulties: [],
        hasNegativeTests: false,
        hasErrorTests: false,
      };

      if (ef.layer && !existing.layers.includes(ef.layer)) {
        existing.layers.push(ef.layer);
      }
      for (const e of ef.evaluators) {
        if (!existing.evaluators.includes(e)) existing.evaluators.push(e);
      }
      for (const d of ef.difficulties) {
        if (!existing.difficulties.includes(d)) existing.difficulties.push(d);
      }
      existing.testCount += ef.testCount;
      coverage.set(tool, existing);
    }
  }

  return coverage;
}

function computeLayerCoverage(evalFiles: EvalFileInfo[]): Record<Layer, number> {
  const counts: Record<string, number> = {};
  for (const l of ALL_LAYERS) counts[l] = 0;

  for (const ef of evalFiles) {
    if (ef.layer && ef.layer in counts) {
      counts[ef.layer] += ef.testCount;
    }
  }

  return counts as Record<Layer, number>;
}

function checkConfigQuality(evalFiles: EvalFileInfo[], hasCI: boolean, hasCiThresholds: boolean): ConfigQualityIssue[] {
  const issues: ConfigQualityIssue[] = [];

  if (evalFiles.length === 0) {
    issues.push({
      severity: 'error',
      category: 'config',
      message: 'No evaluation config files found (plugin-eval.yaml or eval.yaml)',
      fix: 'Run `npx cursor-plugin-evals init` to generate a starter config',
    });
  }

  const allEvaluators = new Set<string>();
  for (const ef of evalFiles) {
    for (const e of ef.evaluators) allEvaluators.add(e);
  }

  if (!allEvaluators.has('security')) {
    issues.push({
      severity: 'warning',
      category: 'security',
      message: 'No security evaluator configured — plugin security is not being assessed',
      fix: 'Add "security" to evaluators in your test config',
    });
  }

  if (!allEvaluators.has('tool-selection') && !allEvaluators.has('tool-args')) {
    issues.push({
      severity: 'warning',
      category: 'evaluators',
      message: 'Missing tool-selection and tool-args evaluators — tool usage quality is not measured',
      fix: 'Add "tool-selection" and "tool-args" evaluators to LLM layer tests',
    });
  }

  if (!hasCI) {
    issues.push({
      severity: 'info',
      category: 'ci',
      message: 'No CI configuration found — evaluations are not enforced automatically',
      fix: 'Run `npx cursor-plugin-evals ci-init` to scaffold CI config',
    });
  }

  if (hasCI && !hasCiThresholds) {
    issues.push({
      severity: 'warning',
      category: 'ci',
      message: 'CI is configured but no quality thresholds are set',
      fix: 'Add a "ci" section with thresholds to your plugin-eval.yaml',
    });
  }

  const totalTests = evalFiles.reduce((sum, ef) => sum + ef.testCount, 0);
  if (totalTests > 0 && totalTests < 5) {
    issues.push({
      severity: 'info',
      category: 'coverage',
      message: `Only ${totalTests} tests found — consider adding more for comprehensive coverage`,
      fix: 'Run the eval-generator to auto-generate tests for uncovered tools',
    });
  }

  return issues;
}

export async function scanCodebase(rootDir: string): Promise<CodebaseProfile> {
  let manifest: PluginManifest | null = null;
  try {
    manifest = discoverPlugin(rootDir);
  } catch {
    manifest = null;
  }

  const projectKind = detectProjectKind(rootDir, manifest);
  const evalFiles = await scanEvalFiles(rootDir);
  const toolCoverage = buildToolCoverage(evalFiles);

  const mcpToolNames = await discoverMcpToolNames(rootDir, manifest?.mcpServers ?? []);
  const mcpTools: McpToolDefinition[] = mcpToolNames.map((name) => ({
    name,
    inputSchema: { type: 'object' },
  }));
  const layerCoverage = computeLayerCoverage(evalFiles);

  const evaluatorsUsed = [...new Set(evalFiles.flatMap((ef) => ef.evaluators))];

  const hasCI =
    (await exists(join(rootDir, '.github/workflows'))) ||
    (await exists(join(rootDir, '.buildkite')));

  let hasCiThresholds = false;
  const mainConfig = evalFiles.find((ef) => ef.path.includes('plugin-eval'));
  if (mainConfig) {
    try {
      const raw = await readFile(join(rootDir, mainConfig.path), 'utf-8');
      hasCiThresholds = raw.includes('ci:') && raw.includes('threshold');
    } catch {
      // ignore
    }
  }

  const hasFixtures = await exists(join(rootDir, '.cursor-plugin-evals', 'fixtures'));
  const hasFingerprints = await exists(join(rootDir, '.cursor-plugin-evals', 'fingerprints'));

  const configIssues = checkConfigQuality(evalFiles, hasCI, hasCiThresholds);

  return {
    projectKind,
    rootDir,
    manifest,
    skills: manifest?.skills ?? [],
    mcpTools,
    evalFiles,
    toolCoverage,
    layerCoverage,
    evaluatorsUsed,
    evaluatorsAvailable: ALL_EVALUATORS,
    configIssues,
    hasCI,
    hasCiThresholds,
    hasFixtures,
    hasFingerprints,
    scanTimestamp: new Date().toISOString(),
  };
}

export function formatCodebaseReport(profile: CodebaseProfile): string {
  const lines: string[] = [];

  lines.push('# Codebase Intelligence Report');
  lines.push('');
  lines.push(`**Project type:** ${profile.projectKind}`);
  lines.push(`**Root:** ${profile.rootDir}`);
  lines.push(`**Scanned:** ${profile.scanTimestamp}`);
  lines.push('');

  lines.push('## Plugin Components');
  lines.push(`- Skills: ${profile.skills.length}`);
  lines.push(`- MCP Tools: ${profile.mcpTools.length}`);
  if (profile.mcpTools.length > 0) {
    const toolList = profile.mcpTools.map((t) => t.name);
    const display = toolList.length <= 20
      ? toolList.join(', ')
      : `${toolList.slice(0, 20).join(', ')} (+${toolList.length - 20} more)`;
    lines.push(`  ${display}`);
  }
  if (profile.manifest) {
    if (profile.manifest.rules.length > 0) lines.push(`- Rules: ${profile.manifest.rules.length}`);
    if (profile.manifest.agents.length > 0) lines.push(`- Agents: ${profile.manifest.agents.length}`);
    if (profile.manifest.commands.length > 0) lines.push(`- Commands: ${profile.manifest.commands.length}`);
    if (profile.manifest.mcpServers.length > 0) lines.push(`- MCP Servers: ${profile.manifest.mcpServers.length}`);
  }
  lines.push('');

  lines.push('## Evaluation Coverage');
  lines.push(`- Eval files: ${profile.evalFiles.length}`);
  const totalTests = profile.evalFiles.reduce((s, e) => s + e.testCount, 0);
  lines.push(`- Total tests: ${totalTests}`);
  lines.push(`- Tools with tests: ${profile.toolCoverage.size}`);
  lines.push('');

  lines.push('### Layer Coverage');
  for (const [layer, count] of Object.entries(profile.layerCoverage)) {
    const icon = count > 0 ? '  ✓' : '  ✗';
    lines.push(`${icon} ${layer}: ${count} tests`);
  }
  lines.push('');

  lines.push('### Evaluator Usage');
  const used = profile.evaluatorsUsed.length;
  const available = profile.evaluatorsAvailable.length;
  lines.push(`Using ${used} of ${available} available evaluators (${Math.round((used / available) * 100)}%)`);

  const unused = profile.evaluatorsAvailable.filter((e) => !profile.evaluatorsUsed.includes(e));
  if (unused.length > 0 && unused.length <= 10) {
    lines.push(`Unused: ${unused.join(', ')}`);
  }
  lines.push('');

  lines.push('### Infrastructure');
  lines.push(`- CI configured: ${profile.hasCI ? 'Yes' : 'No'}`);
  lines.push(`- CI thresholds: ${profile.hasCiThresholds ? 'Yes' : 'No'}`);
  lines.push(`- Fixtures recorded: ${profile.hasFixtures ? 'Yes' : 'No'}`);
  lines.push(`- Regression baseline: ${profile.hasFingerprints ? 'Yes' : 'No'}`);
  lines.push('');

  if (profile.configIssues.length > 0) {
    lines.push('## Issues Found');
    for (const issue of profile.configIssues) {
      const icon = issue.severity === 'error' ? '!!!' : issue.severity === 'warning' ? '!!' : '!';
      lines.push(`- [${icon}] ${issue.message}`);
      if (issue.fix) lines.push(`  Fix: ${issue.fix}`);
    }
  }

  return lines.join('\n');
}
