import { stringify } from 'yaml';
import type { ParsedTrace, ParsedSpan } from './parser.js';

interface YamlTest {
  name: string;
  tool?: string;
  args?: Record<string, unknown>;
  prompt?: string;
  expected?: {
    tools?: string[];
    response_contains?: string[];
  };
  evaluators?: string[];
}

interface YamlSuite {
  name: string;
  layer: string;
  tests: YamlTest[];
}

function sanitizeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80);
}

function buildIntegrationTest(span: ParsedSpan, index: number): YamlTest {
  return {
    name: `trace-${sanitizeName(span.toolName!)}-${index}`,
    tool: span.toolName!,
    args: span.toolArgs ?? {},
  };
}

function buildLlmTest(span: ParsedSpan, index: number, toolSpans: ParsedSpan[]): YamlTest {
  const prompt = span.parentPrompt ?? span.name;
  const expectedTools = toolSpans
    .filter((s) => s.toolName)
    .map((s) => s.toolName!);

  const test: YamlTest = {
    name: `trace-llm-${index}`,
    prompt,
    evaluators: ['tool-selection', 'response-quality'],
  };

  if (expectedTools.length > 0) {
    test.expected = { tools: [...new Set(expectedTools)] };
  }

  return test;
}

export function generateTestsFromTrace(
  trace: ParsedTrace,
  options: { llm?: boolean } = {},
): string {
  const toolSpans = trace.spans.filter((s) => s.toolName);
  const promptSpans = trace.spans.filter((s) => s.parentPrompt && !s.toolName);

  const suites: YamlSuite[] = [];

  if (toolSpans.length > 0) {
    suites.push({
      name: `trace-${trace.traceId.slice(0, 8)}-integration`,
      layer: 'integration',
      tests: toolSpans.map((span, i) => buildIntegrationTest(span, i)),
    });
  }

  if (options.llm && promptSpans.length > 0) {
    suites.push({
      name: `trace-${trace.traceId.slice(0, 8)}-llm`,
      layer: 'llm',
      tests: promptSpans.map((span, i) => buildLlmTest(span, i, toolSpans)),
    });
  }

  if (suites.length === 0) {
    suites.push({
      name: `trace-${trace.traceId.slice(0, 8)}-empty`,
      layer: 'integration',
      tests: [],
    });
  }

  return stringify({ suites }, { lineWidth: 120 });
}
