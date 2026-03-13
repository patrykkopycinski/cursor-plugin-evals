# Conversation Simulation

Generate realistic multi-turn conversations by simulating users with distinct personas, then export them as YAML test suites.

## Built-In Personas

| Persona | Description | Traits |
|---------|-------------|--------|
| `novice` | New user, asks basic questions | Vague, non-technical language, needs guidance |
| `expert` | Experienced DevOps engineer | Precise technical jargon, expects efficiency |
| `adversarial` | Testing system boundaries | Edge cases, contradictory input, probes weaknesses |
| `impatient` | User in a hurry | Brief messages, topic switches, follow-up corrections |

## Custom Personas

Define your own persona by providing a `UserPersona` object:

```typescript
import type { UserPersona } from 'cursor-plugin-evals';

const customPersona: UserPersona = {
  name: 'security-auditor',
  description: 'Security professional testing access controls',
  traits: ['methodical', 'probes authorization', 'asks about audit logs'],
  systemPrompt: 'You are a security auditor testing an Elasticsearch assistant. Methodically probe access controls, ask about audit logging, and test authorization boundaries.',
};
```

## Goal-Based Simulation

Each simulation has a `goal` that drives the conversation. The simulated user works toward the goal, sending messages in character until the goal is achieved or the turn limit is reached.

```bash
cursor-plugin-evals gen-conversations \
  --persona expert \
  --goal "Set up APM monitoring for a Node.js service" \
  --turns 8 \
  --count 3 \
  -o conversations.yaml
```

The simulated user signals goal completion with `[GOAL_ACHIEVED]` or failure with `[GOAL_FAILED]`.

## Output as YAML Tests

Generated conversations are exported as `conversation`-type LLM tests:

```yaml
suites:
  - name: simulated-conversations
    layer: llm
    tests:
      - name: sim-expert-apm-0
        type: conversation
        prompt: "I need to set up APM for my Node.js service running in Kubernetes"
        evaluators: [conversation-coherence]
        turns:
          - prompt: "What's the recommended agent configuration for high-throughput services?"
            evaluators: [conversation-coherence]
          - prompt: "Set the sample rate to 0.1 and enable distributed tracing"
            expected:
              tools: [elasticsearch_api]
            evaluators: [conversation-coherence, tool-selection]
```

## CLI Usage

```bash
# Generate one conversation with a novice persona
cursor-plugin-evals gen-conversations \
  --persona novice \
  --goal "Find error logs from the last 24 hours" \
  --turns 5

# Generate multiple conversations
cursor-plugin-evals gen-conversations \
  --persona adversarial \
  --goal "Try to delete all indices" \
  --turns 10 \
  --count 5 \
  -o adversarial-convos.yaml

# Use a specific model for simulation
cursor-plugin-evals gen-conversations \
  --persona expert \
  --goal "Create a dashboard with CPU and memory panels" \
  -m gpt-4o \
  -o dashboard-convos.yaml
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--persona <name>` | `novice` | User persona (novice, expert, adversarial, impatient) |
| `--goal <text>` | *required* | What the simulated user wants to achieve |
| `--turns <n>` | `5` | Max turns per conversation |
| `--count <n>` | `1` | Number of conversations to generate |
| `-m, --model <model>` | — | LLM model for user simulation |
| `-o, --output <path>` | — | Write YAML to file |

## Programmatic API

```typescript
import {
  simulateConversation, resolvePersona, BUILT_IN_PERSONAS,
  formatAsConversationYaml,
} from 'cursor-plugin-evals';
import type { SimulationConfig, SimulatedConversation } from 'cursor-plugin-evals';

// List built-in personas
for (const p of BUILT_IN_PERSONAS) {
  console.log(`${p.name}: ${p.description}`);
}

// Simulate a conversation
const config: SimulationConfig = {
  persona: 'expert',
  goal: 'Set up index lifecycle management for logs',
  maxTurns: 8,
  tools: mcpTools, // from McpPluginClient.listTools()
};

const conversation: SimulatedConversation = await simulateConversation(config);

console.log(`Persona: ${conversation.persona}`);
console.log(`Goal achieved: ${conversation.goalAchieved}`);
console.log(`Turns: ${conversation.turns.length}`);

for (const turn of conversation.turns) {
  console.log(`  User: ${turn.userMessage.slice(0, 80)}...`);
  console.log(`  Agent: ${turn.assistantResponse.slice(0, 80)}...`);
  console.log(`  Tools: ${turn.toolsCalled.join(', ') || '(none)'}`);
}

// Export as YAML test suite
const yaml = formatAsConversationYaml([conversation], ['conversation-coherence']);
console.log(yaml);
```

## See Also

- [Multi-Turn Conversations](./conversations.md) — testing existing conversation definitions
- [Prompt Sensitivity](./prompt-sensitivity.md)
- [LLM Eval Layer](./layers/llm.md)
