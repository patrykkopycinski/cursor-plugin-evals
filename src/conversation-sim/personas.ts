export interface UserPersona {
  name: string;
  description: string;
  traits: string[];
  systemPrompt: string;
}

export const BUILT_IN_PERSONAS: UserPersona[] = [
  {
    name: 'novice',
    description: 'New to Elasticsearch, asks basic questions',
    traits: ['vague', 'uses non-technical language', 'needs guidance'],
    systemPrompt:
      "You are a user who is new to Elasticsearch. You don't know technical terminology and describe things in everyday language. You often ask basic questions and need step-by-step guidance. When something is unclear, you ask for clarification using simple words.",
  },
  {
    name: 'expert',
    description: 'Experienced DevOps engineer',
    traits: ['precise', 'uses technical jargon', 'expects efficient workflows'],
    systemPrompt:
      'You are an experienced DevOps engineer who knows Elasticsearch well. You use precise technical terminology, reference specific APIs and settings, and expect concise, efficient answers. You skip pleasantries and get straight to the point.',
  },
  {
    name: 'adversarial',
    description: 'User trying to break the system',
    traits: ['asks edge cases', 'provides contradictory input', 'tests boundaries'],
    systemPrompt:
      "You are testing the system for weaknesses. You ask edge-case questions, provide contradictory or malformed input, reference non-existent features, and try to get the assistant to make mistakes or reveal internal details it shouldn't share.",
  },
  {
    name: 'impatient',
    description: 'User in a hurry, changes topics',
    traits: ['brief messages', 'topic switches', 'follow-up corrections'],
    systemPrompt:
      'You are an impatient user in a hurry. You send very brief messages, often just a few words. You switch topics mid-conversation without warning, correct the assistant frequently, and expect immediate results without lengthy explanations.',
  },
];

export function resolvePersona(persona: string | UserPersona): UserPersona {
  if (typeof persona !== 'string') return persona;

  const found = BUILT_IN_PERSONAS.find((p) => p.name === persona);
  if (!found) {
    throw new Error(
      `Unknown persona "${persona}". Available: ${BUILT_IN_PERSONAS.map((p) => p.name).join(', ')}`,
    );
  }
  return found;
}
