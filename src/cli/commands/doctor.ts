import type { Command } from 'commander';
import { log, setLogLevel, setNoColor } from '../logger.js';

export async function doctorCommand(opts: { verbose?: boolean; noColor?: boolean }): Promise<void> {
  if (opts.noColor) setNoColor(true);
  if (opts.verbose) setLogLevel('debug');

  log.header('Doctor — Diagnostics');

  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];

  // Docker check
  try {
    const { execSync } = await import('child_process');
    execSync('docker info', { stdio: 'pipe', timeout: 10_000 });
    checks.push({ label: 'Docker', ok: true, detail: 'Running' });
  } catch (_e) {
    checks.push({ label: 'Docker', ok: false, detail: 'Not running or not installed' });
  }

  // docker-compose check
  try {
    const { execSync } = await import('child_process');
    execSync('docker compose version', { stdio: 'pipe', timeout: 5_000 });
    checks.push({ label: 'Docker Compose', ok: true, detail: 'Available' });
  } catch (_e) {
    checks.push({ label: 'Docker Compose', ok: false, detail: 'Not available' });
  }

  // Node version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    label: 'Node.js',
    ok: major >= 20,
    detail: `${nodeVersion}${major < 20 ? ' (requires >= 20)' : ''}`,
  });

  // API key checks
  const apiKeys = [
    { name: 'OPENAI_API_KEY', label: 'OpenAI API Key' },
    { name: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key' },
    { name: 'AZURE_OPENAI_API_KEY', label: 'Azure OpenAI API Key' },
    { name: 'ES_API_KEY', label: 'Elasticsearch API Key' },
  ];
  for (const key of apiKeys) {
    const present = !!process.env[key.name];
    checks.push({
      label: key.label,
      ok: present,
      detail: present ? 'Set' : `${key.name} not set`,
    });
  }

  for (const check of checks) {
    if (check.ok) {
      log.success(`${check.label}: ${check.detail}`);
    } else {
      log.warn(`${check.label}: ${check.detail}`);
    }
  }

  const failures = checks.filter((c) => !c.ok);
  console.log();
  if (failures.length === 0) {
    log.success('All checks passed');
  } else {
    log.warn(`${failures.length} issue(s) found`);
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check environment and dependencies')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(doctorCommand);
}
