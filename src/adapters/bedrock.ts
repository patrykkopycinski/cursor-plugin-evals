import { createHmac, createHash } from 'crypto';

export interface BedrockConfig {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  model: string;
}

export function getBedrockConfig(): BedrockConfig | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region: process.env.AWS_REGION ?? 'us-east-1',
    model: process.env.AWS_BEDROCK_MODEL ?? 'us.anthropic.claude-opus-4-6-v1',
  };
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

export function signBedrockRequest(
  config: BedrockConfig,
  modelId: string,
  body: string,
): SignedRequest {
  const service = 'bedrock';
  const host = `bedrock-runtime.${config.region}.amazonaws.com`;
  const endpoint = `https://${host}/model/${modelId}/invoke`;
  const method = 'POST';
  const contentType = 'application/json';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = `/model/${modelId}/invoke`;
  const canonicalQuerystring = '';
  const payloadHash = sha256(body);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    (config.sessionToken ? `x-amz-security-token:${config.sessionToken}\n` : '') +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = config.sessionToken
    ? 'content-type;host;x-amz-security-token;x-amz-content-sha256;x-amz-date'
    : 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${config.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = getSignatureKey(config.secretAccessKey, dateStamp, config.region, service);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const resultHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: authHeader,
  };
  if (config.sessionToken) {
    resultHeaders['x-amz-security-token'] = config.sessionToken;
  }

  return {
    url: endpoint,
    headers: resultHeaders,
  };
}

export interface BedrockResponse {
  content: string | null;
  hasToolCalls: boolean;
  inputTokens: number;
  outputTokens: number;
}

export function parseBedrockResponse(data: unknown): BedrockResponse {
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
}

export function buildBedrockBody(
  model: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
): { modelId: string; body: string } {
  const userMessages = messages.filter((m) => m.role !== 'system');
  const reqBody: Record<string, unknown> = {
    anthropic_version: 'bedrock-2023-05-31',
    messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: 8192,
  };
  if (systemPrompt) reqBody.system = systemPrompt;
  return { modelId: model, body: JSON.stringify(reqBody) };
}
