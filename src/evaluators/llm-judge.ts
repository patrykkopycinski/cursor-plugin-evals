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

  const isAzure = !!process.env.AZURE_OPENAI_API_KEY && !!process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = isAzure
    ? process.env.AZURE_OPENAI_API_KEY!
    : (process.env.OPENAI_API_KEY ?? '');

  if (!apiKey) {
    throw new Error(
      'LLM judge requires OPENAI_API_KEY or AZURE_OPENAI_API_KEY. ' +
        'Set the environment variable before running LLM evaluators.',
    );
  }

  let url: string;
  let headers: Record<string, string>;

  if (isAzure) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, '');
    const deployment = process.env.AZURE_JUDGE_DEPLOYMENT ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? model;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2025-01-01-preview';
    url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    headers = { 'Content-Type': 'application/json', 'api-key': apiKey };
  } else {
    const apiBaseUrl = process.env.LITELLM_URL ?? 'https://api.openai.com/v1';
    url = `${apiBaseUrl}/chat/completions`;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  }

  const body: Record<string, unknown> = {
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
    temperature: 0,
    max_tokens: 1024,
  };
  if (!isAzure) body.model = model;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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
