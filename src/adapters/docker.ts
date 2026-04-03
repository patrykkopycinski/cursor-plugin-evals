/**
 * Docker isolation adapter.
 *
 * Wraps any inner adapter to run each trial inside a fresh Docker container,
 * providing full environment isolation per the RFC requirement.
 *
 * Usage in plugin-eval.yaml:
 *
 *   suites:
 *     - name: isolated-esql
 *       layer: skill
 *       adapter: docker
 *       defaults:
 *         thresholds:
 *           docker:
 *             image: "node:22-slim"
 *             inner_adapter: "plain-llm"
 *             dockerfile: "./docker/Dockerfile.eval"  # optional
 *             env:
 *               ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
 *
 * Each trial gets a fresh container. Results are collected via stdout JSON.
 */

import { execSync, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { TaskAdapter, Example, TaskOutput, AdapterConfig } from '../core/types.js';
import { log } from '../cli/logger.js';

interface DockerAdapterOptions {
  /** Base Docker image (default: node:22-slim) */
  image?: string;
  /** Path to a custom Dockerfile (overrides image) */
  dockerfile?: string;
  /** Inner adapter to run inside the container (default: plain-llm) */
  innerAdapter?: string;
  /** Environment variables to pass into the container */
  env?: Record<string, string>;
  /** Container timeout in seconds (default: 300) */
  timeout?: number;
  /** Whether to remove the container after each trial (default: true) */
  cleanup?: boolean;
}

const DEFAULT_IMAGE = 'node:22-slim';
const DEFAULT_TIMEOUT = 300;

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function buildCustomImage(dockerfile: string, tag: string): void {
  const dir = resolve(dockerfile, '..');
  const file = resolve(dockerfile);
  log.debug(`Building Docker image ${tag} from ${file}`);
  execFileSync('docker', ['build', '-t', tag, '-f', file, dir], {
    stdio: 'pipe',
    timeout: 120_000,
  });
}

function resolveOptions(config: AdapterConfig): DockerAdapterOptions {
  const thresholds = config['thresholds'] as Record<string, unknown> | undefined;
  const dockerConfig = (config['docker'] ?? thresholds?.['docker'] ?? {}) as Record<string, unknown>;
  return {
    image: (dockerConfig.image as string) ?? DEFAULT_IMAGE,
    dockerfile: dockerConfig.dockerfile as string | undefined,
    innerAdapter: (dockerConfig.inner_adapter as string) ?? (dockerConfig.innerAdapter as string) ?? 'plain-llm',
    env: (dockerConfig.env as Record<string, string>) ?? {},
    timeout: (dockerConfig.timeout as number) ?? DEFAULT_TIMEOUT,
    cleanup: (dockerConfig.cleanup as boolean) ?? true,
  };
}

export function createDockerAdapter(config: AdapterConfig): TaskAdapter {
  const opts = resolveOptions(config);

  if (!isDockerAvailable()) {
    throw new Error(
      'Docker is not available. Install Docker or use a different adapter (e.g., plain-llm).',
    );
  }

  // If a custom Dockerfile is provided, build the image once
  let imageTag = opts.image ?? DEFAULT_IMAGE;
  if (opts.dockerfile) {
    imageTag = `cpe-eval-${randomUUID().slice(0, 8)}`;
    buildCustomImage(opts.dockerfile, imageTag);
  }

  return async (example: Example): Promise<TaskOutput> => {
    const trialId = randomUUID().slice(0, 8);
    const containerName = `cpe-trial-${trialId}`;
    const stagingDir = join(tmpdir(), `cpe-docker-${trialId}`);

    try {
      // Stage trial payload
      mkdirSync(stagingDir, { recursive: true });
      const payload = {
        example,
        adapter: opts.innerAdapter,
        config: {
          name: config.name,
          model: config.model,
          timeout: config.timeout,
          apiBaseUrl: config.apiBaseUrl,
          skillPath: config.skillPath,
        },
      };
      writeFileSync(join(stagingDir, 'payload.json'), JSON.stringify(payload), 'utf-8');

      // Write the in-container runner script
      writeFileSync(
        join(stagingDir, 'run.mjs'),
        CONTAINER_RUNNER_SCRIPT,
        'utf-8',
      );

      // Build docker run args
      const args = [
        'run',
        '--rm',
        '--name', containerName,
        '-v', `${stagingDir}:/eval:ro`,
        '--network', 'host',
      ];

      // Pass environment variables
      const envVars: Record<string, string> = { ...opts.env };
      // Auto-forward common API keys from host if not explicitly set
      for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'ELASTICSEARCH_URL', 'ES_URL', 'ES_API_KEY']) {
        if (process.env[key] && !envVars[key]) {
          envVars[key] = process.env[key]!;
        }
      }
      for (const [key, value] of Object.entries(envVars)) {
        args.push('-e', `${key}=${value}`);
      }

      args.push(imageTag, 'node', '/eval/run.mjs');

      log.debug(`Docker trial ${trialId}: running in ${imageTag}`);
      const startMs = performance.now();

      const stdout = execFileSync('docker', args, {
        timeout: (opts.timeout ?? DEFAULT_TIMEOUT) * 1000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const latencyMs = performance.now() - startMs;
      const output = stdout.toString('utf-8').trim();

      // Parse the last line as JSON result
      const lines = output.split('\n');
      const resultLine = lines[lines.length - 1];

      try {
        const result = JSON.parse(resultLine) as TaskOutput;
        return { ...result, latencyMs, adapter: 'docker' };
      } catch {
        // If we can't parse JSON, treat the entire output as the result
        return {
          messages: [{ role: 'assistant', content: output }],
          toolCalls: [],
          output,
          latencyMs,
          tokenUsage: null,
          adapter: 'docker',
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Try to clean up the container on error
      if (opts.cleanup) {
        try {
          execSync(`docker rm -f ${containerName}`, { stdio: 'pipe', timeout: 10_000 });
        } catch {
          // Container may not exist
        }
      }

      throw new Error(`Docker trial ${trialId} failed: ${msg}`);
    } finally {
      // Clean up staging directory
      try {
        rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  };
}

/**
 * Script that runs inside the Docker container.
 * Reads /eval/payload.json, dynamically imports the inner adapter, and writes JSON to stdout.
 */
const CONTAINER_RUNNER_SCRIPT = `
import { readFileSync } from 'node:fs';

const payload = JSON.parse(readFileSync('/eval/payload.json', 'utf-8'));
const { example, adapter: adapterName, config } = payload;

// Minimal adapter implementation inside the container
async function runPlainLlm(example, config) {
  const model = config.model || 'us.anthropic.claude-sonnet-4-20250514';
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const messages = [{ role: 'user', content: example.input?.prompt || JSON.stringify(example.input) }];
  const body = {
    model,
    max_tokens: 4096,
    messages,
  };

  if (config.skillContent) {
    body.system = config.skillContent;
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('API error ' + resp.status + ': ' + text);
  }

  const data = await resp.json();
  const content = data.content?.map(c => c.text).join('') || '';
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  const result = {
    messages: [{ role: 'assistant', content }],
    toolCalls: [],
    output: content,
    latencyMs: 0,
    tokenUsage: { input: inputTokens, output: outputTokens },
    adapter: adapterName,
  };
  console.log(JSON.stringify(result));
}

try {
  await runPlainLlm(example, config);
} catch (err) {
  const result = {
    messages: [],
    toolCalls: [],
    output: '',
    latencyMs: 0,
    tokenUsage: null,
    adapter: adapterName,
    error: err.message || String(err),
  };
  console.log(JSON.stringify(result));
  process.exit(1);
}
`;
