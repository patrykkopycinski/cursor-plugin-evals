import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePersona, BUILT_IN_PERSONAS } from './personas.js';
import { formatAsConversationYaml } from './formatter.js';
import type { SimulatedConversation } from './simulator.js';

describe('resolvePersona', () => {
  it('resolves built-in persona by name', () => {
    const persona = resolvePersona('novice');
    expect(persona.name).toBe('novice');
    expect(persona.traits).toContain('vague');
    expect(persona.systemPrompt).toBeTruthy();
  });

  it('resolves all built-in personas', () => {
    for (const p of BUILT_IN_PERSONAS) {
      const resolved = resolvePersona(p.name);
      expect(resolved).toBe(p);
    }
  });

  it('throws for unknown persona name', () => {
    expect(() => resolvePersona('unknown-persona')).toThrow('Unknown persona "unknown-persona"');
  });

  it('returns custom persona object as-is', () => {
    const custom = {
      name: 'custom',
      description: 'Custom test persona',
      traits: ['specific'],
      systemPrompt: 'You are a custom user.',
    };
    const resolved = resolvePersona(custom);
    expect(resolved).toBe(custom);
  });

  it('includes available persona names in error message', () => {
    try {
      resolvePersona('bogus');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('novice');
      expect(msg).toContain('expert');
      expect(msg).toContain('adversarial');
      expect(msg).toContain('impatient');
    }
  });
});

describe('BUILT_IN_PERSONAS', () => {
  it('has exactly 4 built-in personas', () => {
    expect(BUILT_IN_PERSONAS).toHaveLength(4);
  });

  it('each persona has required fields', () => {
    for (const persona of BUILT_IN_PERSONAS) {
      expect(persona.name).toBeTruthy();
      expect(persona.description).toBeTruthy();
      expect(persona.traits.length).toBeGreaterThan(0);
      expect(persona.systemPrompt.length).toBeGreaterThan(10);
    }
  });

  it('persona names are unique', () => {
    const names = BUILT_IN_PERSONAS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('formatAsConversationYaml', () => {
  const sampleConversation: SimulatedConversation = {
    persona: 'novice',
    goal: 'create an index',
    turns: [
      {
        userMessage: 'How do I create an index?',
        assistantResponse: 'You can use the create index API...',
        toolsCalled: ['elasticsearch_api'],
      },
      {
        userMessage: 'What settings should I use?',
        assistantResponse: 'For a basic index, you can use...',
        toolsCalled: [],
      },
      {
        userMessage: '[GOAL_ACHIEVED]',
        assistantResponse: '',
        toolsCalled: [],
      },
    ],
    goalAchieved: true,
  };

  it('produces valid YAML output', () => {
    const yaml = formatAsConversationYaml([sampleConversation]);
    expect(yaml).toContain('suites:');
    expect(yaml).toContain('layer: llm');
    expect(yaml).toContain('type: conversation');
  });

  it('uses persona name in suite naming', () => {
    const yaml = formatAsConversationYaml([sampleConversation]);
    expect(yaml).toContain('novice-create-an-index');
  });

  it('includes follow-up turns excluding terminal messages', () => {
    const yaml = formatAsConversationYaml([sampleConversation]);
    expect(yaml).toContain('What settings should I use?');
    expect(yaml).not.toContain('[GOAL_ACHIEVED]');
  });

  it('uses provided evaluators', () => {
    const yaml = formatAsConversationYaml([sampleConversation], ['tool_selection', 'coherence']);
    expect(yaml).toContain('tool_selection');
    expect(yaml).toContain('coherence');
  });

  it('handles multiple conversations', () => {
    const second: SimulatedConversation = {
      persona: 'expert',
      goal: 'configure shards',
      turns: [
        {
          userMessage: 'Set primary shards to 3',
          assistantResponse: 'Done.',
          toolsCalled: ['elasticsearch_api'],
        },
      ],
      goalAchieved: true,
    };

    const yaml = formatAsConversationYaml([sampleConversation, second]);
    expect(yaml).toContain('novice-create-an-index');
    expect(yaml).toContain('expert-configure-shards');
  });

  it('skips conversations with no turns', () => {
    const empty: SimulatedConversation = {
      persona: 'novice',
      goal: 'empty goal',
      turns: [],
      goalAchieved: false,
    };

    const yaml = formatAsConversationYaml([empty]);
    expect(yaml).not.toContain('novice-empty-goal');
  });

  it('defaults evaluators to conversation_coherence', () => {
    const yaml = formatAsConversationYaml([sampleConversation]);
    expect(yaml).toContain('conversation_coherence');
  });
});
