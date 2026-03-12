import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

export class SkillTriggerEvaluator implements Evaluator {
  readonly name = 'skill-trigger';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const expected = context.expected?.tools ?? [];
    if (expected.length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'no_expected',
        explanation: 'No expected skills specified.',
      };
    }

    const selectedSkills = context.toolCalls.map((tc) => tc.tool);
    const expectedSet = new Set(expected);
    const selectedSet = new Set(selectedSkills);

    let truePositives = 0;
    for (const skill of selectedSet) {
      if (expectedSet.has(skill)) truePositives++;
    }

    const precision = selectedSet.size > 0 ? truePositives / selectedSet.size : 0;
    const recall = expectedSet.size > 0 ? truePositives / expectedSet.size : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    const threshold = (context.config?.['skill-trigger'] as number | undefined) ?? 0.8;

    return {
      evaluator: this.name,
      score: f1,
      pass: f1 >= threshold,
      label: f1 >= threshold ? 'correct' : 'incorrect',
      explanation: `F1=${f1.toFixed(2)} (P=${precision.toFixed(2)}, R=${recall.toFixed(2)}). Expected: [${expected.join(', ')}], Selected: [${selectedSkills.join(', ')}]`,
      metadata: { precision, recall, f1, expected, selected: selectedSkills },
    };
  }
}
