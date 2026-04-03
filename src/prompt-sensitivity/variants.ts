import { callJudge } from '../evaluators/llm-judge.js';

const SYSTEM_PROMPT = `You are a prompt rephasing assistant. Generate different rephrasings of the given prompt that preserve the same intent but use different wording, structure, and phrasing style.

Respond ONLY with a JSON array of strings. No explanation, no markdown fences.

Example:
Input: "List all available tools"
Output: ["Show me what tools you have", "What tools can I use?", "Display the available tool set"]`;

export async function generateVariants(prompt: string, count: number): Promise<string[]> {
  if (count < 1) return [];

  const result = await callJudge({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Generate ${count} different rephrasings of this prompt that preserve the same intent but use different wording. Return as JSON array of strings.\n\nPrompt: "${prompt}"`,
  });

  const raw = result.explanation || '';
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed.slice(0, count);
      }
    } catch (_e) {
      // fall through
    }
  }

  return raw
    .split('\n')
    .map((line) =>
      line
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .slice(0, count);
}
