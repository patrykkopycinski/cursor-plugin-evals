import { resolve, isAbsolute } from 'node:path';
import type { Evaluator, PluginsConfig, RunResult } from '../core/types.js';

export interface LoadedPlugins {
  evaluators: Map<string, Evaluator>;
  reporters: Map<string, (result: RunResult) => string>;
}

function validateEvaluator(name: string, mod: Record<string, unknown>): Evaluator {
  const instance = (mod.default ?? mod) as Record<string, unknown>;

  if (typeof instance === 'function') {
    const created = new (instance as new () => Evaluator)();
    if (typeof created.name !== 'string' || typeof created.evaluate !== 'function') {
      throw new Error(
        `Plugin evaluator "${name}": class must implement Evaluator interface (name: string, evaluate: function)`,
      );
    }
    return created;
  }

  if (
    typeof instance === 'object' &&
    instance !== null &&
    typeof instance.name === 'string' &&
    typeof instance.evaluate === 'function'
  ) {
    return instance as unknown as Evaluator;
  }

  throw new Error(
    `Plugin evaluator "${name}": module must export an Evaluator class or object with name and evaluate()`,
  );
}

function validateReporter(
  name: string,
  mod: Record<string, unknown>,
): (result: RunResult) => string {
  const fn = (mod.default ?? mod.report ?? mod.reporter) as unknown;

  if (typeof fn === 'function') {
    return fn as (result: RunResult) => string;
  }

  throw new Error(
    `Plugin reporter "${name}": module must export a function (default, report, or reporter)`,
  );
}

function validateTransport(name: string, mod: Record<string, unknown>): void {
  const raw = (mod.default ?? mod) as unknown;
  const obj =
    typeof raw === 'function' ? (raw as { prototype?: Record<string, unknown> }).prototype : raw;

  const required = ['connect', 'send', 'close'] as const;
  const target = obj as Record<string, unknown> | undefined;
  const missing = required.filter((m) => typeof target?.[m] !== 'function');

  if (missing.length > 0) {
    throw new Error(`Plugin transport "${name}": must implement ${missing.join(', ')}()`);
  }
}

async function importModule(
  modulePath: string,
  configDir: string,
): Promise<Record<string, unknown>> {
  const resolved = isAbsolute(modulePath) ? modulePath : resolve(configDir, modulePath);

  try {
    return (await import(resolved)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to import plugin module "${modulePath}": ${message}`, { cause: err });
  }
}

export async function loadPlugins(
  config: PluginsConfig,
  configDir: string,
): Promise<LoadedPlugins> {
  const evaluators = new Map<string, Evaluator>();
  const reporters = new Map<string, (result: RunResult) => string>();

  if (config.evaluators) {
    for (const entry of config.evaluators) {
      const mod = await importModule(entry.module, configDir);
      const evaluator = validateEvaluator(entry.name, mod);
      evaluators.set(entry.name, evaluator);
    }
  }

  if (config.reporters) {
    for (const entry of config.reporters) {
      const mod = await importModule(entry.module, configDir);
      const reporter = validateReporter(entry.name, mod);
      reporters.set(entry.name, reporter);
    }
  }

  if (config.transports) {
    for (const entry of config.transports) {
      const mod = await importModule(entry.module, configDir);
      validateTransport(entry.name, mod);
    }
  }

  return { evaluators, reporters };
}
