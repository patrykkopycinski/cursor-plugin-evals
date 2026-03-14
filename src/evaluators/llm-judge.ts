import {
  getBedrockConfig,
  signBedrockRequest,
  buildBedrockBody,
  parseBedrockResponse,
} from '../adapters/bedrock.js';

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

const DEFAULT_JUDGE_MODEL = 'llm-gateway/gpt-5.4';

export async function callJudge(request: JudgeRequest): Promise<JudgeResponse> {
  const model = request.model ?? process.env.JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;

  const isAzure =
    !!process.env.AZURE_OPENAI_API_KEY && !!process.env.AZURE_OPENAI_ENDPOINT;
  const bedrock = !isAzure ? getBedrockConfig() : null;
  const isAnthropic = !isAzure && !bedrock && !!process.env.ANTHROPIC_API_KEY;
  const apiKey = isAzure
    ? process.env.AZURE_OPENAI_API_KEY!
    : isAnthropic
      ? process.env.ANTHROPIC_API_KEY!
      : (process.env.OPENAI_API_KEY ?? '');

  if (!apiKey && !bedrock) {
    throw new Error(
      'LLM judge requires AZURE_OPENAI_API_KEY, AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY, ' +
        'ANTHROPIC_API_KEY, or OPENAI_API_KEY. Set the environment variable before running LLM evaluators.',
    );
  }

  let url: string;
  let headers: Record<string, string>;
  let bodyStr: string;

  if (isAzure) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, '');
    const deployment =
      process.env.AZURE_JUDGE_DEPLOYMENT ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? model;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2025-01-01-preview';
    url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    headers = { 'Content-Type': 'application/json', 'api-key': apiKey };
    bodyStr = JSON.stringify({
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: 0,
      max_completion_tokens: 1024,
    });
  } else if (bedrock) {
    const judgeModel = process.env.AWS_BEDROCK_JUDGE_MODEL ?? bedrock.model;
    const { modelId, body: bedrockBody } = buildBedrockBody(
      judgeModel,
      [{ role: 'user', content: request.userPrompt }],
      request.systemPrompt,
    );
    const signed = signBedrockRequest(bedrock, modelId, bedrockBody);
    url = signed.url;
    headers = signed.headers;
    bodyStr = bedrockBody;
  } else if (isAnthropic) {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    bodyStr = JSON.stringify({
      model,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userPrompt }],
      temperature: 0,
      max_tokens: 1024,
    });
  } else {
    const apiBaseUrl = process.env.LITELLM_URL ?? 'https://api.openai.com/v1';
    url = `${apiBaseUrl}/chat/completions`;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LITELLM_API_KEY ?? apiKey}` };
    bodyStr = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: 0,
      max_tokens: 1024,
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Judge API error ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();
  let content: string;

  if (bedrock) {
    const parsed = parseBedrockResponse(data);
    content = parsed.content ?? '';
  } else if (isAnthropic) {
    const resp = data as { content?: Array<{ type: string; text?: string }> };
    content = resp.content?.find((c) => c.type === 'text')?.text ?? '';
  } else {
    const resp = data as { choices: Array<{ message: { content: string | null } }> };
    content = resp.choices?.[0]?.message?.content ?? '';
  }

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
