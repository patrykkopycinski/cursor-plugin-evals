import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative, join, basename, dirname } from 'path';
import { stringify as yamlStringify } from 'yaml';
import { discoverPlugin } from '../plugin/discovery.js';
import { log } from './logger.js';
import type { PluginManifest } from '../core/types.js';

export interface ExternalInitOptions {
  external: string;
  scope?: string;
  output?: string;
  layers?: string[];
  transport?: string;
  pluginRoot?: string;
}

export interface ApplyFixesOptions {
  workspace: string;
  target?: string;
  dryRun?: boolean;
}

export interface PrFindingsOptions {
  workspace: string;
  title?: string;
  includeScores?: boolean;
}

interface WorkspaceMeta {
  externalDir: string;
  scope?: string;
  pluginName: string;
  createdAt: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function detectPluginEntry(pluginDir: string): string | undefined {
  const mcpJsonPath = join(pluginDir, 'mcp.json');
  const dotMcpJsonPath = join(pluginDir, '.mcp.json');
  const configPath = existsSync(mcpJsonPath) ? mcpJsonPath : existsSync(dotMcpJsonPath) ? dotMcpJsonPath : null;

  if (!configPath) return undefined;

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    const servers = raw.mcpServers ?? raw;
    const first = Object.values(servers)[0] as { command?: string; args?: string[] } | undefined;
    if (first?.command && first?.args) {
      return `${first.command} ${first.args.join(' ')}`;
    }
  } catch (err) {
    console.warn(`Failed to parse MCP config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return undefined;
}

export async function externalInitCommand(opts: ExternalInitOptions): Promise<void> {
  log.header('External Init — Create evaluation workspace');

  const externalDir = resolve(opts.external);
  if (!existsSync(externalDir)) {
    log.error(`External directory not found: ${externalDir}`);
    process.exitCode = 2;
    return;
  }

  const scopedDir = opts.scope ? resolve(externalDir, opts.scope) : externalDir;
  if (opts.scope && !existsSync(scopedDir)) {
    log.error(`Scope directory not found: ${scopedDir}`);
    process.exitCode = 2;
    return;
  }

  let manifest: PluginManifest;
  try {
    manifest = discoverPlugin(externalDir, opts.pluginRoot);
    log.success(`Discovered plugin: ${manifest.name}`);
  } catch (err) {
    console.warn(`Plugin discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    manifest = {
      name: basename(externalDir),
      dir: externalDir,
      skills: [],
      rules: [],
      agents: [],
      commands: [],
      hooks: [],
      mcpServers: [],
    };
    log.warn(`No plugin manifest found — using directory name: ${manifest.name}`);
  }

  const scopeSlug = opts.scope ? `-${slugify(opts.scope)}` : '';
  const workspaceName = `${slugify(manifest.name)}${scopeSlug}`;

  const wsDir = opts.output
    ? resolve(opts.output)
    : resolve(process.cwd(), 'workspaces', workspaceName);

  mkdirSync(wsDir, { recursive: true });
  mkdirSync(join(wsDir, 'eval-results'), { recursive: true });

  const meta: WorkspaceMeta = {
    externalDir,
    scope: opts.scope,
    pluginName: manifest.name,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(wsDir, 'workspace.json'), JSON.stringify(meta, null, 2), 'utf-8');

  const entry = detectPluginEntry(externalDir);

  const pluginConfig: Record<string, unknown> = {
    name: manifest.name,
    dir: externalDir,
  };
  if (entry) pluginConfig.entry = entry;
  if (opts.pluginRoot) pluginConfig.plugin_root = opts.pluginRoot;

  const transport = opts.transport ?? 'stdio';
  if (transport !== 'stdio') {
    pluginConfig.transport = transport;
    if (transport === 'http' || transport === 'sse' || transport === 'streamable-http') {
      pluginConfig.url = 'http://localhost:3000/mcp';
    }
  }

  const layers = new Set(opts.layers ?? ['static', 'unit', 'integration', 'llm', 'skill']);
  const suites: Record<string, unknown>[] = [];

  if (layers.has('static')) {
    suites.push({
      name: 'static-analysis',
      layer: 'static',
      tests: [
        { name: 'manifest', check: 'manifest' },
        { name: 'skill-frontmatter', check: 'skill_frontmatter' },
        { name: 'rule-frontmatter', check: 'rule_frontmatter' },
        { name: 'mcp-config', check: 'mcp_config' },
        { name: 'cross-component-coherence', check: 'cross_component_coherence' },
        { name: 'naming-conventions', check: 'naming_conventions' },
      ],
    });
  }

  if (layers.has('skill') && manifest.skills.length > 0) {
    const skillScope = opts.scope ?? '';
    const scopedSkills = skillScope
      ? manifest.skills.filter((s) => s.path && s.path.includes(skillScope))
      : manifest.skills;

    if (scopedSkills.length > 0) {
      suites.push({
        name: `skill-activation${scopeSlug}`,
        layer: 'llm',
        defaults: { evaluators: ['skill-trigger', 'content-quality', 'correctness'] },
        tests: scopedSkills.map((skill) => ({
          name: `activate-${slugify(skill.name)}`,
          difficulty: 'moderate',
          prompt: `Help me with ${skill.description || skill.name}`,
          expected: { skill: skill.name },
        })),
      });
    }
  }

  const config = {
    plugin: pluginConfig,
    defaults: {
      timeout: 30000,
      repetitions: 3,
      judge_model: 'gpt-5.2',
      thresholds: {
        'tool-selection': 0.8,
        'content-quality': 0.7,
        correctness: 0.7,
      },
    },
    suites,
  };

  const evalYamlPath = join(wsDir, 'plugin-eval.yaml');
  writeFileSync(evalYamlPath, yamlStringify(config, { lineWidth: 120 }), 'utf-8');

  writeFileSync(
    join(wsDir, '.gitignore'),
    ['eval-results/', 'node_modules/', '.env.local', ''].join('\n'),
    'utf-8',
  );

  log.success(`Workspace created: ${wsDir}`);
  log.info(`  Config:    ${evalYamlPath}`);
  log.info(`  Results:   ${join(wsDir, 'eval-results/')}`);
  log.info(`  Target:    ${externalDir}`);
  if (opts.scope) log.info(`  Scope:     ${opts.scope}`);
  log.info('');
  log.info('Next steps:');
  log.info(`  1. Run evals:     npx cursor-plugin-evals run -c ${relative(process.cwd(), evalYamlPath)}`);
  log.info(`  2. View findings: npx cursor-plugin-evals report --workspace ${relative(process.cwd(), wsDir)} --format pr-findings`);
  log.info(`  3. Apply fixes:   npx cursor-plugin-evals apply-fixes --workspace ${relative(process.cwd(), wsDir)}`);
}

export function loadWorkspaceMeta(wsDir: string): WorkspaceMeta {
  const metaPath = join(wsDir, 'workspace.json');
  if (!existsSync(metaPath)) {
    throw new Error(`Not a valid workspace: ${wsDir} (missing workspace.json)`);
  }
  return JSON.parse(readFileSync(metaPath, 'utf-8'));
}

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  function walk(d: string): void {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === '.git') continue;
        walk(full);
      } else if (extensions.some((ext) => entry.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

export async function applyFixesCommand(opts: ApplyFixesOptions): Promise<void> {
  log.header('Apply Fixes — Copy skill/rule improvements to target repo');

  const wsDir = resolve(opts.workspace);
  const meta = loadWorkspaceMeta(wsDir);
  const targetDir = opts.target ? resolve(opts.target) : meta.externalDir;

  if (!existsSync(targetDir)) {
    log.error(`Target directory not found: ${targetDir}`);
    process.exitCode = 2;
    return;
  }

  const contentExtensions = ['.md', '.mdc', '.markdown', '.yaml', '.yml'];
  const scopedDir = meta.scope ? resolve(targetDir, meta.scope) : targetDir;

  const allFiles = collectFiles(scopedDir, contentExtensions);

  if (allFiles.length === 0) {
    log.warn('No content files found in the target to check for changes.');
    return;
  }

  let changedCount = 0;

  for (const file of allFiles) {
    const relPath = relative(targetDir, file);
    const currentContent = readFileSync(file, 'utf-8');

    const wsOverridePath = join(wsDir, 'fixes', relPath);
    if (existsSync(wsOverridePath)) {
      const fixContent = readFileSync(wsOverridePath, 'utf-8');
      if (fixContent !== currentContent) {
        if (opts.dryRun) {
          log.info(`  [dry-run] Would update: ${relPath}`);
        } else {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, fixContent, 'utf-8');
          log.success(`  Updated: ${relPath}`);
        }
        changedCount++;
      }
    }
  }

  if (changedCount === 0) {
    log.info('No fixes to apply. To generate fixes, save improved files under:');
    log.info(`  ${join(wsDir, 'fixes/')}`);
    log.info('  using the same relative paths as the target repo.');
    log.info('');
    log.info('Alternatively, the Framework Assistant will populate this directory');
    log.info('automatically when running in external workspace mode.');
  } else {
    const verb = opts.dryRun ? 'would be applied' : 'applied';
    log.success(`${changedCount} fix(es) ${verb} to ${targetDir}`);
  }
}

export function generatePrFindings(wsDir: string, _opts: PrFindingsOptions): string {
  const meta = loadWorkspaceMeta(wsDir);
  const sections: string[] = [];

  sections.push(`## Evaluation Findings: ${meta.pluginName}${meta.scope ? ` (${meta.scope})` : ''}\n`);
  sections.push(`Evaluated with [cursor-plugin-evals](https://github.com/patrykkopycinski/cursor-plugin-evals) on ${new Date().toISOString().split('T')[0]}.\n`);

  const resultsDir = join(wsDir, 'eval-results');
  const resultFiles = existsSync(resultsDir)
    ? readdirSync(resultsDir).filter((f) => f.endsWith('.json')).sort().reverse()
    : [];

  if (resultFiles.length > 0) {
    const latestPath = join(resultsDir, resultFiles[0]);
    try {
      const result = JSON.parse(readFileSync(latestPath, 'utf-8'));

      sections.push('### Summary\n');
      sections.push(`| Metric | Value |`);
      sections.push(`|--------|-------|`);
      sections.push(`| Total tests | ${result.overall?.total ?? '—'} |`);
      sections.push(`| Passed | ${result.overall?.passed ?? '—'} |`);
      sections.push(`| Failed | ${result.overall?.failed ?? '—'} |`);
      sections.push(
        `| Pass rate | ${result.overall?.passRate != null ? (result.overall.passRate * 100).toFixed(1) + '%' : '—'} |`,
      );
      if (result.qualityScore) {
        sections.push(
          `| Quality grade | ${result.qualityScore.grade} (${(result.qualityScore.composite * 100).toFixed(1)}%) |`,
        );
      }
      sections.push('');

      if (result.suites && Array.isArray(result.suites)) {
        sections.push('### Results by Suite\n');
        sections.push('| Suite | Layer | Pass Rate | Tests |');
        sections.push('|-------|-------|----------:|------:|');
        for (const suite of result.suites) {
          const rate = suite.passRate != null ? (suite.passRate * 100).toFixed(1) + '%' : '—';
          sections.push(`| ${suite.name} | ${suite.layer} | ${rate} | ${suite.tests?.length ?? 0} |`);
        }
        sections.push('');

        const failures = result.suites.flatMap((s: { tests?: Array<{ pass?: boolean; name?: string; suite?: string; error?: string; evaluatorResults?: Array<{ evaluator: string; score: number; pass: boolean; explanation?: string }> }> }) =>
          (s.tests ?? []).filter((t: { pass?: boolean }) => !t.pass),
        );

        if (failures.length > 0) {
          sections.push('### Issues Found\n');
          for (const test of failures) {
            sections.push(`#### ${test.suite ? `${test.suite} > ` : ''}${test.name}\n`);
            if (test.error) {
              sections.push('```');
              sections.push(test.error);
              sections.push('```\n');
            }
            const failedEvals = (test.evaluatorResults ?? []).filter(
              (e: { pass: boolean }) => !e.pass,
            );
            if (failedEvals.length > 0) {
              sections.push('| Evaluator | Score | Issue |');
              sections.push('|-----------|------:|-------|');
              for (const ev of failedEvals) {
                sections.push(`| ${ev.evaluator} | ${ev.score.toFixed(2)} | ${ev.explanation ?? '—'} |`);
              }
              sections.push('');
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Failed to parse results file: ${err instanceof Error ? err.message : String(err)}`);
      sections.push('> Results file could not be parsed.\n');
    }
  } else {
    sections.push('> No evaluation results found yet. Run evals first:\n');
    sections.push('> ```bash');
    sections.push(`> npx cursor-plugin-evals run -c ${join(wsDir, 'plugin-eval.yaml')}`);
    sections.push('> ```\n');
  }

  const fixesDir = join(wsDir, 'fixes');
  if (existsSync(fixesDir)) {
    const fixFiles = collectFiles(fixesDir, ['.md', '.mdc', '.markdown']);
    if (fixFiles.length > 0) {
      sections.push('### Improvements Applied\n');
      for (const f of fixFiles) {
        sections.push(`- \`${relative(fixesDir, f)}\``);
      }
      sections.push('');
    }
  }

  sections.push('---');
  sections.push('*Generated by [cursor-plugin-evals](https://github.com/patrykkopycinski/cursor-plugin-evals)*\n');

  return sections.join('\n');
}
