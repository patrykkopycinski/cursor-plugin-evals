import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { resolveWorkflowConfig } from './config-schemas.js';

export class WorkflowEvaluator implements Evaluator {
  name = 'workflow';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const check = resolveWorkflowConfig(context.config);
    const violations: string[] = [];
    const passes: string[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    if (check.tools_used?.length) {
      for (const tool of check.tools_used) {
        totalChecks++;
        const found = context.toolCalls.some((tc) => tc.tool === tool || tc.tool.includes(tool));
        if (found) {
          passedChecks++;
          passes.push(`tool:${tool}`);
        } else {
          violations.push(`tool "${tool}" was never called`);
        }
      }
    }

    if (check.files_read?.length) {
      for (const pattern of check.files_read) {
        totalChecks++;
        const found = context.toolCalls.some(
          (tc) =>
            (tc.tool === 'read_file' || tc.tool === 'Read' || tc.tool.includes('read')) &&
            typeof tc.args?.path === 'string' &&
            tc.args.path.includes(pattern),
        );
        if (found) {
          passedChecks++;
          passes.push(`read:${pattern}`);
        } else {
          violations.push(`file matching "${pattern}" was never read`);
        }
      }
    }

    if (check.files_written?.length) {
      for (const pattern of check.files_written) {
        totalChecks++;
        const found = context.toolCalls.some(
          (tc) =>
            (tc.tool === 'write_file' || tc.tool === 'Write' || tc.tool.includes('write') || tc.tool === 'edit_file') &&
            typeof tc.args?.path === 'string' &&
            tc.args.path.includes(pattern),
        );
        if (found) {
          passedChecks++;
          passes.push(`write:${pattern}`);
        } else {
          violations.push(`no file matching "${pattern}" was written`);
        }
      }
    }

    if (check.output_patterns?.length) {
      const output = (context.finalOutput ?? '').toLowerCase();
      for (const pattern of check.output_patterns) {
        totalChecks++;
        if (output.includes(pattern.toLowerCase())) {
          passedChecks++;
          passes.push(`output:${pattern}`);
        } else {
          violations.push(`output missing pattern "${pattern}"`);
        }
      }
    }

    if (totalChecks === 0) {
      return {
        evaluator: this.name,
        score: 0,
        pass: true,
        skipped: true,
        label: 'no_checks',
        explanation: 'No workflow checks configured — excluded from scoring',
      };
    }

    const score = passedChecks / totalChecks;
    return {
      evaluator: this.name,
      score,
      pass: violations.length === 0,
      label: violations.length === 0 ? 'complete' : 'incomplete',
      explanation: violations.length === 0
        ? `All ${totalChecks} workflow checks passed: ${passes.join(', ')}`
        : `${violations.length}/${totalChecks} failed: ${violations.join('; ')}`,
      metadata: { passes, violations, totalChecks, passedChecks },
    };
  }
}
