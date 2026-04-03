import { callJudge } from '../evaluators/llm-judge.js';
import type { RunResult } from '../core/types.js';

export interface EvalYamlPatch {
  op: 'add_evaluator' | 'remove_evaluator' | 'set_threshold' | 'add_test' | 'set_repetitions';
  path: string;
  value: unknown;
}

export interface SkillImprovementSuggestion {
  section: string;
  action: 'add' | 'modify' | 'add_example';
  content: string;
  rationale: string;
}

export interface Recommendation {
  type: 'evaluator' | 'threshold' | 'test' | 'config' | 'skill_improvement';
  priority: 'high' | 'medium' | 'low';
  message: string;
  action?: EvalYamlPatch;
  estimatedImpact?: string;
  skillSuggestion?: SkillImprovementSuggestion;
}

// ─── Failure pattern analysis helpers ────────────────────────────

interface FailurePattern {
  category: string;
  count: number;
  tests: string[];
  details: string[];
}

function extractFailurePatterns(result: RunResult): FailurePattern[] {
  const patterns = new Map<string, FailurePattern>();

  const addPattern = (category: string, test: string, detail: string) => {
    const existing = patterns.get(category);
    if (existing) {
      existing.count++;
      existing.tests.push(test);
      existing.details.push(detail);
    } else {
      patterns.set(category, { category, count: 1, tests: [test], details: [detail] });
    }
  };

  for (const suite of result.suites) {
    for (const test of suite.tests) {
      if (test.pass) continue;

      for (const ev of test.evaluatorResults) {
        if (ev.pass || ev.skipped) continue;

        const meta = ev.metadata as Record<string, unknown> | undefined;

        if (ev.evaluator === 'esql-pattern') {
          const unmatched = meta?.unmatched as string[] | undefined;
          if (unmatched?.length) {
            for (const pattern of unmatched) {
              addPattern('missing_command', test.name, pattern);
            }
          }
        }

        if (ev.evaluator === 'esql-execution') {
          const error = meta?.error as string | undefined;
          if (error) {
            if (/syntax|parse|unexpected/i.test(error)) {
              addPattern('syntax_error', test.name, error);
            } else if (/index.*not.*found|unknown index/i.test(error)) {
              addPattern('wrong_index', test.name, error);
            } else if (/function.*unknown|unsupported/i.test(error)) {
              addPattern('unknown_function', test.name, error);
            } else {
              addPattern('execution_error', test.name, error);
            }
          }
          if (ev.label === 'no_query') {
            addPattern('no_query_extracted', test.name, 'Model did not produce an ES|QL query');
          }
        }

        if (ev.evaluator === 'esql-result') {
          const colOverlap = meta?.columnOverlap as number | undefined;
          const rowSim = meta?.rowCountSimilarity as number | undefined;
          if (colOverlap !== undefined && colOverlap < 0.5) {
            const refCols = (meta?.refColumns as string[])?.join(', ') ?? 'unknown';
            const genCols = (meta?.genColumns as string[])?.join(', ') ?? 'unknown';
            addPattern('column_mismatch', test.name, `Expected: [${refCols}], Got: [${genCols}]`);
          }
          if (rowSim !== undefined && rowSim < 0.3) {
            addPattern('row_count_mismatch', test.name,
              `ref=${meta?.refRowCount ?? '?'} vs gen=${meta?.genRowCount ?? '?'}`);
          }
        }

        if (ev.evaluator === 'correctness' || ev.evaluator === 'groundedness') {
          if (ev.score < 0.5 && ev.explanation) {
            addPattern('quality_low', test.name, ev.explanation.slice(0, 200));
          }
        }
      }
    }
  }

  return [...patterns.values()].sort((a, b) => b.count - a.count);
}

/**
 * Check if a keyword/pattern is mentioned in the SKILL.md content.
 */
function skillMentions(skillContent: string, keyword: string): boolean {
  return new RegExp(keyword, 'i').test(skillContent);
}

// ─── Deterministic recommendations ──────────────────────────────

export function computeDeterministicRecommendations(
  result: RunResult,
  evalYaml: Record<string, unknown>,
  skillContent?: string,
): Recommendation[] {
  const recs: Recommendation[] = [];

  const total = result.overall.total;
  const passed = result.overall.passed;
  const passRate = total > 0 ? passed / total : 0;

  // Suggest more repetitions when pass rate is perfect but repetitions is 1
  const defaults = evalYaml?.defaults as Record<string, unknown> | undefined;
  const repetitions = defaults?.repetitions;
  if (passRate === 1.0 && (repetitions === 1 || repetitions === undefined)) {
    recs.push({
      type: 'config',
      priority: 'medium',
      message: 'All tests pass — consider increasing repetitions to verify consistency',
      estimatedImpact: 'Validates reliability without changing pass rate',
      action: {
        op: 'set_repetitions',
        path: 'defaults.repetitions',
        value: 3,
      },
    });
  }

  // Warn when evaluator scores very low
  const allEvaluatorResults = result.suites.flatMap((s) =>
    s.tests.flatMap((t) => t.evaluatorResults),
  );
  const lowScoring = allEvaluatorResults.filter((e) => e.score < 0.3 && !e.skipped);
  if (lowScoring.length > 0) {
    recs.push({
      type: 'evaluator',
      priority: 'high',
      message: `${lowScoring.length} evaluator result(s) scored below 0.3 — check evaluator configuration or test expectations`,
    });
  }

  // Suggest more tests when fewer than 5
  if (total < 5) {
    recs.push({
      type: 'test',
      priority: 'medium',
      message: 'Fewer than 5 tests — add more tests to improve coverage',
    });
  }

  // Suggest harder tests when all score 1.0 and there are at least 5 tests
  if (total >= 5 && passRate === 1.0) {
    const allScores = allEvaluatorResults.filter((e) => !e.skipped).map((e) => e.score);
    const allPerfect = allScores.every((s) => s === 1.0);
    if (allPerfect) {
      recs.push({
        type: 'test',
        priority: 'low',
        message:
          'All tests score perfectly — tests may be too easy, consider adding adversarial cases',
        estimatedImpact: 'Improves eval rigor, may reveal edge-case weaknesses',
      });
    }
  }

  // ─── SKILL.md improvement recommendations from failure patterns ───
  if (skillContent && passRate < 1.0) {
    const failurePatterns = extractFailurePatterns(result);
    recs.push(...generateSkillImprovements(failurePatterns, skillContent, result));
  }

  return recs;
}

// ─── Skill improvement generation from failure patterns ─────────

function generateSkillImprovements(
  patterns: FailurePattern[],
  skillContent: string,
  result: RunResult,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const failedCount = result.overall.failed;
  const totalCount = result.overall.total;

  // Pattern: Missing commands (from esql-pattern evaluator)
  const missingCmds = patterns.find((p) => p.category === 'missing_command');
  if (missingCmds) {
    // Group missing patterns to find commonly missed commands
    const cmdFreq = new Map<string, number>();
    for (const detail of missingCmds.details) {
      const normalized = detail.toUpperCase().replace(/\\[bBsS.*+?]/g, '').trim();
      cmdFreq.set(normalized, (cmdFreq.get(normalized) ?? 0) + 1);
    }

    const topMissing = [...cmdFreq.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    // Check if SKILL.md has intent-to-command mapping
    if (!skillMentions(skillContent, 'intent.*command|command.*mapping|when to use|match.*intent|intent.*feature|user.*says.*use')) {
      const commands = topMissing.map(([cmd]) => cmd).join(', ');
      recs.push({
        type: 'skill_improvement',
        priority: 'high',
        message: `Model frequently misses required commands (${commands}). Add an intent-to-command mapping section to SKILL.md that maps user intents to the correct commands.`,
        estimatedImpact: `Could fix ~${missingCmds.count} of ${failedCount} failures (+${Math.round((missingCmds.count / totalCount) * 100)}% pass rate)`,
        skillSuggestion: {
          section: 'Intent-to-Command Mapping',
          action: 'add',
          content: buildIntentCommandMapping(topMissing),
          rationale: `Tests failed because the model didn't use the expected commands: ${commands}`,
        },
      });
    } else {
      // Mapping exists but model still misses — suggest strengthening it
      const commands = topMissing.map(([cmd]) => cmd).join(', ');
      recs.push({
        type: 'skill_improvement',
        priority: 'high',
        message: `Intent-to-command mapping exists but model still misses: ${commands}. Strengthen the mapping with explicit examples and "MUST use" language.`,
        estimatedImpact: `Could fix ~${missingCmds.count} of ${failedCount} failures`,
        skillSuggestion: {
          section: 'Intent-to-Command Mapping',
          action: 'modify',
          content: `Strengthen existing mappings. For each missed command, add a clear rule:\n${topMissing.map(([cmd, count]) => `- "${cmd}" was missed in ${count} test(s) — add "MUST use ${cmd} when..." with concrete trigger phrases`).join('\n')}`,
          rationale: `Existing mapping isn't strong enough — model bypassed it in ${missingCmds.count} cases`,
        },
      });
    }
  }

  // Pattern: Syntax errors
  const syntaxErrors = patterns.find((p) => p.category === 'syntax_error');
  if (syntaxErrors) {
    if (!skillMentions(skillContent, 'syntax|constraint|rule|common mistake')) {
      recs.push({
        type: 'skill_improvement',
        priority: 'high',
        message: `${syntaxErrors.count} test(s) failed with syntax errors. Add a "Critical Syntax Rules" section to SKILL.md with explicit constraints.`,
        estimatedImpact: `Could fix ~${syntaxErrors.count} of ${failedCount} failures (+${Math.round((syntaxErrors.count / totalCount) * 100)}% pass rate)`,
        skillSuggestion: {
          section: 'Critical Syntax Rules',
          action: 'add',
          content: buildSyntaxRules(syntaxErrors.details),
          rationale: `Syntax errors: ${syntaxErrors.details.slice(0, 3).join('; ')}`,
        },
      });
    } else {
      recs.push({
        type: 'skill_improvement',
        priority: 'medium',
        message: `Syntax rules exist but ${syntaxErrors.count} test(s) still hit syntax errors. Add more negative examples showing what NOT to generate.`,
        estimatedImpact: `Could fix ~${syntaxErrors.count} of ${failedCount} failures`,
        skillSuggestion: {
          section: 'Common Mistakes',
          action: 'add_example',
          content: buildNegativeExamples(syntaxErrors.details),
          rationale: `Model still generates invalid syntax despite existing rules`,
        },
      });
    }
  }

  // Pattern: Column mismatches (wrong output structure)
  const colMismatch = patterns.find((p) => p.category === 'column_mismatch');
  if (colMismatch) {
    if (!skillMentions(skillContent, 'output.*format|column|KEEP|field.*select')) {
      recs.push({
        type: 'skill_improvement',
        priority: 'medium',
        message: `${colMismatch.count} test(s) returned wrong columns. Add output format guidance to SKILL.md specifying when to use KEEP to select specific fields.`,
        estimatedImpact: `Could fix ~${colMismatch.count} of ${failedCount} failures (+${Math.round((colMismatch.count / totalCount) * 100)}% pass rate)`,
        skillSuggestion: {
          section: 'Output Format Guidelines',
          action: 'add',
          content: '- When the user asks for specific fields, use `| KEEP field1, field2` to select only those columns\n- When aggregating, name computed columns descriptively: `STATS total_sales = SUM(amount)`\n- Use RENAME to match expected column names when the default names are unclear',
          rationale: `Model returns wrong columns: ${colMismatch.details.slice(0, 2).join('; ')}`,
        },
      });
    }
  }

  // Pattern: Row count mismatches (wrong LIMIT or missing aggregation)
  const rowMismatch = patterns.find((p) => p.category === 'row_count_mismatch');
  if (rowMismatch) {
    if (!skillMentions(skillContent, 'LIMIT|default.*row|result.*size')) {
      recs.push({
        type: 'skill_improvement',
        priority: 'medium',
        message: `${rowMismatch.count} test(s) returned wrong number of rows. Add LIMIT guidance to SKILL.md specifying default row limits for different query types.`,
        estimatedImpact: `Could fix ~${rowMismatch.count} of ${failedCount} failures`,
        skillSuggestion: {
          section: 'Default LIMIT Guidelines',
          action: 'add',
          content: '- Detail/listing queries: `LIMIT 20` (unless user specifies a number)\n- "Top N" queries: `LIMIT N` (use the number from the user\'s request, default 10)\n- Aggregation queries: No LIMIT needed (aggregation already reduces rows)\n- Time-bucketed queries: No LIMIT (return all buckets)',
          rationale: `Row count mismatches: ${rowMismatch.details.slice(0, 2).join('; ')}`,
        },
      });
    }
  }

  // Pattern: No query extracted (model didn't produce a query)
  const noQuery = patterns.find((p) => p.category === 'no_query_extracted');
  if (noQuery) {
    recs.push({
      type: 'skill_improvement',
      priority: 'high',
      message: `${noQuery.count} test(s) failed because the model didn't output a query. Add an explicit instruction in SKILL.md: "Always generate exactly one query. Never ask for clarification unless the request is completely ambiguous."`,
      estimatedImpact: `Could fix ~${noQuery.count} of ${failedCount} failures (+${Math.round((noQuery.count / totalCount) * 100)}% pass rate)`,
      skillSuggestion: {
        section: 'Query Generation Rules',
        action: 'add',
        content: '- ALWAYS generate exactly one ES|QL query per request\n- Never ask for clarification unless the request is completely ambiguous and no reasonable default exists\n- If the user\'s intent is unclear, make a reasonable assumption and generate a query\n- The query must be the primary output — include it in a code block',
        rationale: `Model failed to produce any query in ${noQuery.count} test(s)`,
      },
    });
  }

  // Pattern: Unknown functions
  const unknownFn = patterns.find((p) => p.category === 'unknown_function');
  if (unknownFn) {
    recs.push({
      type: 'skill_improvement',
      priority: 'high',
      message: `${unknownFn.count} test(s) used unknown functions. Add a "Supported Functions" reference section to SKILL.md listing available functions.`,
      estimatedImpact: `Could fix ~${unknownFn.count} of ${failedCount} failures`,
      skillSuggestion: {
        section: 'Supported Functions Reference',
        action: 'add',
        content: buildFunctionReference(unknownFn.details),
        rationale: `Model used unsupported functions: ${unknownFn.details.slice(0, 3).join('; ')}`,
      },
    });
  }

  // Pattern: Execution errors (generic)
  const execErrors = patterns.find((p) => p.category === 'execution_error');
  if (execErrors && execErrors.count >= 3) {
    recs.push({
      type: 'skill_improvement',
      priority: 'medium',
      message: `${execErrors.count} test(s) hit execution errors. Review error messages and add corresponding "Common Mistakes" entries to SKILL.md.`,
      estimatedImpact: `Could fix some of the ${execErrors.count} failures`,
      skillSuggestion: {
        section: 'Common Mistakes',
        action: 'add_example',
        content: buildCommonMistakesFromErrors(execErrors.details),
        rationale: `Recurring execution errors suggest the model needs explicit guidance`,
      },
    });
  }

  return recs;
}

// ─── Content builders for suggestions ───────────────────────────

function buildIntentCommandMapping(topMissing: [string, number][]): string {
  const lines = ['Add a table mapping user intents to required commands:\n'];
  lines.push('| User says... | Required command |');
  lines.push('|---|---|');

  for (const [cmd] of topMissing) {
    const upper = cmd.toUpperCase();
    if (upper.includes('STATS') && upper.includes('BY')) {
      lines.push('| "group by", "per category", "by region" | `STATS ... BY field` |');
    } else if (upper.includes('STATS')) {
      lines.push('| "count", "sum", "average", "total" | `STATS agg = FUNC(field)` |');
    } else if (upper.includes('WHERE')) {
      lines.push('| "filter", "only show", "where X is Y" | `WHERE condition` |');
    } else if (upper.includes('DATE_TRUNC')) {
      lines.push('| "trend over time", "by hour/day", "hourly" | `STATS ... BY bucket = DATE_TRUNC(interval, @timestamp)` |');
    } else if (upper.includes('SORT')) {
      lines.push('| "top", "highest", "most recent", "order by" | `SORT field DESC` |');
    } else if (upper.includes('MATCH') || upper.includes('QSTR')) {
      lines.push('| "search for text", "contains keyword" | `WHERE MATCH(field, "text")` |');
    } else if (upper.includes('CASE')) {
      lines.push('| "categorize", "classify", "if-then" | `EVAL category = CASE(...)` |');
    } else if (upper.includes('LOOKUP') || upper.includes('ENRICH')) {
      lines.push(`| "join with", "enrich from", "look up" | \`LOOKUP JOIN table ON key\` |`);
    } else if (upper.includes('EVAL')) {
      lines.push('| "calculate", "compute", "derive" | `EVAL new_field = expression` |');
    } else {
      lines.push(`| [describe when to use ${cmd}] | \`${cmd}\` |`);
    }
  }

  return lines.join('\n');
}

function buildSyntaxRules(errors: string[]): string {
  const rules = new Set<string>();

  for (const err of errors) {
    if (/backtick|`/i.test(err)) {
      rules.add('- Never use backtick escaping for field names — use unquoted names or double quotes');
    }
    if (/single.*quote|'/i.test(err)) {
      rules.add('- Use double quotes for string values, never single quotes');
    }
    if (/comment|--|\/\//i.test(err)) {
      rules.add('- No SQL-style comments (-- or //) — ES|QL does not support comments');
    }
    if (/group\s*by/i.test(err)) {
      rules.add('- No GROUP BY — use `STATS ... BY field` instead');
    }
    if (/select/i.test(err)) {
      rules.add('- No SELECT — use `FROM index | KEEP field1, field2` instead');
    }
    if (/having/i.test(err)) {
      rules.add('- No HAVING — use `WHERE` after `STATS` to filter aggregation results');
    }
  }

  if (rules.size === 0) {
    rules.add('- Review the exact error messages below and add explicit "DO NOT" rules for each pattern');
    rules.add(`- Sample errors: ${errors.slice(0, 3).map((e) => `"${e.slice(0, 100)}"`).join(', ')}`);
  }

  return [...rules].join('\n');
}

function buildNegativeExamples(errors: string[]): string {
  const lines = ['Add a "Common Mistakes" table:\n'];
  lines.push('| Wrong (SQL habit) | Correct (ES|QL) |');
  lines.push('|---|---|');

  const seen = new Set<string>();
  for (const err of errors.slice(0, 5)) {
    const key = err.slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`| [pattern from error: "${err.slice(0, 60)}..."] | [correct ES|QL equivalent] |`);
  }

  return lines.join('\n');
}

function buildFunctionReference(errors: string[]): string {
  const lines = ['List the available functions that the model should use:\n'];
  for (const err of errors.slice(0, 5)) {
    const fnMatch = err.match(/function\s+(\w+)|unknown.*?(\w+)/i);
    if (fnMatch) {
      const fn = fnMatch[1] ?? fnMatch[2];
      lines.push(`- "${fn}" is not supported — use [correct alternative] instead`);
    }
  }
  if (lines.length === 1) {
    lines.push(`- Review errors and list correct function names: ${errors.slice(0, 2).join('; ')}`);
  }
  return lines.join('\n');
}

function buildCommonMistakesFromErrors(errors: string[]): string {
  const unique = [...new Set(errors.map((e) => e.slice(0, 150)))].slice(0, 5);
  return `Add entries for these recurring errors:\n${unique.map((e) => `- Error: "${e}" → Add a rule preventing this pattern`).join('\n')}`;
}

// ─── LLM-powered recommendations ───────────────────────────────

export async function computeLlmRecommendations(
  result: RunResult,
  skillContent: string,
  evalYamlContent: string,
  model?: string,
): Promise<Recommendation[]> {
  const failedTests = result.suites.flatMap((s) =>
    s.tests
      .filter((t) => !t.pass)
      .map((t) => ({
        name: t.name,
        scores: Object.fromEntries(t.evaluatorResults.map((er) => [er.evaluator, er.score])),
        evaluatorDetails: t.evaluatorResults
          .filter((er) => !er.pass && !er.skipped)
          .map((er) => ({
            evaluator: er.evaluator,
            score: er.score,
            explanation: er.explanation?.slice(0, 200),
            metadata: er.metadata,
          })),
      })),
  );

  const passedTests = result.suites.flatMap((s) =>
    s.tests
      .filter((t) => t.pass)
      .map((t) => ({
        name: t.name,
        scores: Object.fromEntries(t.evaluatorResults.map((er) => [er.evaluator, er.score])),
      })),
  );

  const failurePatterns = extractFailurePatterns(result);

  const systemPrompt = `You are an expert at improving AI skill definitions (SKILL.md files) based on evaluation results. Your goal is to suggest specific, actionable improvements to the SKILL.md that will help the model produce better outputs.

Given:
1. The SKILL.md content (the instructions the model follows)
2. Failed test details with evaluator scores and error explanations
3. Failure pattern analysis (aggregated patterns across all failures)
4. Passed test summary (what's already working)

Analyze the failures and suggest 2-5 specific SKILL.md improvements. Each suggestion must include:
- WHERE in SKILL.md to add/modify (section name)
- WHAT to add (exact content or template)
- WHY this will help (which failures it addresses)
- ESTIMATED IMPACT (how many failures it could fix)

Respond with ONLY a JSON object:

{
  "recommendations": [
    {
      "type": "skill_improvement",
      "priority": "high | medium | low",
      "message": "One-line summary of the improvement",
      "estimatedImpact": "Could fix N of M failures (+X% pass rate)",
      "skillSuggestion": {
        "section": "Section name in SKILL.md",
        "action": "add | modify | add_example",
        "content": "The exact text to add or modify (use markdown)",
        "rationale": "Which specific failures this addresses and why"
      }
    }
  ]
}

Focus on patterns, not individual test fixes. Look for systemic issues — if multiple tests fail for the same reason, that's one high-priority suggestion, not many small ones.`;

  const userPrompt = [
    '## SKILL.md (current)',
    skillContent.slice(0, 6000),
    '',
    '## Failure Patterns (aggregated)',
    JSON.stringify(failurePatterns, null, 2),
    '',
    '## Failed Tests (detailed)',
    JSON.stringify(failedTests.slice(0, 15), null, 2),
    '',
    '## Passed Tests (summary)',
    `${passedTests.length} tests passed. Sample: ${passedTests.slice(0, 5).map((t) => t.name).join(', ')}`,
    '',
    '## Overall',
    `Pass rate: ${(result.overall.passRate * 100).toFixed(1)}% (${result.overall.passed}/${result.overall.total})`,
    '',
    '## Current eval.yaml',
    evalYamlContent.slice(0, 3000),
  ].join('\n');

  try {
    const response = await callJudge({ systemPrompt, userPrompt, model });
    const jsonMatch = response.explanation.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as { recommendations: Recommendation[] };
    if (!Array.isArray(parsed.recommendations)) return [];

    // Validate and normalize
    return parsed.recommendations.map((r) => ({
      type: r.type ?? 'skill_improvement',
      priority: r.priority ?? 'medium',
      message: r.message ?? 'Improve SKILL.md',
      estimatedImpact: r.estimatedImpact,
      skillSuggestion: r.skillSuggestion,
    }));
  } catch (_e) {
    return [];
  }
}
