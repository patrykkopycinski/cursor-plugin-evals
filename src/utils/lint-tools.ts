/**
 * Lint-tools: validate that SCRIPT_TO_TOOL mappings cover all scripts
 * in a given directory, and that no mappings point to non-existent scripts.
 *
 * Used as a CI check and CLI command to catch mapping drift.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { ScriptToolMapping } from './shell-command.js';

export interface LintToolsResult {
  unmappedScripts: string[];
  orphanedMappings: string[];
  validMappings: string[];
  totalScripts: number;
  totalMappings: number;
  pass: boolean;
}

export interface LintToolsOptions {
  scriptsDir: string;
  mapping: ScriptToolMapping;
  extensions?: string[];
  ignore?: string[];
}

export async function lintToolMappings(options: LintToolsOptions): Promise<LintToolsResult> {
  const { scriptsDir, mapping, extensions = ['.js', '.sh', '.ts'], ignore = [] } = options;

  const scriptFiles = await discoverScripts(scriptsDir, extensions, new Set(ignore));
  const mappingScripts = new Set(Object.keys(mapping));

  const unmappedScripts: string[] = [];
  for (const script of scriptFiles) {
    const scriptBase = basename(script);
    const hasMapping =
      mappingScripts.has(script) ||
      mappingScripts.has(scriptBase) ||
      [...mappingScripts].some((m) => script.includes(m) || m.includes(script));

    if (!hasMapping) {
      unmappedScripts.push(script);
    }
  }

  const orphanedMappings: string[] = [];
  const validMappings: string[] = [];
  for (const mappingKey of mappingScripts) {
    const found = scriptFiles.some(
      (s) => s.includes(mappingKey) || basename(s) === mappingKey || mappingKey.includes(basename(s)),
    );
    if (found) {
      validMappings.push(mappingKey);
    } else {
      orphanedMappings.push(mappingKey);
    }
  }

  return {
    unmappedScripts,
    orphanedMappings,
    validMappings,
    totalScripts: scriptFiles.length,
    totalMappings: mappingScripts.size,
    pass: unmappedScripts.length === 0 && orphanedMappings.length === 0,
  };
}

async function discoverScripts(
  dir: string,
  extensions: string[],
  ignore: Set<string>,
): Promise<string[]> {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (_e) {
    return results;
  }

  for (const entry of entries) {
    if (ignore.has(entry)) continue;
    const fullPath = join(dir, entry);

    const s = await stat(fullPath).catch(() => null);
    if (!s) continue;

    if (s.isDirectory()) {
      const nested = await discoverScripts(fullPath, extensions, ignore);
      results.push(...nested);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

export function formatLintToolsReport(result: LintToolsResult): string {
  const lines: string[] = [];

  lines.push(`Tool Mapping Lint Report`);
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`Scripts found: ${result.totalScripts}`);
  lines.push(`Mappings defined: ${result.totalMappings}`);
  lines.push(`Valid mappings: ${result.validMappings.length}`);
  lines.push('');

  if (result.unmappedScripts.length > 0) {
    lines.push(`⚠ Unmapped scripts (${result.unmappedScripts.length}):`);
    for (const s of result.unmappedScripts) {
      lines.push(`  - ${s}`);
    }
    lines.push('');
  }

  if (result.orphanedMappings.length > 0) {
    lines.push(`⚠ Orphaned mappings (${result.orphanedMappings.length}):`);
    for (const m of result.orphanedMappings) {
      lines.push(`  - ${m}`);
    }
    lines.push('');
  }

  if (result.pass) {
    lines.push(`✓ All scripts are mapped and all mappings are valid.`);
  } else {
    lines.push(`✗ Lint failed — fix unmapped scripts or orphaned mappings.`);
  }

  return lines.join('\n');
}
