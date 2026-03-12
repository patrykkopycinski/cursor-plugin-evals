import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge } from './llm-judge.js';

const SYSTEM_PROMPT = `You are an evaluation judge for multi-turn conversation coherence. Assess the conversation on three axes:

1. turn_relevance: Does each assistant response directly address the user's current request?
2. consistency: Are there contradictions across assistant turns?
3. goal_progression: Does the conversation make progress toward resolving the original request?

Respond ONLY with valid JSON:
{
  "turn_relevance": <0.0-1.0>,
  "consistency": <0.0-1.0>,
  "goal_progression": <0.0-1.0>,
  "explanation": "<brief rationale covering all three axes>"
}`;

const MAX_TURNS = 10;

function extractConversationTurns(context: EvaluatorContext): string[] {
  const turns: string[] = [];

  for (const tc of context.toolCalls) {
    const text = tc.result.content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n');
    if (text) {
      turns.push(`[tool:${tc.tool}]: ${text.slice(0, 500)}`);
    }
  }

  if (context.finalOutput) {
    turns.push(`[assistant]: ${context.finalOutput}`);
  }

  return turns;
}

export class ConversationCoherenceEvaluator implements Evaluator {
  name = 'conversation-coherence';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const turns = extractConversationTurns(context);
    const assistantTurns = turns.filter((t) => t.startsWith('[assistant]'));

    if (assistantTurns.length <= 1) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'single-turn',
        explanation: 'Single-turn conversation; coherence evaluation skipped.',
      };
    }

    const recentTurns = turns.slice(-MAX_TURNS);
    const userPrompt = [
      context.prompt ? `Original request: ${context.prompt}` : '',
      `Conversation turns:\n${recentTurns.join('\n\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });

      let turnRelevance: number;
      let consistency: number;
      let goalProgression: number;
      let explanation: string;

      try {
        const jsonMatch = result.explanation.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.explanation) as {
          turn_relevance?: number;
          consistency?: number;
          goal_progression?: number;
          explanation?: string;
        };
        turnRelevance = parsed.turn_relevance ?? result.score;
        consistency = parsed.consistency ?? result.score;
        goalProgression = parsed.goal_progression ?? result.score;
        explanation = parsed.explanation ?? result.explanation;
      } catch {
        turnRelevance = result.score;
        consistency = result.score;
        goalProgression = result.score;
        explanation = result.explanation;
      }

      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      turnRelevance = clamp(turnRelevance);
      consistency = clamp(consistency);
      goalProgression = clamp(goalProgression);

      const score = Math.round(((turnRelevance + consistency + goalProgression) / 3) * 1000) / 1000;
      const threshold = (context.config?.threshold as number | undefined) ?? 0.7;

      return {
        evaluator: this.name,
        score,
        pass: score >= threshold,
        label: result.label,
        explanation,
        metadata: { turnRelevance, consistency, goalProgression, threshold, turnsEvaluated: recentTurns.length },
      };
    } catch (err) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
