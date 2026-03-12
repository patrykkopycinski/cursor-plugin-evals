import type { McpToolDefinition } from '../core/types.js';

interface GeneratedTest {
  name: string;
  prompt: string;
  expected_tools: string[];
}

export function buildTestGenerationPrompt(tools: McpToolDefinition[]): string {
  const toolDescriptions = tools
    .map((t) => {
      const params = t.inputSchema.properties
        ? Object.keys(t.inputSchema.properties).join(', ')
        : 'none';
      return `- **${t.name}**: ${t.description ?? 'No description'} (params: ${params})`;
    })
    .join('\n');

  return [
    'You are a test generator for MCP (Model Context Protocol) tools.',
    'Given the following tool definitions, generate test cases that verify an LLM can correctly select and use each tool.',
    '',
    '## Available Tools',
    '',
    toolDescriptions,
    '',
    '## Instructions',
    '',
    'For each tool, generate one test case as a JSON object with:',
    '- `name`: a descriptive test name (kebab-case)',
    '- `prompt`: a natural language prompt that should trigger use of the tool',
    '- `expected_tools`: array with the tool name that should be selected',
    '',
    'Output a JSON array of test objects. Only output the JSON array, nothing else.',
  ].join('\n');
}

export function parseGeneratedTests(response: string): GeneratedTest[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).prompt === 'string' &&
        Array.isArray((item as Record<string, unknown>).expected_tools),
    )
    .map((item) => ({
      name: String(item.name),
      prompt: String(item.prompt),
      expected_tools: (item.expected_tools as unknown[]).map(String),
      difficulty: 'simple' as const,
    }));
}
