import type { McpToolDefinition } from '../../core/types.js';

export function buildSystemPrompt(
  pluginName: string,
  tools: McpToolDefinition[],
  customInstruction?: string,
): string {
  const toolList = tools
    .map((t) => `- **${t.name}**: ${t.description ?? 'No description'}`)
    .join('\n');

  const sections = [
    `You are a testing agent for the "${pluginName}" MCP plugin.`,
    '',
    'You have access to the following tools:',
    toolList,
    '',
    'Instructions:',
    "- Use the available tools to accomplish the user's request.",
    '- Call tools with properly structured JSON arguments matching their schemas.',
    '- When you have gathered enough information, provide a final text response summarizing what you found or accomplished.',
    '- Be precise and concise in your responses.',
  ];

  if (customInstruction) {
    sections.push('', 'Additional context:', customInstruction);
  }

  return sections.join('\n');
}
