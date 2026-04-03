import { readFile } from 'fs/promises';
import { join } from 'node:path';

export interface DependencyNode {
  name: string;
  version?: string;
  depth: number;
  hasKnownVulnerabilities: boolean;
  riskIndicators: string[];
}

export interface DependencyRiskIndicator {
  severity: 'critical' | 'high' | 'medium' | 'low';
  indicator: string;
  description: string;
  recommendation: string;
}

export interface DependencyAuditResult {
  totalDependencies: number;
  directDependencies: number;
  riskIndicators: DependencyRiskIndicator[];
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
}

interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const DANGEROUS_SCRIPTS = ['preinstall', 'postinstall', 'preuninstall', 'postuninstall'];
const NATIVE_BUILD_MARKERS = ['node-gyp', 'node-pre-gyp', 'prebuild-install', 'cmake-js'];
const TYPOSQUAT_TARGETS = [
  'lodash',
  'express',
  'react',
  'axios',
  'chalk',
  'commander',
  'request',
  'webpack',
  'babel',
  'eslint',
  'typescript',
  'jquery',
  'moment',
  'underscore',
  'bluebird',
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

function detectTyposquatting(depName: string): string | null {
  if (TYPOSQUAT_TARGETS.includes(depName)) return null;

  const bare = depName.startsWith('@') ? depName.split('/').pop() ?? depName : depName;

  for (const target of TYPOSQUAT_TARGETS) {
    if (bare === target) continue;
    const dist = levenshtein(bare, target);
    if (dist > 0 && dist <= 2) {
      return target;
    }
  }

  return null;
}

function checkScripts(pkg: PackageJson): DependencyRiskIndicator[] {
  const indicators: DependencyRiskIndicator[] = [];
  if (!pkg.scripts) return indicators;

  for (const scriptName of DANGEROUS_SCRIPTS) {
    const scriptBody = pkg.scripts[scriptName];
    if (!scriptBody) continue;

    indicators.push({
      severity: 'high',
      indicator: 'lifecycle-script',
      description: `Package has a "${scriptName}" script: ${scriptBody.slice(0, 100)}`,
      recommendation: 'Review the script for malicious behavior. Consider using --ignore-scripts.',
    });
  }

  return indicators;
}

function checkDependencyCounts(deps: Record<string, string>): DependencyRiskIndicator[] {
  const indicators: DependencyRiskIndicator[] = [];
  const count = Object.keys(deps).length;

  if (count > 100) {
    indicators.push({
      severity: 'high',
      indicator: 'excessive-dependencies',
      description: `${count} direct dependencies is unusually high`,
      recommendation: 'Audit dependencies for unused packages. Consider reducing the dependency footprint.',
    });
  } else if (count > 50) {
    indicators.push({
      severity: 'medium',
      indicator: 'many-dependencies',
      description: `${count} direct dependencies — review for opportunities to reduce`,
      recommendation: 'Run a dependency analysis to identify unused or replaceable packages.',
    });
  }

  return indicators;
}

function checkNativeBuild(deps: Record<string, string>): DependencyRiskIndicator[] {
  const indicators: DependencyRiskIndicator[] = [];

  for (const dep of Object.keys(deps)) {
    if (NATIVE_BUILD_MARKERS.some((m) => dep.includes(m))) {
      indicators.push({
        severity: 'medium',
        indicator: 'native-compilation',
        description: `"${dep}" requires native compilation`,
        recommendation: 'Native modules increase supply chain attack surface. Verify the package is well-maintained.',
      });
    }
  }

  return indicators;
}

function checkRegistryOrigins(deps: Record<string, string>): DependencyRiskIndicator[] {
  const indicators: DependencyRiskIndicator[] = [];

  for (const [name, version] of Object.entries(deps)) {
    if (
      version.startsWith('git') ||
      version.startsWith('http') ||
      version.startsWith('github:') ||
      version.includes('://')
    ) {
      indicators.push({
        severity: 'high',
        indicator: 'non-registry-source',
        description: `"${name}" is installed from a non-registry source: ${version}`,
        recommendation: 'Use packages from the npm registry. Non-registry sources bypass npm audit and verification.',
      });
    }
  }

  return indicators;
}

function checkTyposquatting(deps: Record<string, string>): DependencyRiskIndicator[] {
  const indicators: DependencyRiskIndicator[] = [];

  for (const dep of Object.keys(deps)) {
    const target = detectTyposquatting(dep);
    if (target) {
      indicators.push({
        severity: 'critical',
        indicator: 'typosquatting-suspect',
        description: `"${dep}" is suspiciously similar to popular package "${target}"`,
        recommendation: `Verify this is the intended package. Typosquatting is a common supply chain attack vector.`,
      });
    }
  }

  return indicators;
}

function classifyOverallRisk(
  indicators: DependencyRiskIndicator[],
): 'low' | 'medium' | 'high' | 'critical' {
  if (indicators.some((i) => i.severity === 'critical')) return 'critical';
  if (indicators.filter((i) => i.severity === 'high').length >= 2) return 'high';
  if (indicators.some((i) => i.severity === 'high')) return 'medium';
  if (indicators.some((i) => i.severity === 'medium')) return 'medium';
  return 'low';
}

export async function auditPluginDependencies(pluginDir: string): Promise<DependencyAuditResult> {
  let raw: string;
  try {
    raw = await readFile(join(pluginDir, 'package.json'), 'utf-8');
  } catch (_e) {
    return {
      totalDependencies: 0,
      directDependencies: 0,
      riskIndicators: [],
      overallRisk: 'low',
    };
  }

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(raw) as PackageJson;
  } catch (_e) {
    return {
      totalDependencies: 0,
      directDependencies: 0,
      riskIndicators: [
        {
          severity: 'high',
          indicator: 'invalid-package-json',
          description: 'package.json is not valid JSON',
          recommendation: 'Fix the package.json syntax.',
        },
      ],
      overallRisk: 'high',
    };
  }

  const deps = pkg.dependencies ?? {};
  const devDeps = pkg.devDependencies ?? {};
  const allDeps = { ...deps, ...devDeps };
  const directCount = Object.keys(deps).length;
  const totalCount = Object.keys(allDeps).length;

  const indicators: DependencyRiskIndicator[] = [
    ...checkScripts(pkg),
    ...checkDependencyCounts(deps),
    ...checkNativeBuild(allDeps),
    ...checkRegistryOrigins(allDeps),
    ...checkTyposquatting(allDeps),
  ];

  return {
    totalDependencies: totalCount,
    directDependencies: directCount,
    riskIndicators: indicators,
    overallRisk: classifyOverallRisk(indicators),
  };
}

export function formatDependencyAuditReport(result: DependencyAuditResult): string {
  const lines: string[] = ['# Dependency Audit Report\n'];

  lines.push(`**Overall Risk:** ${result.overallRisk.toUpperCase()}`);
  lines.push(
    `**Dependencies:** ${result.directDependencies} direct, ${result.totalDependencies} total\n`,
  );

  if (result.riskIndicators.length === 0) {
    lines.push('No risk indicators found.\n');
    return lines.join('\n');
  }

  lines.push(`## Risk Indicators (${result.riskIndicators.length})\n`);

  for (const indicator of result.riskIndicators) {
    lines.push(`### [${indicator.severity.toUpperCase()}] ${indicator.indicator}\n`);
    lines.push(indicator.description);
    lines.push(`\n**Recommendation:** ${indicator.recommendation}\n`);
  }

  return lines.join('\n');
}
