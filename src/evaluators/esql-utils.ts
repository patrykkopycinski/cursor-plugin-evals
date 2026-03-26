export interface EsqlResult {
  columns: Array<{ name: string; type: string }>;
  values: unknown[][];
  error?: undefined;
}

export interface EsqlError {
  columns?: undefined;
  values?: undefined;
  error: string;
  isIndexNotFound?: boolean;
}

export type EsqlOutcome = EsqlResult | EsqlError;

/**
 * Extract an ES|QL query from LLM output text.
 * Priority: ```esql blocks > generic fenced blocks with FROM > bare pipe-syntax lines.
 */
export function extractEsql(text: string): string | null {
  // 1. ```esql fenced block
  const esqlFenced = text.match(/```esql\s*\n([\s\S]*?)```/i);
  if (esqlFenced) return esqlFenced[1].trim();

  // 2. Generic fenced block containing FROM keyword
  const genericFenced = text.match(/```\s*\n([\s\S]*?)```/);
  if (genericFenced && /\bFROM\b/i.test(genericFenced[1])) {
    return genericFenced[1].trim();
  }

  // 3. Bare pipe-syntax: lines starting with FROM followed by | lines
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*FROM\b/i.test(lines[i])) {
      start = i;
      break;
    }
  }

  if (start >= 0) {
    const queryLines = [lines[start]];
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*\|/.test(lines[i])) {
        queryLines.push(lines[i]);
      } else {
        break;
      }
    }
    if (queryLines.length > 0) return queryLines.join('\n').trim();
  }

  return null;
}

/**
 * Build Authorization headers for Elasticsearch.
 * Reuses the same env vars as cluster-state evaluator.
 */
export function buildEsHeaders(config?: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const apiKey = (config?.['esApiKey'] as string | undefined) ?? process.env.ES_API_KEY;
  const username = (config?.['esUsername'] as string | undefined) ?? process.env.TEST_ES_USERNAME;
  const password = (config?.['esPassword'] as string | undefined) ?? process.env.TEST_ES_PASSWORD;

  if (apiKey) {
    headers['Authorization'] = `ApiKey ${apiKey}`;
  } else if (username && password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  return headers;
}

/**
 * Resolve the Elasticsearch URL from config or environment.
 */
export function resolveEsUrl(config?: Record<string, unknown>): string | undefined {
  return (
    (config?.['esUrl'] as string | undefined) ??
    process.env.ELASTICSEARCH_URL ??
    process.env.ES_URL
  );
}

/**
 * Execute an ES|QL query against a live Elasticsearch cluster.
 * Returns structured result or error.
 */
export async function executeEsql(
  query: string,
  esUrl: string,
  headers: Record<string, string>,
): Promise<EsqlOutcome> {
  const url = `${esUrl.replace(/\/$/, '')}/_query`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const isIndexNotFound =
        res.status === 400 && (text.includes('index_not_found') || text.includes('Unknown index'));
      return { error: `HTTP ${res.status}: ${text.slice(0, 300)}`, isIndexNotFound };
    }

    const body = (await res.json()) as { columns: Array<{ name: string; type: string }>; values: unknown[][] };
    return { columns: body.columns ?? [], values: body.values ?? [] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
