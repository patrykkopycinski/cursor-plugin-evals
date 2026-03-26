import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

interface DescConfig { description: string; otherDescriptions?: string[]; }

const SYSTEM_PROMPT = `Score this skill description on 4 dimensions (0.0-1.0 each):
- clarity: Is it clear what the skill does?
- specificity: Is it specific enough that an LLM won't confuse it with other skills?
- actionability: Does it describe when to use it?
- uniqueness: How distinct is it from the other skill descriptions provided?

Respond ONLY with valid JSON:
{"clarity": 0.0-1.0, "specificity": 0.0-1.0, "actionability": 0.0-1.0, "uniqueness": 0.0-1.0, "issues": ["list of improvement suggestions"]}`;

export class SkillDescriptionEvaluator implements Evaluator {
  name = 'skill-description';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const config = context.config?.['skill-description'] as DescConfig | undefined;
    if (!config?.description) {
      return { evaluator: this.name, score: 0, pass: true, skipped: true, label: 'no_config', explanation: 'No description provided.' };
    }
    const others = config.otherDescriptions?.length ? `\n\nOther skill descriptions:\n${config.otherDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}` : '';
    const userPrompt = `Skill description: "${config.description}"${others}`;

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const json = result.explanation.match(/\{[\s\S]*\}/);
      const parsed = json ? JSON.parse(json[0]) as { clarity: number; specificity: number; actionability: number; uniqueness: number; issues: string[] } : { clarity: result.score, specificity: result.score, actionability: result.score, uniqueness: result.score, issues: [] };
      const score = (parsed.clarity + parsed.specificity + parsed.actionability + parsed.uniqueness) / 4;
      const threshold = (context.config?.['skill-description-threshold'] as number | undefined) ?? 0.7;
      return {
        evaluator: this.name, score, pass: score >= threshold,
        label: score >= 0.8 ? 'EXCELLENT' : score >= 0.6 ? 'GOOD' : 'NEEDS_WORK',
        explanation: `Clarity: ${parsed.clarity.toFixed(2)}, Specificity: ${parsed.specificity.toFixed(2)}, Actionability: ${parsed.actionability.toFixed(2)}, Uniqueness: ${parsed.uniqueness.toFixed(2)}. ${parsed.issues.length > 0 ? 'Issues: ' + parsed.issues.join('; ') : ''}`,
        metadata: { clarity: parsed.clarity, specificity: parsed.specificity, actionability: parsed.actionability, uniqueness: parsed.uniqueness, issues: parsed.issues },
      };
    } catch (err) { return handleJudgeError(this.name, err); }
  }
}
