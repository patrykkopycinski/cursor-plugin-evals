import { execSync } from 'node:child_process';
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';

interface ScriptOutput {
  score: number;
  label?: string;
  explanation?: string;
}

export class ScriptEvaluator implements Evaluator {
  name = 'script';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const run = context.config?.run;

    if (!run || typeof run !== 'string') {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: 'No run command specified in evaluator config',
      };
    }

    const threshold = typeof context.config?.threshold === 'number' ? context.config.threshold : 0.5;

    let stdout: string;
    try {
      const result = execSync(run, {
        shell: '/bin/sh',
        timeout: 30_000,
        env: {
          ...process.env,
          EVAL_OUTPUT: context.finalOutput ?? '',
          EVAL_PROMPT: context.prompt ?? '',
          EVAL_TEST_NAME: context.testName,
        },
      });
      stdout = result.toString();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Script execution failed: ${message}`,
      };
    }

    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Failed to parse JSON from script output: ${stdout.trim()}`,
      };
    }

    let parsed: ScriptOutput;
    try {
      parsed = JSON.parse(jsonMatch[0]) as ScriptOutput;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Failed to parse JSON from script output: ${message}`,
      };
    }

    const rawScore = typeof parsed.score === 'number' ? parsed.score : 0;
    const score = Math.min(1, Math.max(0, rawScore));

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: parsed.label,
      explanation: parsed.explanation,
      metadata: { threshold },
    };
  }
}
