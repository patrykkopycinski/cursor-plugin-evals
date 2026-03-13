import { resolve, isAbsolute } from 'path';
import { loadConfig } from '../core/config.js';
import { runEvaluation, type RunOptions } from '../core/runner.js';
import { printTerminalReport } from '../reporting/terminal.js';
import { log } from './logger.js';

export interface WatchOptions extends RunOptions {
  report?: string;
  verbose?: boolean;
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): { (...args: Parameters<T>): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

async function executeRun(configPath: string, options: WatchOptions): Promise<void> {
  try {
    const config = loadConfig(configPath);
    const result = await runEvaluation(config, options);
    printTerminalReport(result);
  } catch (err) {
    log.error('Watch run failed', err);
  }
}

export async function watchAndRun(
  configPath: string,
  options: WatchOptions,
): Promise<{ close(): Promise<void> }> {
  let chokidar: typeof import('chokidar');
  try {
    chokidar = await import('chokidar');
  } catch {
    throw new Error('chokidar is required for watch mode. Install it with: npm install chokidar');
  }

  const absConfigPath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);

  let config;
  try {
    config = loadConfig(absConfigPath);
  } catch (err) {
    throw new Error(
      `Failed to load config for watch mode: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const pluginDir = config.plugin.dir
    ? isAbsolute(config.plugin.dir)
      ? config.plugin.dir
      : resolve(process.cwd(), config.plugin.dir)
    : process.cwd();

  const watchPaths = [pluginDir, absConfigPath];

  log.header('Watch Mode');
  log.info(`  Watching: ${watchPaths.join(', ')}`);
  log.info('  Press Ctrl+C to stop\n');

  await executeRun(absConfigPath, options);

  const debouncedRun = debounce(() => {
    process.stdout.write('\x1Bc');
    log.info('  File change detected, re-running...\n');
    executeRun(absConfigPath, options);
  }, 300);

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  });

  watcher.on('all', () => {
    debouncedRun();
  });

  const cleanup = async (): Promise<void> => {
    debouncedRun.cancel();
    await watcher.close();
  };

  const onSignal = (): void => {
    log.info('\n  Stopping watch mode...');
    cleanup().then(() => process.exit(0));
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return { close: cleanup };
}
