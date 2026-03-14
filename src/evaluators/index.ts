import type { Evaluator } from '../core/types.js';

import { ToolSelectionEvaluator } from './tool-selection.js';
import { ToolArgsEvaluator } from './tool-args.js';
import { ToolSequenceEvaluator } from './tool-sequence.js';
import { ResponseQualityEvaluator } from './response-quality.js';
import { ClusterStateEvaluator } from './cluster-state.js';
import { McpProtocolEvaluator } from './mcp-protocol.js';
import { SecurityEvaluator } from './security.js';
import { ToolPoisoningEvaluator } from './tool-poisoning.js';
import { SkillTriggerEvaluator } from './skill-trigger.js';
import { ContentQualityEvaluator } from './content-quality.js';
import { PathEfficiencyEvaluator } from './path-efficiency.js';
import { CorrectnessEvaluator } from './correctness.js';
import { GroundednessEvaluator } from './groundedness.js';
import { GEvalEvaluator } from './g-eval.js';
import { KeywordsEvaluator } from './keywords.js';
import { SimilarityEvaluator } from './similarity.js';
import { ContextFaithfulnessEvaluator } from './context-faithfulness.js';
import { ConversationCoherenceEvaluator } from './conversation-coherence.js';
import { CriteriaEvaluator } from './criteria.js';
import { RagEvaluator } from './rag.js';
import { PlanQualityEvaluator } from './plan-quality.js';
import { TaskCompletionEvaluator } from './task-completion.js';
import { TrajectoryEvaluator } from './trajectory.js';
import { VisualRegressionEvaluator } from './visual-regression.js';
import { TokenUsageEvaluator } from './token-usage.js';
import { WorkflowEvaluator } from './workflow.js';
import { ResistanceEvaluator } from './resistance.js';

export const EVALUATOR_NAMES = [
  'tool-selection',
  'tool-args',
  'tool-sequence',
  'response-quality',
  'cluster-state',
  'mcp-protocol',
  'security',
  'tool-poisoning',
  'skill-trigger',
  'content-quality',
  'path-efficiency',
  'correctness',
  'groundedness',
  'g-eval',
  'keywords',
  'similarity',
  'context-faithfulness',
  'conversation-coherence',
  'criteria',
  'rag',
  'plan-quality',
  'task-completion',
  'visual-regression',
  'trajectory',
  'token-usage',
  'workflow',
  'resistance',
] as const;

export type EvaluatorName = (typeof EVALUATOR_NAMES)[number];

const EVALUATOR_MAP: Record<EvaluatorName, new () => Evaluator> = {
  'tool-selection': ToolSelectionEvaluator,
  'tool-args': ToolArgsEvaluator,
  'tool-sequence': ToolSequenceEvaluator,
  'response-quality': ResponseQualityEvaluator,
  'cluster-state': ClusterStateEvaluator,
  'mcp-protocol': McpProtocolEvaluator,
  security: SecurityEvaluator,
  'tool-poisoning': ToolPoisoningEvaluator,
  'skill-trigger': SkillTriggerEvaluator,
  'content-quality': ContentQualityEvaluator,
  'path-efficiency': PathEfficiencyEvaluator,
  correctness: CorrectnessEvaluator,
  groundedness: GroundednessEvaluator,
  'g-eval': GEvalEvaluator,
  keywords: KeywordsEvaluator,
  similarity: SimilarityEvaluator,
  'context-faithfulness': ContextFaithfulnessEvaluator,
  'conversation-coherence': ConversationCoherenceEvaluator,
  criteria: CriteriaEvaluator,
  rag: RagEvaluator,
  'plan-quality': PlanQualityEvaluator,
  'task-completion': TaskCompletionEvaluator,
  'visual-regression': VisualRegressionEvaluator,
  trajectory: TrajectoryEvaluator,
  'token-usage': TokenUsageEvaluator,
  workflow: WorkflowEvaluator,
  resistance: ResistanceEvaluator,
};

export function createEvaluator(name: string): Evaluator {
  const Ctor = EVALUATOR_MAP[name as EvaluatorName];
  if (!Ctor) {
    throw new Error(`Unknown evaluator "${name}". Available: ${EVALUATOR_NAMES.join(', ')}`);
  }
  return new Ctor();
}

export {
  ToolSelectionEvaluator,
  ToolArgsEvaluator,
  ToolSequenceEvaluator,
  ResponseQualityEvaluator,
  ClusterStateEvaluator,
  McpProtocolEvaluator,
  SecurityEvaluator,
  ToolPoisoningEvaluator,
  SkillTriggerEvaluator,
  ContentQualityEvaluator,
  PathEfficiencyEvaluator,
  CorrectnessEvaluator,
  GroundednessEvaluator,
  GEvalEvaluator,
  KeywordsEvaluator,
  SimilarityEvaluator,
  ContextFaithfulnessEvaluator,
  ConversationCoherenceEvaluator,
  CriteriaEvaluator,
  RagEvaluator,
  PlanQualityEvaluator,
  TaskCompletionEvaluator,
  VisualRegressionEvaluator,
  TrajectoryEvaluator,
  TokenUsageEvaluator,
  WorkflowEvaluator,
  ResistanceEvaluator,
};

export type {
  TokenUsageConfig,
  WorkflowConfig,
  SecurityConfig,
  GroundednessConfig,
} from './config-schemas.js';
export {
  resolveTokenUsageConfig,
  resolveWorkflowConfig,
  resolveSecurityConfig,
  resolveGroundednessConfig,
} from './config-schemas.js';
