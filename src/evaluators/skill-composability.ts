import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

interface SkillDef { name: string; description: string; }
interface ComposabilityConfig { skills: SkillDef[]; scenario: string; }

const SYSTEM_PROMPT = `Analyze whether these skills can work together effectively in the described scenario.
Evaluate: compatible (coexist without conflicts?), interference (one corrupts other's context?), chainable (output feeds into other?).
Respond ONLY with JSON:
{"compatible": true/false, "interference": true/false, "chainable": true/false, "issues": ["problems"], "score": 0.0-1.0}`;

export class SkillComposabilityEvaluator implements Evaluator {
  name = 'skill-composability';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const config = context.config?.['skill-composability'] as ComposabilityConfig | undefined;
    if (!config?.skills?.length) {
      return { evaluator: this.name, score: 0, pass: true, skipped: true, label: 'no_config', explanation: 'No composability config.' };
    }
    const userPrompt = `Skills:\n${config.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}\n\nScenario: ${config.scenario}`;
    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const json = result.explanation.match(/\{[\s\S]*\}/);
      const parsed = json ? JSON.parse(json[0]) as { compatible: boolean; interference: boolean; chainable: boolean; issues: string[]; score: number } : { compatible: true, interference: false, chainable: true, issues: [], score: result.score };
      const score = parsed.score ?? (parsed.compatible && !parsed.interference ? 0.9 : 0.3);
      const threshold = (context.config?.['skill-composability-threshold'] as number | undefined) ?? 0.7;
      return {
        evaluator: this.name, score, pass: score >= threshold,
        label: parsed.compatible ? 'COMPATIBLE' : 'INCOMPATIBLE',
        explanation: `Compatible: ${parsed.compatible}, Interference: ${parsed.interference}, Chainable: ${parsed.chainable}. ${parsed.issues.length > 0 ? 'Issues: ' + parsed.issues.join('; ') : ''}`,
        metadata: { compatible: parsed.compatible, interference: parsed.interference, chainable: parsed.chainable, issues: parsed.issues },
      };
    } catch (err) { return handleJudgeError(this.name, err); }
  }
}
