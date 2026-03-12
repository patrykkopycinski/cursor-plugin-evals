import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { loadPlugins } from './loader.js';
import type { PluginsConfig } from '../core/types.js';

const TMP_DIR = join(__dirname, '__tmp_plugins_test__');

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

function writePlugin(filename: string, content: string): string {
  const filePath = join(TMP_DIR, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('loadPlugins', () => {
  describe('evaluators', () => {
    it('loads a valid evaluator object', async () => {
      const path = writePlugin(
        'eval-plugin.mjs',
        `export default { name: 'custom-eval', evaluate: async () => ({ evaluator: 'custom-eval', score: 1.0, pass: true }) };`,
      );

      const config: PluginsConfig = {
        evaluators: [{ name: 'custom-eval', module: path }],
      };

      const result = await loadPlugins(config, TMP_DIR);
      expect(result.evaluators.size).toBe(1);
      expect(result.evaluators.has('custom-eval')).toBe(true);

      const evaluator = result.evaluators.get('custom-eval')!;
      expect(evaluator.name).toBe('custom-eval');
      expect(typeof evaluator.evaluate).toBe('function');
    });

    it('rejects evaluator without name', async () => {
      const path = writePlugin(
        'bad-eval.mjs',
        `export default { evaluate: async () => ({}) };`,
      );

      const config: PluginsConfig = {
        evaluators: [{ name: 'bad', module: path }],
      };

      await expect(loadPlugins(config, TMP_DIR)).rejects.toThrow(
        'must export an Evaluator class or object',
      );
    });

    it('rejects evaluator without evaluate function', async () => {
      const path = writePlugin(
        'no-eval-fn.mjs',
        `export default { name: 'broken' };`,
      );

      const config: PluginsConfig = {
        evaluators: [{ name: 'broken', module: path }],
      };

      await expect(loadPlugins(config, TMP_DIR)).rejects.toThrow(
        'must export an Evaluator class or object',
      );
    });
  });

  describe('reporters', () => {
    it('loads a valid reporter function', async () => {
      const path = writePlugin(
        'reporter-plugin.mjs',
        `export default function(result) { return JSON.stringify(result); };`,
      );

      const config: PluginsConfig = {
        reporters: [{ name: 'custom-report', module: path }],
      };

      const result = await loadPlugins(config, TMP_DIR);
      expect(result.reporters.size).toBe(1);
      expect(result.reporters.has('custom-report')).toBe(true);
    });

    it('loads reporter from named export', async () => {
      const path = writePlugin(
        'named-reporter.mjs',
        `export function report(result) { return 'report'; };`,
      );

      const config: PluginsConfig = {
        reporters: [{ name: 'named', module: path }],
      };

      const result = await loadPlugins(config, TMP_DIR);
      expect(result.reporters.size).toBe(1);
    });

    it('rejects non-function reporter', async () => {
      const path = writePlugin(
        'bad-reporter.mjs',
        `export default { not: 'a function' };`,
      );

      const config: PluginsConfig = {
        reporters: [{ name: 'bad', module: path }],
      };

      await expect(loadPlugins(config, TMP_DIR)).rejects.toThrow(
        'must export a function',
      );
    });
  });

  describe('transports', () => {
    it('validates transport with required methods', async () => {
      const path = writePlugin(
        'transport-plugin.mjs',
        `export default class MyTransport { connect() {} send() {} close() {} };`,
      );

      const config: PluginsConfig = {
        transports: [{ name: 'custom-transport', module: path }],
      };

      const result = await loadPlugins(config, TMP_DIR);
      expect(result.evaluators.size).toBe(0);
      expect(result.reporters.size).toBe(0);
    });

    it('rejects transport missing methods', async () => {
      const path = writePlugin(
        'bad-transport.mjs',
        `export default class BadTransport { connect() {} };`,
      );

      const config: PluginsConfig = {
        transports: [{ name: 'bad', module: path }],
      };

      await expect(loadPlugins(config, TMP_DIR)).rejects.toThrow(
        'must implement send, close()',
      );
    });
  });

  describe('error handling', () => {
    it('throws on import failure', async () => {
      const config: PluginsConfig = {
        evaluators: [{ name: 'missing', module: '/nonexistent/path/plugin.mjs' }],
      };

      await expect(loadPlugins(config, TMP_DIR)).rejects.toThrow(
        'Failed to import plugin module',
      );
    });

    it('handles empty plugins config', async () => {
      const config: PluginsConfig = {};
      const result = await loadPlugins(config, TMP_DIR);
      expect(result.evaluators.size).toBe(0);
      expect(result.reporters.size).toBe(0);
    });
  });
});
