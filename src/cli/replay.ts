import { join } from 'node:path';
import { log } from './logger.js';
import { loadRecording } from '../recordings/index.js';
import { createEvaluator } from '../evaluators/index.js';
import { DATA_DIR } from '../core/constants.js';
import type {
  EvaluatorContext,
  EvaluatorResult,
  ToolCallRecord,
  TokenUsage,
} from '../core/types.js';

const DEFAULT_CODE_EVALUATORS = [
  'tool-selection',
  'tool-args',
  'tool-sequence',
  'response-quality',
  'mcp-protocol',
  'security',
  'keywords',
];

export async function replayCommand(opts: {
  skill: string;
  recordingsDir?: string;
  runId?: string;
  evaluators?: string[];
  judge?: string;
}): Promise<void> {
  const recordingsDir = opts.recordingsDir ?? join(DATA_DIR, 'recordings');

  if (opts.judge) {
    process.env.JUDGE_MODEL = opts.judge;
  }

  const recording = await loadRecording(recordingsDir, opts.skill, opts.runId);
  if (!recording) {
    log.error(
      `No recording found for skill "${opts.skill}"${opts.runId ? ` with runId "${opts.runId}"` : ''}. ` +
        `Run an eval first or check the recordings directory: ${recordingsDir}`,
    );
    return;
  }

  const evaluatorNames = opts.evaluators ?? DEFAULT_CODE_EVALUATORS;
  const evaluators = evaluatorNames.map((name) => createEvaluator(name));

  log.header(`Replay: ${recording.skill} (${recording.runId.slice(0, 8)})`);
  log.info(`  Model: ${recording.model}  Adapter: ${recording.adapter}`);
  log.info(`  Recorded: ${recording.timestamp}`);
  log.info(`  Examples: ${recording.examples.length}  Evaluators: ${evaluatorNames.join(', ')}`);
  log.divider();

  const rows: string[][] = [['Test Name', 'Score', 'Pass', 'Evaluator Details']];
  let totalPass = 0;
  let totalTests = 0;
  const startTime = Date.now();

  for (const example of recording.examples) {
    const toolCalls: ToolCallRecord[] = example.toolCalls.map((tc) => ({
      tool: tc.tool,
      args: tc.args,
      result: { content: [{ type: 'text', text: JSON.stringify(tc.result) }] },
      latencyMs: tc.latencyMs,
    }));

    const ctx: EvaluatorContext = {
      testName: example.name,
      prompt: (example.input as { prompt?: string }).prompt,
      toolCalls,
      finalOutput:
        typeof example.output === 'string' ? example.output : JSON.stringify(example.output),
    };

    const results: EvaluatorResult[] = [];
    for (const evaluator of evaluators) {
      try {
        const result = await evaluator.evaluate(ctx);
        results.push(result);
      } catch (err) {
        log.warn(
          `Evaluator "${evaluator.name}" threw on "${example.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const avgScore =
      results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0;
    const allPass = results.length > 0 && results.every((r) => r.pass);
    if (allPass) totalPass++;
    totalTests++;

    const details = results.map((r) => `${r.evaluator}=${r.score.toFixed(2)}`).join(', ');
    rows.push([example.name, avgScore.toFixed(3), allPass ? 'PASS' : 'FAIL', details]);
  }

  log.table(rows);
  log.summary(totalTests, totalPass, totalTests - totalPass, Date.now() - startTime);
}
