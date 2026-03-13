import type { SensitivityResult } from './analyzer.js';

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : ' '.repeat(len - str.length) + str;
}

export function formatSensitivityReport(results: SensitivityResult[], threshold: number): string {
  if (results.length === 0) {
    return 'No prompt sensitivity results to display.';
  }

  const lines: string[] = [];
  const divider = '─'.repeat(90);

  lines.push('');
  lines.push('  Prompt Sensitivity Analysis');
  lines.push(`  Threshold: ${threshold}`);
  lines.push(divider);

  const header = [
    padRight('Test', 30),
    padLeft('Variance', 10),
    padLeft('Variants', 10),
    padLeft('Status', 10),
  ].join('  ');
  lines.push(header);
  lines.push(divider);

  for (const result of results) {
    const status = result.isFragile ? 'FRAGILE' : 'STABLE';
    const statusDisplay = result.isFragile ? `⚠ ${status}` : `✓ ${status}`;

    const row = [
      padRight(result.testName, 30),
      padLeft(result.variance.toFixed(4), 10),
      padLeft(String(result.variants.length), 10),
      padLeft(statusDisplay, 10),
    ].join('  ');
    lines.push(row);
  }

  lines.push(divider);

  const fragileCount = results.filter((r) => r.isFragile).length;
  const stableCount = results.length - fragileCount;

  lines.push(`  ${stableCount} stable, ${fragileCount} fragile out of ${results.length} test(s)`);

  if (fragileCount > 0) {
    lines.push('');
    lines.push('  Fragile tests (high variance across prompt rephrasings):');
    for (const result of results.filter((r) => r.isFragile)) {
      lines.push(`    ${result.testName}: variance=${result.variance.toFixed(4)}`);
      for (const variant of result.variants) {
        const avgScore =
          Object.values(variant.scores).length > 0
            ? (
                Object.values(variant.scores).reduce((a, b) => a + b, 0) /
                Object.values(variant.scores).length
              ).toFixed(3)
            : 'N/A';
        const promptPreview =
          variant.prompt.length > 50 ? variant.prompt.slice(0, 47) + '...' : variant.prompt;
        lines.push(`      "${promptPreview}" → avg: ${avgScore}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}
