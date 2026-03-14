import type { McpToolDefinition } from '../core/types.js';
import type { LlmMessage, LlmToolDefinition } from '../layers/llm/llm-client.js';
import { LlmClient } from '../layers/llm/llm-client.js';
import { callJudge } from '../evaluators/llm-judge.js';
import type { UserPersona } from './personas.js';
import { resolvePersona } from './personas.js';

export interface SimulationConfig {
  persona: string | UserPersona;
  goal: string;
  maxTurns?: number;
  tools: McpToolDefinition[];
  agentSystemPrompt?: string;
  agentModel?: string;
  userModel?: string;
}

export interface SimulatedTurn {
  userMessage: string;
  assistantResponse: string;
  toolsCalled: string[];
  turnScore?: number;
}

export interface SimulatedConversation {
  persona: string;
  goal: string;
  turns: SimulatedTurn[];
  goalAchieved: boolean;
}

const DEFAULT_MAX_TURNS = 5;
const DEFAULT_MODEL = 'gpt-5.4';

function mcpToLlmTools(tools: McpToolDefinition[]): LlmToolDefinition[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

function buildUserSimPrompt(persona: UserPersona, goal: string): string {
  return `${persona.systemPrompt}

Your goal in this conversation: ${goal}

Rules:
- Stay in character at all times.
- Send one message at a time as a user would.
- When you believe your goal has been achieved or the assistant has fully addressed your need, respond with exactly "[GOAL_ACHIEVED]" as your final message.
- If after several exchanges the goal is clearly not achievable, respond with exactly "[GOAL_FAILED]".
- Do NOT break character or mention that you are simulating a user.`;
}

async function generateUserMessage(
  client: LlmClient,
  persona: UserPersona,
  goal: string,
  conversationHistory: LlmMessage[],
): Promise<string> {
  const messages: LlmMessage[] = [
    { role: 'system', content: buildUserSimPrompt(persona, goal) },
    ...conversationHistory,
  ];

  const response = await client.converse(messages);
  return response.message.content ?? '';
}

async function generateAgentResponse(
  client: LlmClient,
  systemPrompt: string,
  tools: LlmToolDefinition[],
  conversationHistory: LlmMessage[],
): Promise<{ response: string; toolsCalled: string[] }> {
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
  ];

  const result = await client.converse(messages, tools, 'auto');

  const toolsCalled: string[] = [];
  if (result.message.tool_calls) {
    for (const tc of result.message.tool_calls) {
      toolsCalled.push(tc.function.name);
    }
  }

  return {
    response: result.message.content ?? '(no response)',
    toolsCalled,
  };
}

async function evaluateGoalAchievement(
  goal: string,
  conversation: SimulatedTurn[],
): Promise<boolean> {
  const lastUserMsg = conversation[conversation.length - 1]?.userMessage ?? '';
  if (lastUserMsg.includes('[GOAL_ACHIEVED]')) return true;
  if (lastUserMsg.includes('[GOAL_FAILED]')) return false;

  try {
    const turnSummary = conversation
      .map((t, i) => `Turn ${i + 1}:\nUser: ${t.userMessage}\nAssistant: ${t.assistantResponse}`)
      .join('\n\n');

    const result = await callJudge({
      systemPrompt:
        'You evaluate whether a conversation goal was achieved. Respond with a JSON object: {"achieved": true/false, "reason": "brief explanation"}',
      userPrompt: `Goal: ${goal}\n\nConversation:\n${turnSummary}`,
    });

    const jsonMatch = result.explanation.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { achieved?: boolean };
      return parsed.achieved ?? false;
    }
    return result.score >= 0.5;
  } catch {
    return false;
  }
}

export async function simulateConversation(
  config: SimulationConfig,
): Promise<SimulatedConversation> {
  const persona = resolvePersona(config.persona);
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const agentModel = config.agentModel ?? DEFAULT_MODEL;
  const userModel = config.userModel ?? DEFAULT_MODEL;
  const agentSystemPrompt = config.agentSystemPrompt ?? 'You are a helpful assistant.';

  const userClient = new LlmClient(userModel);
  const agentClient = new LlmClient(agentModel);
  const llmTools = mcpToLlmTools(config.tools);

  const turns: SimulatedTurn[] = [];
  const userHistory: LlmMessage[] = [];
  const agentHistory: LlmMessage[] = [];

  for (let i = 0; i < maxTurns; i++) {
    const userMessage = await generateUserMessage(userClient, persona, config.goal, userHistory);

    if (userMessage.includes('[GOAL_ACHIEVED]') || userMessage.includes('[GOAL_FAILED]')) {
      turns.push({
        userMessage,
        assistantResponse: '',
        toolsCalled: [],
      });
      break;
    }

    agentHistory.push({ role: 'user', content: userMessage });

    const { response, toolsCalled } = await generateAgentResponse(
      agentClient,
      agentSystemPrompt,
      llmTools,
      agentHistory,
    );

    agentHistory.push({ role: 'assistant', content: response });

    userHistory.push({ role: 'assistant', content: userMessage });
    userHistory.push({ role: 'user', content: response });

    turns.push({
      userMessage,
      assistantResponse: response,
      toolsCalled,
    });
  }

  const goalAchieved = await evaluateGoalAchievement(config.goal, turns);

  return {
    persona: persona.name,
    goal: config.goal,
    turns,
    goalAchieved,
  };
}
