import { stringify } from 'yaml';
import type { McpToolDefinition } from '../core/types.js';
import { LlmClient } from '../layers/llm/llm-client.js';
import type { LlmMessage } from '../layers/llm/llm-client.js';

export interface SmartGenConfig {
  tools: McpToolDefinition[];
  count?: number;
  personas?: Array<'novice' | 'expert' | 'adversarial'>;
  multilingual?: string[];
  edgeCases?: boolean;
  model?: string;
}

export interface GeneratedTestCase {
  name: string;
  prompt: string;
  expectedTools: string[];
  difficulty: 'simple' | 'moderate' | 'complex' | 'adversarial';
  persona?: string;
  language?: string;
  category: 'standard' | 'persona' | 'multilingual' | 'edge-case';
}

interface LlmGeneratedPrompt {
  prompt: string;
  difficulty: 'simple' | 'moderate' | 'complex';
}

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  novice:
    'A beginner who uses simple language, may not know technical terms, and describes what they want in vague, everyday words.',
  expert:
    'A power user who uses precise technical terminology, references specific parameters, and expects advanced behavior.',
  adversarial:
    'A user who deliberately tries confusing inputs, misspellings, contradictory instructions, or boundary-pushing requests.',
};

const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Spanish',
  de: 'German',
  ja: 'Japanese',
  fr: 'French',
  pt: 'Portuguese',
  zh: 'Chinese',
  ko: 'Korean',
  it: 'Italian',
  ru: 'Russian',
  ar: 'Arabic',
};

function buildToolDescription(tool: McpToolDefinition): string {
  const params = tool.inputSchema.properties
    ? Object.entries(tool.inputSchema.properties)
        .map(
          ([k, v]) =>
            `  - ${k}: ${(v as { type?: string; description?: string }).type ?? 'any'} — ${(v as { description?: string }).description ?? 'no description'}`,
        )
        .join('\n')
    : '  (no parameters)';

  const required = tool.inputSchema.required?.join(', ') ?? 'none';
  return `Tool: ${tool.name}\nDescription: ${tool.description ?? 'No description'}\nRequired params: ${required}\nParameters:\n${params}`;
}

function buildGenerationPrompt(
  tool: McpToolDefinition,
  count: number,
  variant?: { persona?: string; language?: string; edgeCases?: boolean },
): string {
  const toolDesc = buildToolDescription(tool);
  const parts: string[] = [
    'Generate realistic user prompts that would trigger the use of a specific MCP tool.',
    '',
    toolDesc,
    '',
    `Generate exactly ${count} prompts as a JSON array of objects with fields:`,
    '  - "prompt": the user\'s natural language request',
    '  - "difficulty": one of "simple", "moderate", "complex"',
    '',
    'Rules:',
    '- Prompts must be natural language requests a real user would type.',
    '- Do NOT mention the tool name directly in the prompt.',
    '- Vary the difficulty: simple requests use basic functionality, complex ones combine parameters or require multi-step reasoning.',
  ];

  if (variant?.persona) {
    parts.push(
      '',
      `User persona: ${variant.persona}`,
      PERSONA_DESCRIPTIONS[variant.persona] ?? '',
      'Adjust the language style and complexity to match this persona.',
    );
  }

  if (variant?.language) {
    const langName = LANGUAGE_NAMES[variant.language] ?? variant.language;
    parts.push('', `Write all prompts in ${langName} (language code: ${variant.language}).`);
  }

  if (variant?.edgeCases) {
    parts.push(
      '',
      'Focus on edge cases:',
      '- Empty or minimal inputs',
      '- Very large values or long strings',
      '- Special characters and Unicode',
      '- Ambiguous requests that could match multiple interpretations',
      '- Requests that test boundary conditions of parameters',
    );
  }

  parts.push('', 'Return ONLY a valid JSON array, no markdown fencing or extra text.');

  return parts.join('\n');
}

function parseGeneratedPrompts(raw: string): LlmGeneratedPrompt[] {
  const cleaned = raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is LlmGeneratedPrompt =>
        typeof item === 'object' &&
        item !== null &&
        'prompt' in item &&
        typeof (item as LlmGeneratedPrompt).prompt === 'string',
    );
  } catch (_e) {
    return [];
  }
}

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
}

async function generateForTool(
  llm: LlmClient,
  tool: McpToolDefinition,
  count: number,
  variant?: { persona?: string; language?: string; edgeCases?: boolean },
): Promise<GeneratedTestCase[]> {
  const systemPrompt = buildGenerationPrompt(tool, count, variant);
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Generate the prompts now.' },
  ];

  const response = await llm.converse(messages);
  const generated = parseGeneratedPrompts(response.message.content ?? '');

  let category: GeneratedTestCase['category'] = 'standard';
  if (variant?.persona) category = 'persona';
  if (variant?.language) category = 'multilingual';
  if (variant?.edgeCases) category = 'edge-case';

  return generated.map((g, idx) => ({
    name: `${tool.name}-${category}-${variant?.persona ?? variant?.language ?? 'std'}-${idx + 1}-${slugify(g.prompt)}`,
    prompt: g.prompt,
    expectedTools: [tool.name],
    difficulty: variant?.persona === 'adversarial' ? 'adversarial' : (g.difficulty ?? 'moderate'),
    persona: variant?.persona,
    language: variant?.language,
    category,
  }));
}

export async function generateSmartTests(config: SmartGenConfig): Promise<GeneratedTestCase[]> {
  const count = config.count ?? 5;
  const model = config.model ?? 'gpt-5.2-mini';
  const llm = new LlmClient(model);
  const results: GeneratedTestCase[] = [];

  for (const tool of config.tools) {
    // Standard prompts
    const standard = await generateForTool(llm, tool, count);
    results.push(...standard);

    // Persona variants
    if (config.personas) {
      for (const persona of config.personas) {
        const personaTests = await generateForTool(llm, tool, Math.ceil(count / 2), { persona });
        results.push(...personaTests);
      }
    }

    // Multilingual variants
    if (config.multilingual) {
      for (const lang of config.multilingual) {
        const langTests = await generateForTool(llm, tool, Math.ceil(count / 2), {
          language: lang,
        });
        results.push(...langTests);
      }
    }

    // Edge cases
    if (config.edgeCases) {
      const edgeTests = await generateForTool(llm, tool, Math.ceil(count / 2), {
        edgeCases: true,
      });
      results.push(...edgeTests);
    }
  }

  return results;
}

export function formatSmartTestsAsYaml(tests: GeneratedTestCase[], suiteName: string): string {
  const grouped = new Map<string, GeneratedTestCase[]>();
  for (const test of tests) {
    const key = test.expectedTools[0] ?? 'unknown';
    const existing = grouped.get(key);
    if (existing) {
      existing.push(test);
    } else {
      grouped.set(key, [test]);
    }
  }

  const suites = [];
  for (const [toolName, toolTests] of grouped) {
    suites.push({
      name: `${suiteName}-${toolName}`,
      layer: 'llm',
      tests: toolTests.map((t) => ({
        name: t.name,
        prompt: t.prompt,
        expected: { tools: t.expectedTools },
        evaluators: ['tool-match'],
        ...(t.difficulty ? { difficulty: t.difficulty } : {}),
      })),
    });
  }

  return stringify({ suites }, { lineWidth: 120 });
}
