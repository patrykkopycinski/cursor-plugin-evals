import type { TestResult, ToolCallRecord } from '../core/types.js';

export type FailureCategory =
  | 'plan_adherence'        // Agent ignored its own plan/instructions
  | 'tool_misuse'           // Called wrong tool or wrong arguments
  | 'hallucination'         // Invented information not in context
  | 'loop_detection'        // Repeated same action without progress
  | 'error_handling'        // Failed to recover from tool errors
  | 'premature_termination' // Stopped before completing the task
  | 'context_overflow'      // Lost track of earlier context/instructions
  | 'safety_violation'      // Attempted unsafe/unauthorized action
  | 'unknown';              // Could not classify

export interface FailureDiagnosis {
  category: FailureCategory;
  confidence: number;         // 0-1
  criticalStepIndex: number;  // index in toolCalls where failure occurred (-1 if no tools)
  criticalStepTool: string | null;
  explanation: string;
  suggestion: string;
}

export interface FailureTaxonomyReport {
  totalFailed: number;
  diagnoses: Array<{ testName: string; diagnosis: FailureDiagnosis }>;
  categoryCounts: Record<FailureCategory, number>;
  topCategory: FailureCategory | null;
}

function detectLoop(toolCalls: ToolCallRecord[]): { detected: boolean; index: number } {
  for (let i = 2; i < toolCalls.length; i++) {
    if (toolCalls[i].tool === toolCalls[i - 1].tool && toolCalls[i].tool === toolCalls[i - 2].tool) {
      const argsMatch = JSON.stringify(toolCalls[i].args) === JSON.stringify(toolCalls[i - 1].args);
      if (argsMatch) return { detected: true, index: i - 2 };
    }
  }
  return { detected: false, index: -1 };
}

function detectToolErrors(toolCalls: ToolCallRecord[]): { index: number; hasRecovery: boolean } {
  for (let i = 0; i < toolCalls.length; i++) {
    if (toolCalls[i].result.isError) {
      const hasRecovery = i < toolCalls.length - 1; // at least tried something after error
      return { index: i, hasRecovery };
    }
  }
  return { index: -1, hasRecovery: true };
}

export function diagnoseFailure(test: TestResult): FailureDiagnosis {
  const toolCalls = test.toolCalls;

  // Safety violation: security evaluator failed
  const securityFail = test.evaluatorResults.find(e => (e.evaluator === 'security' || e.evaluator === 'tool-poisoning') && !e.pass);
  if (securityFail) {
    return { category: 'safety_violation', confidence: 0.95, criticalStepIndex: 0, criticalStepTool: toolCalls[0]?.tool ?? null, explanation: `Security evaluator "${securityFail.evaluator}" failed: ${securityFail.explanation ?? securityFail.label ?? 'violation detected'}`, suggestion: 'Review tool call arguments for unsafe patterns. Add guardrails or input validation.' };
  }

  // Premature termination: no tool calls when tools were expected
  const toolSelectionFail = test.evaluatorResults.find(e => e.evaluator === 'tool-selection' && !e.pass);
  if (toolCalls.length === 0 && toolSelectionFail) {
    return { category: 'premature_termination', confidence: 0.85, criticalStepIndex: -1, criticalStepTool: null, explanation: 'Agent produced no tool calls when tools were expected.', suggestion: 'Check if the prompt is clear about which tools to use. Verify tool descriptions are discoverable.' };
  }

  // Loop detection: same tool+args repeated 3+ times
  const loop = detectLoop(toolCalls);
  if (loop.detected) {
    return { category: 'loop_detection', confidence: 0.9, criticalStepIndex: loop.index, criticalStepTool: toolCalls[loop.index]?.tool ?? null, explanation: `Agent repeated "${toolCalls[loop.index]?.tool}" with identical arguments 3+ times.`, suggestion: 'Add loop-breaking logic or max-retry limits. Check if the tool response indicates the same state.' };
  }

  // Error handling: tool returned error and agent didn't recover
  const toolError = detectToolErrors(toolCalls);
  if (toolError.index >= 0 && !toolError.hasRecovery) {
    return { category: 'error_handling', confidence: 0.85, criticalStepIndex: toolError.index, criticalStepTool: toolCalls[toolError.index]?.tool ?? null, explanation: `Tool "${toolCalls[toolError.index]?.tool}" errored and agent stopped without recovery.`, suggestion: 'Add error recovery logic. Teach the agent to retry with different parameters or try alternative tools.' };
  }

  // Tool misuse: tool-selection or tool-args evaluator failed
  const argsFail = test.evaluatorResults.find(e => e.evaluator === 'tool-args' && !e.pass);
  if (toolSelectionFail || argsFail) {
    const failEval = toolSelectionFail ?? argsFail!;
    const firstWrongIdx = 0;
    return { category: 'tool_misuse', confidence: 0.8, criticalStepIndex: firstWrongIdx, criticalStepTool: toolCalls[firstWrongIdx]?.tool ?? null, explanation: `${failEval.evaluator} failed: ${failEval.explanation ?? failEval.label ?? 'incorrect tool usage'}`, suggestion: 'Improve tool descriptions, add examples to the prompt, or constrain available tools.' };
  }

  // Hallucination: correctness or groundedness failed with high confidence
  const correctnessFail = test.evaluatorResults.find(e => e.evaluator === 'correctness' && !e.pass && e.score < 0.3);
  const groundednessFail = test.evaluatorResults.find(e => e.evaluator === 'groundedness' && !e.pass && e.score < 0.3);
  if (correctnessFail || groundednessFail) {
    return { category: 'hallucination', confidence: 0.7, criticalStepIndex: toolCalls.length > 0 ? toolCalls.length - 1 : -1, criticalStepTool: toolCalls[toolCalls.length - 1]?.tool ?? null, explanation: 'Agent output contains information not supported by tool results or context.', suggestion: 'Add groundedness constraints. Use retrieval-augmented generation or fact-checking.' };
  }

  // Plan adherence: tool-sequence evaluator failed
  const seqFail = test.evaluatorResults.find(e => e.evaluator === 'tool-sequence' && !e.pass);
  if (seqFail) {
    return { category: 'plan_adherence', confidence: 0.75, criticalStepIndex: 0, criticalStepTool: toolCalls[0]?.tool ?? null, explanation: `Agent did not follow the expected tool sequence: ${seqFail.explanation ?? ''}`, suggestion: 'Make the expected workflow more explicit in the prompt. Consider adding step-by-step instructions.' };
  }

  // Fallback: unknown
  const lowestEval = [...test.evaluatorResults].sort((a, b) => a.score - b.score)[0];
  return { category: 'unknown', confidence: 0.3, criticalStepIndex: toolCalls.length > 0 ? 0 : -1, criticalStepTool: toolCalls[0]?.tool ?? null, explanation: `Lowest evaluator: ${lowestEval?.evaluator ?? 'none'} (${lowestEval?.score?.toFixed(2) ?? 'N/A'})`, suggestion: 'Review the test expectations. Consider adding more specific evaluators.' };
}

export function buildFailureTaxonomyReport(results: TestResult[]): FailureTaxonomyReport {
  const failed = results.filter(t => !t.pass && !t.skipped);

  const diagnoses = failed.map(t => ({ testName: t.name, diagnosis: diagnoseFailure(t) }));

  const categoryCounts: Record<FailureCategory, number> = {
    plan_adherence: 0, tool_misuse: 0, hallucination: 0, loop_detection: 0,
    error_handling: 0, premature_termination: 0, context_overflow: 0,
    safety_violation: 0, unknown: 0,
  };
  for (const d of diagnoses) categoryCounts[d.diagnosis.category]++;

  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).find(([, count]) => count > 0)?.[0] as FailureCategory | undefined ?? null;

  return { totalFailed: failed.length, diagnoses, categoryCounts, topCategory };
}
