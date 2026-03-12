export interface JudgeRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
}

export interface JudgeResponse {
  score: number;
  label: string;
  explanation: string;
}

const DEFAULT_JUDGE_MODEL = 'gpt-4o';

export async function callJudge(request: JudgeRequest): Promise<JudgeResponse> {
  const model = request.model ?? process.env.JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  const apiBaseUrl = process.env.LITELLM_URL ?? 'https://api.openai.com/v1';

  if (!apiKey) {
    throw new Error(
      'LLM judge requires OPENAI_API_KEY (or a key routed through LITELLM_URL). ' +
        'Set the environment variable before running LLM evaluators.',
    );
  }

  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: 0,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Judge API error ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string | null } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? '';
  return parseJudgeResponse(content);
}

function parseJudgeResponse(content: string): JudgeResponse {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        score?: number;
        label?: string;
        explanation?: string;
      };
      return {
        score: Math.max(0, Math.min(1, parsed.score ?? 0.5)),
        label: parsed.label ?? 'UNKNOWN',
        explanation: parsed.explanation ?? content,
      };
    }
  } catch {
    // Fall back to heuristic parsing
  }

  const scoreMatch = content.match(/(?:score|rating)[:\s]*([0-9.]+)/i);
  const score = scoreMatch ? Math.max(0, Math.min(1, parseFloat(scoreMatch[1]))) : 0.5;

  return { score, label: 'PARSED', explanation: content.slice(0, 500) };
}
