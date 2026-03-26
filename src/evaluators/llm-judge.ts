import {
  getBedrockConfig,
  signBedrockRequest,
  buildBedrockBody,
  parseBedrockResponse,
} from '../adapters/bedrock.js';
import { LlmCache } from '../cache/index.js';

export interface JudgeRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  cache?: boolean;
}

export interface JudgeResponse {
  score: number;
  label: string;
  explanation: string;
}

const CONTENT_FILTER_RE = /content.?(?:policy|filter|management)|ContentPolicyViolation|content_filter/i;

export class ContentFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentFilterError';
  }
}

export function isContentFilterError(err: unknown): err is ContentFilterError {
  if (err instanceof ContentFilterError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return CONTENT_FILTER_RE.test(msg);
}

const DEFAULT_JUDGE_MODEL = 'llm-gateway/gpt-5.4';

const judgeCache = new LlmCache({ ttl: '24h', dir: '.cursor-plugin-evals/judge-cache' });

export function getJudgeCache(): LlmCache {
  return judgeCache;
}

export async function callJudge(request: JudgeRequest): Promise<JudgeResponse> {
  const model = request.model ?? process.env.JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;

  const useCache = request.cache !== false && process.env.JUDGE_CACHE !== 'false';

  if (useCache) {
    const cached = await judgeCache.get(model, request.systemPrompt, request.userPrompt);
    if (cached) {
      return parseJudgeResponse(cached);
    }
  }

  const isAzure =
    !!process.env.AZURE_OPENAI_API_KEY && !!process.env.AZURE_OPENAI_ENDPOINT;
  const bedrock = !isAzure ? getBedrockConfig() : null;
  const isAnthropic = !isAzure && !bedrock && !!process.env.ANTHROPIC_API_KEY;
  const isLiteLLM = !isAzure && !bedrock && !isAnthropic && !!process.env.LITELLM_API_KEY;
  const apiKey = isAzure
    ? process.env.AZURE_OPENAI_API_KEY!
    : isAnthropic
      ? process.env.ANTHROPIC_API_KEY!
      : isLiteLLM
        ? process.env.LITELLM_API_KEY!
        : (process.env.OPENAI_API_KEY ?? '');

  if (!apiKey && !bedrock) {
    throw new Error(
      'LLM judge requires AZURE_OPENAI_API_KEY, AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY, ' +
        'ANTHROPIC_API_KEY, LITELLM_API_KEY, or OPENAI_API_KEY. Set the environment variable before running LLM evaluators.',
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
    const msg = `Judge API error ${response.status}: ${errorBody.slice(0, 300)}`;
    if (CONTENT_FILTER_RE.test(errorBody) || CONTENT_FILTER_RE.test(msg)) {
      throw new ContentFilterError(msg);
    }
    throw new Error(msg);
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

  if (useCache) {
    await judgeCache.set(model, request.systemPrompt, request.userPrompt, content).catch(() => {});
  }

  return parseJudgeResponse(content);
}

function extractFirstJson(content: string): string | null {
  const start = content.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}

function parseJudgeResponse(content: string): JudgeResponse {
  try {
    const jsonStr = extractFirstJson(content);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr) as {
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
  if (scoreMatch) {
    const score = Math.max(0, Math.min(1, parseFloat(scoreMatch[1])));
    return { score, label: 'PARSED', explanation: content.slice(0, 500) };
  }

  return { score: 0, label: 'UNPARSEABLE', explanation: content.slice(0, 500) };
}

/**
 * Standard catch handler for LLM evaluators.
 * Returns a content-filtered skip result or an error result.
 */
export function handleJudgeError(evaluatorName: string, err: unknown): {
  evaluator: string;
  score: number;
  pass: boolean;
  skipped?: boolean;
  label: string;
  explanation: string;
} {
  const errMsg = err instanceof Error ? err.message : String(err);
  if (isContentFilterError(err)) {
    return {
      evaluator: evaluatorName,
      score: 0,
      pass: true,
      skipped: true,
      label: 'content_filtered',
      explanation: `Judge blocked by content policy — skipped: ${errMsg.slice(0, 200)}`,
    };
  }
  return {
    evaluator: evaluatorName,
    score: 0,
    pass: false,
    label: 'error',
    explanation: `Judge call failed: ${errMsg}`,
  };
}
