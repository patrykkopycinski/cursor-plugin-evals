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
import { ScriptEvaluator } from './script.js';
import { EsqlExecutionEvaluator } from './esql-execution.js';
import { EsqlPatternEvaluator } from './esql-pattern.js';
import { EsqlResultEvaluator } from './esql-result.js';
import { NlScorerEvaluator } from './nl-scorer.js';
import { SkillRoutingEvaluator } from './skill-routing.js';
import { SkillDescriptionEvaluator } from './skill-description.js';
import { SkillComposabilityEvaluator } from './skill-composability.js';
import { CustomEvaluator, type CustomEvaluatorConfig } from './custom-evaluator.js';
import { agentEfficiencyEvaluator } from './agent-efficiency.js';

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
  'script',
  'esql-execution',
  'esql-pattern',
  'esql-result',
  'nl-scorer',
  'skill-routing',
  'skill-description',
  'skill-composability',
  'custom',
  'agent-efficiency',
] as const;

export type EvaluatorName = (typeof EVALUATOR_NAMES)[number];

const EVALUATOR_MAP: Record<Exclude<EvaluatorName, 'custom' | 'agent-efficiency'>, new () => Evaluator> = {
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
  script: ScriptEvaluator,
  'esql-execution': EsqlExecutionEvaluator,
  'esql-pattern': EsqlPatternEvaluator,
  'esql-result': EsqlResultEvaluator,
  'nl-scorer': NlScorerEvaluator,
  'skill-routing': SkillRoutingEvaluator,
  'skill-description': SkillDescriptionEvaluator,
  'skill-composability': SkillComposabilityEvaluator,
};

export function createEvaluator(name: string, config?: Record<string, unknown>): Evaluator {
  if (name === 'agent-efficiency') {
    return agentEfficiencyEvaluator;
  }
  if (name === 'custom') {
    return new CustomEvaluator({
      path: (config?.path as string) ?? '',
      name: config?.name as string | undefined,
      threshold: config?.threshold as number | undefined,
      timeout: config?.timeout as number | undefined,
      config: config?.config as Record<string, unknown> | undefined,
      runtime: config?.runtime as CustomEvaluatorConfig['runtime'],
    });
  }
  const Ctor = EVALUATOR_MAP[name as Exclude<EvaluatorName, 'custom' | 'agent-efficiency'>];
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
  ScriptEvaluator,
  EsqlExecutionEvaluator,
  EsqlPatternEvaluator,
  EsqlResultEvaluator,
  NlScorerEvaluator,
  SkillRoutingEvaluator,
  SkillDescriptionEvaluator,
  SkillComposabilityEvaluator,
  CustomEvaluator,
};

export type { CustomEvaluatorConfig } from './custom-evaluator.js';
export type {
  CustomEvalInput,
  CustomEvalOutput,
  EvaluatorManifest,
} from './custom-protocol.js';
export { PROTOCOL_VERSION as CUSTOM_EVAL_PROTOCOL_VERSION } from './custom-protocol.js';
export { agentEfficiencyEvaluator } from './agent-efficiency.js';
export type { EvalCondition } from './eval-condition.js';
export { shouldRunEvaluator } from './eval-condition.js';

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
