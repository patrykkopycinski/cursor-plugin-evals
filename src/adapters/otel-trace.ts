import { readFile } from 'node:fs/promises';
import type {
  TaskAdapter,
  Example,
  TaskOutput,
  AdapterConfig,
  ToolCallRecord,
  TokenUsage,
} from '../core/types.js';
import type { ParsedTrace, ParsedSpan, TraceSourceConfig, TraceSource } from '../trace-source/types.js';
import { parseTraces } from '../trace-source/parser.js';
import { createFileTraceSource } from '../trace-source/file.js';
import { createElasticsearchTraceSource } from '../trace-source/elasticsearch.js';

// ---------------------------------------------------------------------------
// Well-known OTel attribute names for extraction
// (The traceMapping config can override these)
// ---------------------------------------------------------------------------

const TOOL_NAME_ATTRS = ['tool.name', 'mcp.tool', 'gen_ai.tool.name'];
const TOOL_ARGS_ATTRS = ['tool.input', 'mcp.tool.input', 'gen_ai.tool.input', 'tool.args'];
const TOOL_RESULT_ATTRS = ['tool.output', 'mcp.tool.output', 'gen_ai.tool.output', 'tool.result'];
const TOOL_ERROR_ATTRS = ['error', 'exception.message'];

const PROMPT_ATTRS = ['gen_ai.prompt', 'llm.input', 'gen_ai.input.messages'];
const COMPLETION_ATTRS = ['gen_ai.completion', 'llm.output', 'gen_ai.output.message'];

const INPUT_TOKEN_ATTRS = ['gen_ai.usage.input_tokens', 'llm.token_count.input', 'llm.usage.prompt_tokens'];
const OUTPUT_TOKEN_ATTRS = ['gen_ai.usage.output_tokens', 'llm.token_count.output', 'llm.usage.completion_tokens'];
const CACHED_TOKEN_ATTRS = ['gen_ai.usage.cache_read_input_tokens', 'llm.token_count.cached'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickAttr(
  attributes: Record<string, unknown>,
  keys: string[],
  mapping?: Record<string, string>,
): unknown {
  for (const key of keys) {
    // Check override mapping first
    const mapped = mapping?.[key];
    if (mapped && attributes[mapped] !== undefined) return attributes[mapped];
    if (attributes[key] !== undefined) return attributes[key];
  }
  return undefined;
}

function pickNumber(
  attributes: Record<string, unknown>,
  keys: string[],
  mapping?: Record<string, string>,
): number | null {
  const val = pickAttr(attributes, keys, mapping);
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function pickString(
  attributes: Record<string, unknown>,
  keys: string[],
  mapping?: Record<string, string>,
): string | null {
  const val = pickAttr(attributes, keys, mapping);
  if (val == null) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function isToolCallSpan(span: ParsedSpan, mapping?: Record<string, string>): boolean {
  // Explicit tool.name attribute
  if (pickAttr(span.attributes, TOOL_NAME_ATTRS, mapping)) return true;
  // Span name convention
  return (
    span.name.startsWith('tool_call') ||
    span.name.startsWith('tool:') ||
    span.name.startsWith('mcp.tool') ||
    span.name.startsWith('tool.')
  );
}

function extractToolName(span: ParsedSpan, mapping?: Record<string, string>): string {
  const fromAttr = pickString(span.attributes, TOOL_NAME_ATTRS, mapping);
  if (fromAttr) return fromAttr;
  // Derive from span name: "tool:read_file" → "read_file"
  return span.name.replace(/^(tool_call[_:]?|tool:|mcp\.tool[_:]?)/, '') || span.name;
}

function safeParseJson(val: unknown): unknown {
  if (typeof val !== 'string') return val ?? {};
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

function extractToolCall(span: ParsedSpan, mapping?: Record<string, string>): ToolCallRecord {
  const toolName = extractToolName(span, mapping);

  const rawArgs = pickAttr(span.attributes, TOOL_ARGS_ATTRS, mapping);
  const args = (safeParseJson(rawArgs) ?? {}) as Record<string, unknown>;

  const rawResult = pickAttr(span.attributes, TOOL_RESULT_ATTRS, mapping);
  const resultText = rawResult != null ? String(rawResult) : '';
  const isError =
    span.status === 'error' ||
    Boolean(pickAttr(span.attributes, TOOL_ERROR_ATTRS, mapping));

  return {
    tool: toolName,
    args,
    result: {
      content: [{ type: 'text', text: resultText }],
      isError: isError || undefined,
    },
    latencyMs: span.duration,
  };
}

interface Message {
  role: string;
  content: string;
}

function extractMessages(spans: ParsedSpan[], mapping?: Record<string, string>): Message[] {
  const messages: Message[] = [];

  // Walk all spans in chronological order, looking for prompt/completion attributes
  const sorted = [...spans].sort((a, b) => a.startTime - b.startTime);

  for (const span of sorted) {
    const prompt = pickString(span.attributes, PROMPT_ATTRS, mapping);
    const completion = pickString(span.attributes, COMPLETION_ATTRS, mapping);

    if (prompt) {
      // Could be a JSON array of messages or a raw string
      const parsed = safeParseJson(prompt);
      if (Array.isArray(parsed)) {
        for (const m of parsed) {
          if (m && typeof m === 'object' && 'role' in m && 'content' in m) {
            messages.push({ role: String(m.role), content: String(m.content) });
          }
        }
      } else {
        messages.push({ role: 'user', content: String(prompt) });
      }
    }

    if (completion) {
      const parsed = safeParseJson(completion);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const content = obj.content ?? obj.text ?? obj.message ?? completion;
        messages.push({ role: 'assistant', content: String(content) });
      } else if (typeof parsed === 'string') {
        messages.push({ role: 'assistant', content: parsed });
      } else {
        messages.push({ role: 'assistant', content: completion });
      }
    }
  }

  return messages;
}

function extractTokenUsage(
  spans: ParsedSpan[],
  mapping?: Record<string, string>,
): TokenUsage | null {
  let input = 0;
  let output = 0;
  let cached = 0;
  let found = false;

  for (const span of spans) {
    const inp = pickNumber(span.attributes, INPUT_TOKEN_ATTRS, mapping);
    const out = pickNumber(span.attributes, OUTPUT_TOKEN_ATTRS, mapping);
    const cch = pickNumber(span.attributes, CACHED_TOKEN_ATTRS, mapping);

    if (inp !== null) { input += inp; found = true; }
    if (out !== null) { output += out; found = true; }
    if (cch !== null) { cached += cch; found = true; }
  }

  if (!found) {
    // Warn once — caller will handle
    return null;
  }

  return { input, output, ...(cached > 0 ? { cached } : {}) };
}

function flattenSpans(root: ParsedSpan): ParsedSpan[] {
  const result: ParsedSpan[] = [root];
  for (const child of root.children) {
    result.push(...flattenSpans(child));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Trace → TaskOutput conversion
// ---------------------------------------------------------------------------

function traceToTaskOutput(
  trace: ParsedTrace,
  traceMapping?: Record<string, string>,
): TaskOutput {
  const allSpans = flattenSpans(trace.rootSpan ?? { ...emptyRootFor(trace), children: trace.spans });

  const toolCallSpans = allSpans.filter((s) => isToolCallSpan(s, traceMapping));
  const toolCalls: ToolCallRecord[] = toolCallSpans
    .sort((a, b) => a.startTime - b.startTime)
    .map((s) => extractToolCall(s, traceMapping));

  const messages = extractMessages(allSpans, traceMapping);

  const tokenUsage = extractTokenUsage(allSpans, traceMapping);

  // Derive final output: last assistant message or last tool result
  let output = '';
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant) {
    output = lastAssistant.content;
  } else if (toolCalls.length > 0) {
    const last = toolCalls[toolCalls.length - 1];
    output = last.result.content.map((c) => c.text ?? '').join('');
  }

  return {
    messages,
    toolCalls,
    output,
    latencyMs: trace.duration,
    tokenUsage,
    adapter: 'otel-trace',
  };
}

/** Create a synthetic root span that wraps all top-level spans */
function emptyRootFor(trace: ParsedTrace): Omit<ParsedSpan, 'children'> {
  return {
    spanId: 'synthetic-root',
    name: 'root',
    startTime: trace.startTime,
    endTime: trace.endTime,
    duration: trace.duration,
    attributes: { 'service.name': trace.serviceName },
    events: [],
    status: 'unset',
  };
}

// ---------------------------------------------------------------------------
// Source factory
// ---------------------------------------------------------------------------

function createTraceSource(config: TraceSourceConfig): TraceSource {
  if (config.type === 'elasticsearch') {
    return createElasticsearchTraceSource(config);
  }
  return createFileTraceSource(config);
}

// ---------------------------------------------------------------------------
// Adapter factory (public API)
// ---------------------------------------------------------------------------

/**
 * Creates a TaskAdapter that reads OTel traces (from file or Elasticsearch)
 * and converts them into TaskOutput for evaluation by existing evaluators.
 *
 * Extra config fields:
 *   config.traceSource  — TraceSourceConfig (required)
 *   config.traceMapping — optional map of attribute-name overrides
 *
 * Example input shapes handled:
 *   { traceId: "abc123" }                  — fetch from traceSource by ID
 *   { traceFile: "/path/to/trace.json" }   — parse a one-off file directly
 */
export function createOtelTraceAdapter(config: AdapterConfig): TaskAdapter {
  const traceSourceConfig = config['traceSource'] as TraceSourceConfig | undefined;
  const traceMapping = config['traceMapping'] as Record<string, string> | undefined;

  // Lazily initialise the trace source so construction errors surface at run time
  let traceSource: TraceSource | null = null;

  function getSource(): TraceSource {
    if (!traceSource) {
      if (!traceSourceConfig) {
        throw new Error(
          '[otel-trace] AdapterConfig.traceSource is required. ' +
            'Provide a TraceSourceConfig with type: "file" or "elasticsearch".',
        );
      }
      traceSource = createTraceSource(traceSourceConfig);
    }
    return traceSource;
  }

  return async (example: Example): Promise<TaskOutput> => {
    const startTime = Date.now();

    const { traceId, traceFile } = example.input as {
      traceId?: string;
      traceFile?: string;
    };

    let trace: ParsedTrace | null = null;

    if (traceFile) {
      // One-off file path supplied directly on the example — parse without a source
      let raw: unknown;
      try {
        const content = await readFile(traceFile, 'utf-8');
        raw = JSON.parse(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`[otel-trace] Trace file not found: "${traceFile}"`);
        }
        throw new Error(`[otel-trace] Failed to read/parse trace file "${traceFile}": ${msg}`);
      }

      const format = (traceSourceConfig?.format) ?? 'auto';
      const traces = parseTraces(raw, format);
      if (traces.length === 0) {
        throw new Error(`[otel-trace] No traces found in file "${traceFile}".`);
      }

      // If traceId also given, pick that specific trace; otherwise take first
      if (traceId) {
        trace = traces.find((t) => t.traceId === traceId) ?? null;
        if (!trace) {
          throw new Error(
            `[otel-trace] traceId "${traceId}" not found in file "${traceFile}". ` +
              `Available IDs: ${traces.map((t) => t.traceId).join(', ')}`,
          );
        }
      } else {
        trace = traces[0];
        if (traces.length > 1) {
          console.warn(
            `[otel-trace] "${traceFile}" contains ${traces.length} traces. ` +
              `Using the first one (traceId: "${trace.traceId}"). ` +
              `Pass example.input.traceId to select a specific trace.`,
          );
        }
      }
    } else if (traceId) {
      trace = await getSource().getTrace(traceId);
      if (!trace) {
        throw new Error(
          `[otel-trace] Trace "${traceId}" not found via source "${getSource().name}".`,
        );
      }
    } else {
      throw new Error(
        '[otel-trace] example.input must contain either "traceId" or "traceFile".',
      );
    }

    const output = traceToTaskOutput(trace, traceMapping);

    // Override latency with wall-clock time if trace had no useful timing
    if (output.latencyMs === 0) {
      output.latencyMs = Date.now() - startTime;
    }

    return output;
  };
}
