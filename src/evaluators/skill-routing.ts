import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

interface RoutingConfig { skillDescription: string; shouldActivate: boolean; }

const SYSTEM_PROMPT = `You are testing skill routing accuracy. Given a skill description and a user prompt, determine if an LLM agent SHOULD activate this skill to handle the prompt.

Respond ONLY with valid JSON:
{"activated": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}

Be strict: the skill should ONLY activate if the prompt clearly falls within the skill's stated purpose.`;

export class SkillRoutingEvaluator implements Evaluator {
  name = 'skill-routing';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const config = context.config?.['skill-routing'] as RoutingConfig | undefined;
    if (!config?.skillDescription) {
      return { evaluator: this.name, score: 0, pass: true, skipped: true, label: 'no_config', explanation: 'No skill-routing config provided.' };
    }

    const userPrompt = `Skill description: "${config.skillDescription}"\n\nUser prompt: "${context.prompt ?? ''}"`;

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const json = result.explanation.match(/\{[\s\S]*\}/);
      const parsed = json ? JSON.parse(json[0]) as { activated: boolean; confidence: number; reasoning: string } : { activated: result.score > 0.5, confidence: result.score, reasoning: result.explanation };

      const correct = parsed.activated === config.shouldActivate;
      const score = correct ? parsed.confidence : 1 - parsed.confidence;
      const threshold = (context.config?.['skill-routing-threshold'] as number | undefined) ?? 0.7;

      return {
        evaluator: this.name, score, pass: score >= threshold,
        label: correct ? 'CORRECT_ROUTING' : config.shouldActivate ? 'FALSE_NEGATIVE' : 'FALSE_POSITIVE',
        explanation: `${correct ? 'Correct' : 'Incorrect'} routing (confidence: ${parsed.confidence.toFixed(2)}). ${parsed.reasoning}`,
        metadata: { shouldActivate: config.shouldActivate, activated: parsed.activated, confidence: parsed.confidence },
      };
    } catch (err) { return handleJudgeError(this.name, err); }
  }
}
