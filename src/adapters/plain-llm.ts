import type {
  TaskAdapter,
  Example,
  TaskOutput,
  AdapterConfig,
  ToolCallRecord,
} from '../core/types.js';
import {
  getBedrockConfig,
  signBedrockRequest,
  buildBedrockBody,
  parseBedrockResponse,
  type BedrockConfig,
} from './bedrock.js';

type Provider = 'bedrock' | 'anthropic' | 'azure-openai' | 'openai';

const DEFAULT_MODEL = 'us.anthropic.claude-opus-4-6-v1';

function detectProvider(): { provider: Provider; bedrock?: BedrockConfig } {
  const bedrock = getBedrockConfig();
  if (bedrock) return { provider: 'bedrock', bedrock };
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic' };
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT)
    return { provider: 'azure-openai' };
  return { provider: 'openai' };
}

interface ProviderConfig {
  url: string;
  headers: Record<string, string>;
  buildBody: (
    model: string,
    messages: Array<{ role: string; content: string }>,
    systemPrompt?: string,
  ) => Record<string, unknown>;
  parseResponse: (data: unknown) => {
    content: string | null;
    hasToolCalls: boolean;
    inputTokens: number;
    outputTokens: number;
  };
  resolveRequest?: (
    model: string,
    messages: Array<{ role: string; content: string }>,
    systemPrompt?: string,
  ) => { url: string; headers: Record<string, string>; body: string };
}

function configureBedrock(bedrock: BedrockConfig): ProviderConfig {
  return {
    url: '',
    headers: {},
    buildBody: () => ({}),
    parseResponse: parseBedrockResponse,
    resolveRequest: (model, messages, systemPrompt) => {
      const { modelId, body } = buildBedrockBody(model, messages, systemPrompt);
      const signed = signBedrockRequest(bedrock, modelId, body);
      return { url: signed.url, headers: signed.headers, body };
    },
  };
}

function configureAnthropic(): ProviderConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    buildBody: (model, messages, systemPrompt) => {
      const userMessages = messages.filter((m) => m.role !== 'system');
      const body: Record<string, unknown> = {
        model,
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 8192,
      };
      if (systemPrompt) body.system = systemPrompt;
      return body;
    },
    parseResponse: (data) => {
      const resp = data as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const textBlock = resp.content?.find((c) => c.type === 'text');
      return {
        content: textBlock?.text ?? null,
        hasToolCalls: resp.content?.some((c) => c.type === 'tool_use') ?? false,
        inputTokens: resp.usage?.input_tokens ?? 0,
        outputTokens: resp.usage?.output_tokens ?? 0,
      };
    },
  };
}

function configureAzureOpenAI(model: string): ProviderConfig {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? model;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2025-01-01-preview';
  return {
    url: `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.AZURE_OPENAI_API_KEY! },
    buildBody: (_model, messages) => ({ messages, max_tokens: 4096 }),
    parseResponse: parseOpenAIResponse,
  };
}

function configureOpenAI(config: AdapterConfig): ProviderConfig {
  const apiBaseUrl = config.apiBaseUrl ?? process.env.LITELLM_URL ?? 'https://api.openai.com/v1';
  const apiKey = config.apiKey ?? process.env.LITELLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  return {
    url: `${apiBaseUrl}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    buildBody: (model, messages) => ({ model, messages, max_tokens: 4096 }),
    parseResponse: parseOpenAIResponse,
  };
}

function parseOpenAIResponse(data: unknown): {
  content: string | null;
  hasToolCalls: boolean;
  inputTokens: number;
  outputTokens: number;
} {
  const resp = data as {
    choices?: Array<{
      message: { content: string | null; tool_calls?: unknown[] };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = resp.choices?.[0];
  return {
    content: choice?.message.content ?? null,
    hasToolCalls: (choice?.message.tool_calls?.length ?? 0) > 0,
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
  };
}

export function createPlainLlmAdapter(config: AdapterConfig): TaskAdapter {
  const detected = detectProvider();
  const provider = detected.provider;
  const timeout = config.timeout ?? 120_000;
  const maxTurns = 10;
  const skillContent = config['skillContent'] as string | undefined;

  const model =
    provider === 'bedrock' ? detected.bedrock!.model : (config.model ?? DEFAULT_MODEL);

  let providerConfig: ProviderConfig;
  switch (provider) {
    case 'bedrock':
      providerConfig = configureBedrock(detected.bedrock!);
      break;
    case 'anthropic':
      providerConfig = configureAnthropic();
      break;
    case 'azure-openai':
      providerConfig = configureAzureOpenAI(model);
      break;
    default:
      providerConfig = configureOpenAI(config);
  }

  return async (example: Example): Promise<TaskOutput> => {
    const prompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    const startTime = Date.now();
    const messages: Array<{ role: string; content: string }> = [];
    const toolCalls: ToolCallRecord[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let finalOutput = '';

    let systemPrompt: string | undefined;
    if (skillContent) {
      const sysContent =
        'You are an AI assistant with the following skill activated. ' +
        'Follow the skill instructions precisely when the user prompt matches.\n\n' +
        skillContent;

      if (provider === 'bedrock' || provider === 'anthropic') {
        systemPrompt = sysContent;
      } else {
        messages.push({ role: 'system', content: sysContent });
      }
    }

    messages.push({ role: 'user', content: prompt });

    for (let turn = 0; turn < maxTurns; turn++) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeout);

      try {
        let reqUrl: string;
        let reqHeaders: Record<string, string>;
        let reqBody: string;

        if (providerConfig.resolveRequest) {
          const req = providerConfig.resolveRequest(model, messages, systemPrompt);
          reqUrl = req.url;
          reqHeaders = req.headers;
          reqBody = req.body;
        } else {
          reqUrl = providerConfig.url;
          reqHeaders = providerConfig.headers;
          reqBody = JSON.stringify(providerConfig.buildBody(model, messages, systemPrompt));
        }

        const response = await fetch(reqUrl, {
          method: 'POST',
          headers: reqHeaders,
          body: reqBody,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(`LLM API error ${response.status}: ${errorBody.slice(0, 500)}`);
        }

        const data = await response.json();
        const parsed = providerConfig.parseResponse(data);

        totalInput += parsed.inputTokens;
        totalOutput += parsed.outputTokens;

        if (parsed.content) {
          finalOutput = parsed.content;
          messages.push({ role: 'assistant', content: parsed.content });
        }

        if (parsed.hasToolCalls) {
          console.debug('[plain-llm] LLM returned tool calls — breaking (plain-llm cannot execute tools)');
          break;
        }
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    return {
      messages,
      toolCalls,
      output: finalOutput,
      latencyMs: Date.now() - startTime,
      tokenUsage: { input: totalInput, output: totalOutput },
      adapter: 'plain-llm',
    };
  };
}
