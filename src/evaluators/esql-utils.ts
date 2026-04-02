import type { ToolCallRecord } from '../core/types.js';

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
/**
 * If a block contains multiple ES|QL queries (multiple FROM/TS source commands),
 * return only the first complete query. ES|QL allows exactly one source command.
 */
function takeFirstQuery(raw: string): string {
  const lines = raw.split('\n');
  const sourcePattern = /^\s*(?:FROM|TS)\b/i;
  let foundFirst = false;
  const result: string[] = [];

  for (const line of lines) {
    if (sourcePattern.test(line)) {
      if (foundFirst) break; // Second query starts — stop
      foundFirst = true;
    }
    if (foundFirst) result.push(line);
  }

  return result.length > 0 ? result.join('\n').trim() : raw.trim();
}

export function extractEsql(text: string): string | null {
  // 1. ```esql fenced block
  const esqlFenced = text.match(/```esql\s*\n([\s\S]*?)```/i);
  if (esqlFenced) return takeFirstQuery(esqlFenced[1]);

  // 2. Generic fenced block containing FROM or TS keyword
  const genericFenced = text.match(/```\s*\n([\s\S]*?)```/);
  if (genericFenced && /\b(?:FROM|TS)\b/i.test(genericFenced[1])) {
    return takeFirstQuery(genericFenced[1]);
  }

  // 3. Bare pipe-syntax: lines starting with FROM or TS followed by | lines
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:FROM|TS)\b/i.test(lines[i])) {
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
 * Unescape a query string extracted from shell command arguments.
 * Handles escaped quotes, newlines, and backslashes from shell quoting.
 */
function unescapeQuery(raw: string): string {
  return raw.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

/**
 * Extract ES|QL from tool calls (agent mode).
 *
 * When the model uses Bash/shell to run queries via `scripts/esql.js raw "..."`,
 * the ES|QL lives in the command args, not in the text output. This function
 * finds the LAST successful `esql.js raw` invocation and extracts the query.
 * We use the last one because agents often refine their queries across turns.
 */
export function extractEsqlFromToolCalls(toolCalls: ToolCallRecord[]): string | null {
  let lastQuery: string | null = null;

  for (const tc of toolCalls) {
    if (tc.tool !== 'shell') continue;
    const cmd = (tc.args.command ?? tc.args.input) as string | undefined;
    if (!cmd) continue;

    // Match: node scripts/esql.js raw "QUERY" or esql.js raw "QUERY"
    const rawMatch = cmd.match(/esql\.js\s+raw\s+"((?:[^"\\]|\\.)*)"/);
    if (rawMatch) {
      const query = unescapeQuery(rawMatch[1]);
      if (/\b(?:FROM|TS)\b/i.test(query)) {
        // Only keep if the tool call didn't error
        if (!tc.result.isError) {
          lastQuery = query;
        }
      }
    }

    // Also match: node scripts/esql.js raw 'QUERY'
    const rawMatchSingle = cmd.match(/esql\.js\s+raw\s+'((?:[^'\\]|\\.)*)'/);
    if (rawMatchSingle) {
      const query = unescapeQuery(rawMatchSingle[1]);
      if (/\b(?:FROM|TS)\b/i.test(query)) {
        if (!tc.result.isError) {
          lastQuery = query;
        }
      }
    }
  }

  return lastQuery;
}

/**
 * Extract ES|QL from either text output or tool calls.
 * Prefers text extraction (explicit query in response) over tool call extraction.
 */
export function extractEsqlFull(
  text: string,
  toolCalls?: ToolCallRecord[],
): string | null {
  const fromText = extractEsql(text);
  if (fromText) return fromText;

  if (toolCalls?.length) {
    const fromToolCalls = extractEsqlFromToolCalls(toolCalls);
    if (fromToolCalls) return fromToolCalls;

    // Fallback: look for ES|QL in any shell command argument (broader match)
    for (let i = toolCalls.length - 1; i >= 0; i--) {
      const tc = toolCalls[i];
      if (tc.tool !== 'shell' || tc.result.isError) continue;
      const cmd = (tc.args.command ?? tc.args.input) as string | undefined;
      if (!cmd) continue;

      // Match ES|QL in curl -d '{"query":"FROM ..."}' patterns
      const curlMatch = cmd.match(/"query"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (curlMatch) {
        const query = curlMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
        if (/\b(?:FROM|TS)\b/i.test(query)) return query;
      }

      // Match bare FROM/TS in command args (e.g., echo "FROM ... | LIMIT 5")
      const fromMatch = cmd.match(/(?:^|\s|")((?:FROM|TS)\s+\S+(?:\s*\|[^"]*)*)/i);
      if (fromMatch) {
        const query = fromMatch[1].trim();
        if (query.length > 10) return query;
      }
    }

    // Check Agent/subagent tool results — these may contain ES|QL in their output
    for (let i = toolCalls.length - 1; i >= 0; i--) {
      const tc = toolCalls[i];
      if (tc.tool === 'shell' || tc.result.isError) continue;
      const resultText = tc.result.content
        ?.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      if (resultText) {
        const fromResult = extractEsql(resultText);
        if (fromResult) return fromResult;
      }
      // Also check tool args for ES|QL (e.g., Agent prompt containing a query)
      const argText = (tc.args.prompt ?? tc.args.message ?? tc.args.text) as string | undefined;
      if (argText) {
        const fromArgs = extractEsql(argText);
        if (fromArgs) return fromArgs;
      }
    }

    // Last resort: check shell tool call RESULTS for ES|QL output text
    for (let i = toolCalls.length - 1; i >= 0; i--) {
      const tc = toolCalls[i];
      if (tc.tool !== 'shell' || tc.result.isError) continue;
      const resultText = tc.result.content
        ?.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      if (resultText) {
        const fromResult = extractEsql(resultText);
        if (fromResult) return fromResult;
      }
    }
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
 * Strip SQL-style line comments (-- ...) from an ES|QL query.
 * The model sometimes annotates queries with inline comments which
 * ES|QL does not support, causing parse errors.
 */
function stripSqlComments(query: string): string {
  return query
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trimEnd())
    .filter((line) => line.length > 0)
    .join('\n');
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
  const cleanQuery = stripSqlComments(query);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: cleanQuery }),
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
