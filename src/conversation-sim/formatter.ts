import { stringify } from 'yaml';
import type { SimulatedConversation } from './simulator.js';

interface YamlConversationTest {
  name: string;
  layer: 'llm';
  tests: Array<{
    name: string;
    type: 'conversation';
    prompt: string;
    system?: string;
    turns: Array<{ prompt: string }>;
    evaluators: string[];
    expected: { responseContains?: string[] };
  }>;
}

export function formatAsConversationYaml(
  conversations: SimulatedConversation[],
  evaluators: string[] = ['conversation_coherence'],
): string {
  const suites: YamlConversationTest[] = [];

  for (const conv of conversations) {
    const firstTurn = conv.turns[0];
    if (!firstTurn) continue;

    const followUpTurns = conv.turns
      .slice(1)
      .filter((t) => t.userMessage && !t.userMessage.includes('[GOAL_'));

    suites.push({
      name: `${conv.persona}-${slugify(conv.goal)}`,
      layer: 'llm',
      tests: [
        {
          name: `${conv.persona}-goal-${slugify(conv.goal)}`,
          type: 'conversation',
          prompt: firstTurn.userMessage,
          turns: followUpTurns.map((t) => ({ prompt: t.userMessage })),
          evaluators,
          expected: {},
        },
      ],
    });
  }

  return stringify({ suites }, { lineWidth: 120 });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
