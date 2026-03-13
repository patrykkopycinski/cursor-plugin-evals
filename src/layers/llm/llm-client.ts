import type { TokenUsage } from '../../core/types.js';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmResponse {
  message: LlmMessage;
  usage: TokenUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | string;
}

interface OpenAICompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}

type Provider = 'openai' | 'anthropic' | 'azure';

function detectProvider(model: string): Provider {
  if (model.startsWith('claude')) return 'anthropic';
  if (process.env['AZURE_OPENAI_API_KEY'] || process.env['AZURE_OPENAI_ENDPOINT']) return 'azure';
  return 'openai';
}

function getBaseUrl(): string {
  const litellmProxy = process.env['LITELLM_PROXY_URL'];
  if (litellmProxy) return litellmProxy.replace(/\/+$/, '');

  const openaiBase = process.env['OPENAI_BASE_URL'];
  if (openaiBase) return openaiBase.replace(/\/+$/, '');

  return 'https://api.openai.com/v1';
}

function getAzureCompletionsUrl(model: string): string {
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT']?.replace(/\/+$/, '');
  if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is required for Azure OpenAI');
  const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'] ?? model;
  const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2025-01-01-preview';
  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

function getApiKey(provider: Provider): string {
  if (process.env['LITELLM_PROXY_URL']) {
    return process.env['LITELLM_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '';
  }

  if (provider === 'anthropic') {
    const key = process.env['ANTHROPIC_API_KEY'];
    if (!key) throw new Error('ANTHROPIC_API_KEY is required for Anthropic models');
    return key;
  }

  if (provider === 'azure') {
    const key = process.env['AZURE_OPENAI_API_KEY'];
    if (!key) throw new Error('AZURE_OPENAI_API_KEY is required for Azure OpenAI models');
    return key;
  }

  const key = process.env['OPENAI_API_KEY'];
  if (!key) throw new Error('OPENAI_API_KEY is required for OpenAI-compatible models');
  return key;
}

function convertToAnthropicMessages(messages: LlmMessage[]): {
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
} {
  let systemPrompt: string | undefined;
  const converted: Array<{ role: string; content: unknown }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
      continue;
    }

    if (msg.role === 'tool') {
      converted.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content ?? '',
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const content: unknown[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
      converted.push({ role: 'assistant', content });
      continue;
    }

    converted.push({ role: msg.role, content: msg.content ?? '' });
  }

  return { system: systemPrompt, messages: converted };
}

function convertAnthropicTools(tools: LlmToolDefinition[]): Array<{
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function parseAnthropicResponse(data: AnthropicResponse): LlmResponse {
  let textContent = '';
  const toolCalls: LlmToolCall[] = [];

  for (const block of data.content) {
    if (block.type === 'text' && block.text) {
      textContent += block.text;
    }
    if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }

  const finishReason =
    data.stop_reason === 'tool_use'
      ? 'tool_calls'
      : data.stop_reason === 'end_turn'
        ? 'stop'
        : data.stop_reason;

  return {
    message: {
      role: 'assistant',
      content: textContent || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    usage: {
      input: data.usage.input_tokens,
      output: data.usage.output_tokens,
      cached: data.usage.cache_read_input_tokens,
    },
    finishReason,
  };
}

function parseOpenAIResponse(data: OpenAICompletionResponse): LlmResponse {
  const choice = data.choices[0];
  if (!choice) throw new Error('Empty response from LLM');

  const msg = choice.message;

  return {
    message: {
      role: 'assistant',
      content: msg.content ?? undefined,
      tool_calls: msg.tool_calls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    },
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      cached: data.usage?.prompt_tokens_details?.cached_tokens,
    },
    finishReason: choice.finish_reason,
  };
}

export class LlmClient {
  private model: string;
  private provider: Provider;

  constructor(model: string) {
    this.model = model;
    this.provider = process.env['LITELLM_PROXY_URL'] ? 'openai' : detectProvider(model);
  }

  async converse(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    toolChoice?: 'auto' | 'none' | 'required',
  ): Promise<LlmResponse> {
    if (this.provider === 'anthropic' && !process.env['LITELLM_PROXY_URL']) {
      return this.converseAnthropic(messages, tools, toolChoice);
    }
    if (this.provider === 'azure') {
      return this.converseAzure(messages, tools, toolChoice);
    }
    return this.converseOpenAI(messages, tools, toolChoice);
  }

  private async converseOpenAI(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    toolChoice?: string,
  ): Promise<LlmResponse> {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey(this.provider);

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
      if (toolChoice) body['tool_choice'] = toolChoice;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAICompletionResponse;
    return parseOpenAIResponse(data);
  }

  private async converseAzure(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    toolChoice?: string,
  ): Promise<LlmResponse> {
    const url = getAzureCompletionsUrl(this.model);
    const apiKey = getApiKey('azure');

    const body: Record<string, unknown> = { messages };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
      if (toolChoice) body['tool_choice'] = toolChoice;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Azure OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAICompletionResponse;
    return parseOpenAIResponse(data);
  }

  private async converseAnthropic(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    toolChoice?: string,
  ): Promise<LlmResponse> {
    const apiKey = getApiKey('anthropic');
    const { system, messages: anthropicMessages } = convertToAnthropicMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: anthropicMessages,
    };

    if (system) body['system'] = system;

    if (tools && tools.length > 0 && toolChoice !== 'none') {
      body['tools'] = convertAnthropicTools(tools);
      if (toolChoice === 'auto') body['tool_choice'] = { type: 'auto' };
      else if (toolChoice === 'required') body['tool_choice'] = { type: 'any' };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return parseAnthropicResponse(data);
  }
}
