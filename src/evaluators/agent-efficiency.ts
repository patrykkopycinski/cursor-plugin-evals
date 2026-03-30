import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

interface RedundantCall {
  tool: string;
  args: Record<string, unknown>;
  indices: number[];
}

interface RetryBurst {
  tool: string;
  startIndex: number;
  count: number;
}

interface DetectedLoop {
  sequence: string[];
  startIndex: number;
  repetitions: number;
}

export const agentEfficiencyEvaluator: Evaluator = {
  name: 'agent-efficiency',
  kind: 'CODE',

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const { toolCalls, expected, config } = context;

    if (toolCalls.length === 0) {
      return {
        evaluator: 'agent-efficiency',
        score: 1.0,
        pass: true,
        skipped: true,
        explanation: 'No tool calls to evaluate.',
        metadata: {
          redundantCalls: [],
          retryBursts: [],
          loops: [],
          stepBloat: false,
          idleTools: [],
        },
      };
    }

    const threshold = typeof config?.threshold === 'number' ? config.threshold : 0.5;
    const idleThresholdMs =
      typeof config?.idleThresholdMs === 'number' ? config.idleThresholdMs : 30000;

    const toolNames = toolCalls.map((tc) => tc.tool);

    // 1. Redundant calls: same tool + same args
    const redundantCalls = detectRedundantCalls(toolCalls);

    // 2. Excessive retries: same tool 3+ times in sequence
    const retryBursts = detectRetryBursts(toolNames);

    // 3. Loop detection: repeating sequence of 2+ tool calls
    const loops = detectLoops(toolNames);

    // 4. Step bloat
    const goldenPath = expected?.goldenPath;
    const stepBloat =
      goldenPath != null && goldenPath.length > 0
        ? toolCalls.length > 2 * goldenPath.length
        : false;

    // 5. Idle tools
    const idleTools = toolCalls
      .map((tc, i) => ({ tool: tc.tool, index: i, latencyMs: tc.latencyMs }))
      .filter((tc) => tc.latencyMs > idleThresholdMs);

    // Scoring
    let score = 1.0;

    // Redundant calls: -0.1 per redundant call (extra occurrences beyond the first)
    for (const rc of redundantCalls) {
      score -= 0.1 * (rc.indices.length - 1);
    }

    // Retry bursts: -0.15 per burst
    score -= 0.15 * retryBursts.length;

    // Loops: -0.3 per detected loop
    score -= 0.3 * loops.length;

    // Step bloat: -0.2
    if (stepBloat) {
      score -= 0.2;
    }

    // Idle tools: -0.05 per idle call
    score -= 0.05 * idleTools.length;

    // Clamp to [0, 1]
    score = Math.max(0, Math.min(1, score));

    const issues: string[] = [];
    if (redundantCalls.length > 0) {
      issues.push(
        `${redundantCalls.length} redundant call(s) detected (same tool + args repeated)`
      );
    }
    if (retryBursts.length > 0) {
      issues.push(`${retryBursts.length} excessive retry burst(s) detected`);
    }
    if (loops.length > 0) {
      issues.push(`${loops.length} tool call loop(s) detected`);
    }
    if (stepBloat) {
      issues.push(
        `Step bloat: ${toolCalls.length} calls vs golden path of ${goldenPath!.length} (> 2x)`
      );
    }
    if (idleTools.length > 0) {
      issues.push(`${idleTools.length} idle tool call(s) exceeding ${idleThresholdMs}ms`);
    }

    const explanation =
      issues.length === 0
        ? 'No efficiency issues detected.'
        : `Efficiency issues: ${issues.join('; ')}.`;

    return {
      evaluator: 'agent-efficiency',
      score,
      pass: score >= threshold,
      explanation,
      metadata: {
        redundantCalls,
        retryBursts,
        loops,
        stepBloat,
        idleTools,
      },
    };
  },
};

function detectRedundantCalls(
  toolCalls: EvaluatorContext['toolCalls']
): RedundantCall[] {
  const seen = new Map<string, { indices: number[]; args: Record<string, unknown> }>();

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const key = `${tc.tool}::${JSON.stringify(tc.args)}`;
    const existing = seen.get(key);
    if (existing) {
      existing.indices.push(i);
    } else {
      seen.set(key, { indices: [i], args: tc.args });
    }
  }

  const result: RedundantCall[] = [];
  for (const [, entry] of seen) {
    if (entry.indices.length > 1) {
      const tool = toolCalls[entry.indices[0]].tool;
      result.push({ tool, args: entry.args, indices: entry.indices });
    }
  }
  return result;
}

function detectRetryBursts(toolNames: string[]): RetryBurst[] {
  const bursts: RetryBurst[] = [];
  let i = 0;

  while (i < toolNames.length) {
    const tool = toolNames[i];
    let count = 1;
    while (i + count < toolNames.length && toolNames[i + count] === tool) {
      count++;
    }
    if (count >= 3) {
      bursts.push({ tool, startIndex: i, count });
    }
    i += count;
  }

  return bursts;
}

function detectLoops(toolNames: string[]): DetectedLoop[] {
  const loops: DetectedLoop[] = [];
  const maxWindowSize = Math.floor(toolNames.length / 2);

  for (let windowSize = 2; windowSize <= maxWindowSize; windowSize++) {
    let i = 0;
    while (i <= toolNames.length - windowSize * 2) {
      const window = toolNames.slice(i, i + windowSize);
      let repetitions = 1;
      let j = i + windowSize;

      while (j + windowSize <= toolNames.length) {
        const next = toolNames.slice(j, j + windowSize);
        if (arraysEqual(window, next)) {
          repetitions++;
          j += windowSize;
        } else {
          break;
        }
      }

      if (repetitions >= 2) {
        // Avoid reporting a loop that's already covered by a larger window starting at same position
        const alreadyCovered = loops.some(
          (l) =>
            l.startIndex === i &&
            l.sequence.length > windowSize
        );

        if (!alreadyCovered) {
          loops.push({ sequence: window, startIndex: i, repetitions });
          // Skip past this loop to avoid overlapping detections
          i = j;
          continue;
        }
      }

      i++;
    }
  }

  return loops;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
