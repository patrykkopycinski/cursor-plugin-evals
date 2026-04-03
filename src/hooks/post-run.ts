import { execSync } from 'node:child_process';
import type { PostRunHook, RunResult } from '../core/types.js';
import { log } from '../cli/logger.js';

interface RunSummary {
  runId: string;
  passRate: number;
  passed: number;
  failed: number;
  total: number;
  duration: number;
  timestamp: string;
}

function buildSummary(result: RunResult): RunSummary {
  return {
    runId: result.runId,
    passRate: Math.round(result.overall.passRate * 100),
    passed: result.overall.passed,
    failed: result.overall.failed,
    total: result.overall.total,
    duration: result.overall.duration,
    timestamp: result.timestamp,
  };
}

export function interpolateTemplate(template: string, summary: RunSummary): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in summary) {
      return String(summary[key as keyof RunSummary]);
    }
    return match;
  });
}

async function executeWebhookHook(
  hook: Extract<PostRunHook, { type: 'webhook' }>,
  result: RunResult,
  summary: RunSummary,
): Promise<void> {
  const body = hook.template
    ? interpolateTemplate(hook.template, summary)
    : JSON.stringify(summary);

  const headers: Record<string, string> = {
    'Content-Type': hook.template ? 'text/plain' : 'application/json',
    ...hook.headers,
  };

  const res = await fetch(hook.url, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    throw new Error(`Webhook returned HTTP ${res.status}: ${await res.text()}`);
  }
}

function executeScriptHook(
  hook: Extract<PostRunHook, { type: 'script' }>,
  result: RunResult,
  summary: RunSummary,
): void {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    RUN_ID: summary.runId,
    PASS_RATE: String(summary.passRate),
    PASSED: String(summary.passed),
    FAILED: String(summary.failed),
    TOTAL: String(summary.total),
  };

  if (hook.passEnv) {
    for (const key of hook.passEnv) {
      const val = process.env[key];
      if (val !== undefined) {
        env[key] = val;
      }
    }
  }

  execSync(hook.command, {
    env,
    input: JSON.stringify(summary),
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  });
}

export async function executePostRunHooks(
  hooks: PostRunHook[],
  result: RunResult,
): Promise<void> {
  const summary = buildSummary(result);

  for (const hook of hooks) {
    try {
      if (hook.type === 'webhook') {
        await executeWebhookHook(hook, result, summary);
        log.debug(`Post-run webhook to ${hook.url} succeeded`);
      } else {
        executeScriptHook(hook, result, summary);
        log.debug(`Post-run script "${hook.command}" succeeded`);
      }
    } catch (err) {
      const label = hook.type === 'webhook' ? `webhook ${hook.url}` : `script "${hook.command}"`;
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Post-run hook ${label} failed: ${message}`);
    }
  }
}
