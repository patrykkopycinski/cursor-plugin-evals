import { describe, it, expect } from 'vitest';
import { WorkflowEvaluator } from './workflow.js';
import type { ToolCallRecord } from '../core/types.js';

const makeCall = (
  tool: string,
  args: Record<string, unknown> = {},
): ToolCallRecord => ({
  tool,
  args,
  result: { content: [{ type: 'text', text: 'ok' }] },
  latencyMs: 50,
});

const evaluator = new WorkflowEvaluator();

describe('WorkflowEvaluator', () => {
  describe('tools_used', () => {
    it('passes on exact tool name match', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [makeCall('read_file'), makeCall('write_file')],
        config: { workflow: { tools_used: ['read_file'] } },
      });
      expect(result.pass).toBe(true);
      expect(result.score).toBe(1);
      expect(result.metadata?.passes).toContain('tool:read_file');
    });

    it('passes on normalized name match (case-insensitive, strip separators)', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [makeCall('Read_File')],
        config: { workflow: { tools_used: ['read-file'] } },
      });
      expect(result.pass).toBe(true);
      expect(result.score).toBe(1);
    });

    it('fails when tool is not found', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [makeCall('write_file')],
        config: { workflow: { tools_used: ['read_file'] } },
      });
      expect(result.pass).toBe(false);
      expect(result.score).toBe(0);
      expect(result.metadata?.violations).toContain('tool "read_file" was never called');
    });
  });

  describe('files_read', () => {
    it('passes when correct read tool is used with matching path', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [makeCall('read_file', { path: '/src/index.ts' })],
        config: { workflow: { files_read: ['index.ts'] } },
      });
      expect(result.pass).toBe(true);
      expect(result.score).toBe(1);
      expect(result.metadata?.passes).toContain('read:index.ts');
    });

    it('fails when wrong tool is used (not in READ_TOOLS set)', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [makeCall('execute_command', { path: '/src/index.ts' })],
        config: { workflow: { files_read: ['index.ts'] } },
      });
      expect(result.pass).toBe(false);
      expect(result.metadata?.violations).toContain('file matching "index.ts" was never read');
    });
  });

  describe('files_written', () => {
    it('passes when correct write tool is used with matching path', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [makeCall('Write', { path: '/src/output.ts' })],
        config: { workflow: { files_written: ['output.ts'] } },
      });
      expect(result.pass).toBe(true);
      expect(result.score).toBe(1);
      expect(result.metadata?.passes).toContain('write:output.ts');
    });
  });

  describe('output_patterns', () => {
    it('passes when pattern is found in finalOutput', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [],
        finalOutput: 'The operation completed successfully.',
        config: { workflow: { output_patterns: ['completed successfully'] } },
      });
      expect(result.pass).toBe(true);
      expect(result.score).toBe(1);
    });

    it('matches case-insensitively', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [],
        finalOutput: 'SUCCESS: all done',
        config: { workflow: { output_patterns: ['success'] } },
      });
      expect(result.pass).toBe(true);
      expect(result.score).toBe(1);
    });

    it('fails when pattern is not found', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [],
        finalOutput: 'An error occurred.',
        config: { workflow: { output_patterns: ['completed successfully'] } },
      });
      expect(result.pass).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  describe('no workflow checks configured', () => {
    it('returns skipped result when config is empty', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [makeCall('read_file')],
        config: {},
      });
      expect(result.skipped).toBe(true);
      expect(result.pass).toBe(true);
      expect(result.label).toBe('no_checks');
    });

    it('returns skipped result when no config at all', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [],
      });
      expect(result.skipped).toBe(true);
      expect(result.pass).toBe(true);
    });
  });

  describe('mixed checks with partial failures', () => {
    it('reports correct score and violations for partial pass', async () => {
      const result = await evaluator.evaluate({
        testName: 'test',
        toolCalls: [
          makeCall('read_file', { path: '/src/config.ts' }),
          makeCall('write_file', { path: '/src/output.ts' }),
        ],
        finalOutput: 'Done!',
        config: {
          workflow: {
            tools_used: ['read_file', 'missing_tool'],
            files_read: ['config.ts'],
            output_patterns: ['Done!', 'not-present-pattern'],
          },
        },
      });
      expect(result.pass).toBe(false);
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(1);
      expect(result.label).toBe('incomplete');

      const metadata = result.metadata as {
        passes: string[];
        violations: string[];
        totalChecks: number;
        passedChecks: number;
      };
      expect(metadata.totalChecks).toBe(5);
      expect(metadata.passedChecks).toBe(3);
      expect(metadata.violations).toHaveLength(2);
      expect(result.score).toBeCloseTo(3 / 5);
    });
  });
});
