/**
 * TypeScript Expect API demo for the elastic-cursor-plugin showcase.
 *
 * This file demonstrates how to define integration and LLM eval suites
 * using the programmatic API instead of (or alongside) YAML.
 * It also exercises every new framework capability added in v2.
 */
import {
  defineSuite,
  field,
  run,
  maxIterations,
  noErrors,
  latencyUnder,
} from 'cursor-plugin-evals';

// ─── Integration demo: basic Expect API ─────────────────────────────────────

export const integrationDemo = defineSuite(
  { name: 'ts-integration-demo', layer: 'integration' },
  ({ integration }) => {
    integration('cluster-health-via-api', {
      tool: 'elasticsearch_api',
      args: { method: 'GET', path: '/_cluster/health' },
      assert: [
        field('content.0.text').contains('cluster_name').compile(),
        field('content.0.text').contains('status').compile(),
        field('isError').eq(false).compile(),
      ],
    });

    integration('esql-row-query', {
      tool: 'esql_query',
      args: { query: 'ROW message = "hello from eval"' },
      assert: [
        field('isError').eq(false).compile(),
      ],
    });

    integration('kibana-status-check', {
      tool: 'kibana_api',
      args: { method: 'GET', path: '/api/status' },
      assert: [
        field('content.0.text').contains('overall').compile(),
      ],
    });
  },
);

// ─── Integration demo: new assertion operators (oneOf, startsWith, endsWith) ─

export const newAssertionOpsDemo = defineSuite(
  { name: 'ts-new-assertion-ops', layer: 'integration' },
  ({ integration }) => {
    integration('content-type-one-of', {
      tool: 'elasticsearch_api',
      args: { method: 'GET', path: '/_cluster/health' },
      assert: [
        field('isError').eq(false).compile(),
        field('content.0.type').oneOf(['text', 'markdown']).compile(),
      ],
    });

    integration('cluster-health-starts-with-json', {
      tool: 'elasticsearch_api',
      args: { method: 'GET', path: '/_cluster/health' },
      assert: [
        field('isError').eq(false).compile(),
        field('content.0.text').startsWith('{').compile(),
      ],
    });

    integration('deployment-guide-ends-check', {
      tool: 'get_deployment_guide',
      args: { preference: 'cloud' },
      assert: [
        field('isError').eq(false).compile(),
        field('content.0.text').endsWith('\n').compile(),
      ],
    });
  },
);

// ─── RunAssertion demo: agent loop execution checks ─────────────────────────

export const runAssertionDemo = defineSuite(
  { name: 'ts-run-assertions', layer: 'llm', defaults: { repetitions: 2 } },
  ({ llm }) => {
    llm('cluster-health-agent-loop', {
      prompt: 'Is my Elasticsearch cluster healthy?',
      expected: {
        tools: ['elasticsearch_api'],
      },
      evaluators: ['tool-selection', 'response-quality', 'security'],
      maxTurns: 4,
      runChecks: run()
        .maxIterations(4)
        .callCount('elasticsearch_api', 1, 3)
        .noErrors()
        .latencyUnder(30_000)
        .toChecks(),
    });

    llm('security-triage-loop', {
      prompt:
        'Check for recent security alerts and tell me which are critical.',
      expected: {
        tools: ['triage_alerts'],
      },
      evaluators: ['tool-selection', 'response-quality', 'security'],
      maxTurns: 6,
      runChecks: run()
        .maxIterations(6)
        .successRate(0.8)
        .noErrors()
        .outputMatches('alert|critical|severity')
        .toChecks(),
    });

    llm('multi-step-diagnostics-loop', {
      prompt:
        'Run a full diagnostic: cluster health, available data, and run a test ES|QL query.',
      expected: {
        tools: ['get_cluster_context', 'discover_data', 'esql_query'],
      },
      evaluators: [
        'tool-selection',
        'tool-sequence',
        'response-quality',
        'security',
      ],
      maxTurns: 8,
      runChecks: [
        maxIterations(8),
        noErrors(),
        latencyUnder(60_000),
      ],
    });
  },
);

// ─── LLM demo: standard tool-selection & workflows ──────────────────────────

export const llmDemo = defineSuite(
  {
    name: 'ts-llm-demo',
    layer: 'llm',
    defaults: { repetitions: 2 },
  },
  ({ llm }) => {
    llm('health-check-prompt', {
      prompt: 'Is my Elasticsearch cluster healthy?',
      expected: {
        tools: ['elasticsearch_api'],
        responseContains: ['health', 'green'],
      },
      evaluators: ['tool-selection', 'response-quality', 'security'],
    });

    llm('multi-tool-workflow', {
      prompt:
        'Give me a quick cluster overview — health, node count, and what data is available.',
      expected: {
        tools: ['get_cluster_context', 'elasticsearch_api'],
      },
      evaluators: ['tool-selection', 'tool-sequence', 'security'],
      maxTurns: 6,
    });

    llm('conversation-coherence-check', {
      prompt:
        'First discover what data is available, then run an ES|QL query against the most interesting index.',
      expected: {
        tools: ['discover_data', 'esql_query'],
      },
      evaluators: [
        'tool-selection',
        'tool-sequence',
        'conversation-coherence',
        'security',
      ],
      maxTurns: 6,
    });
  },
);

// ─── Trajectory evaluation demo ─────────────────────────────────────────────

export const trajectoryDemo = defineSuite(
  { name: 'ts-trajectory-demo', layer: 'llm', defaults: { repetitions: 2 } },
  ({ llm }) => {
    llm('trajectory-cluster-diagnostics', {
      prompt:
        'Run full cluster diagnostics: health, data overview, then a test query.',
      expected: {
        tools: ['get_cluster_context', 'discover_data', 'esql_query'],
        goldenPath: ['get_cluster_context', 'discover_data', 'esql_query'],
      },
      evaluators: [
        'tool-selection',
        'trajectory',
        'response-quality',
        'security',
      ],
      maxTurns: 8,
    });

    llm('trajectory-security-investigation', {
      prompt:
        'Investigate potential security incidents: check alerts, then rules, then data sources.',
      expected: {
        tools: ['triage_alerts', 'manage_detection_rules', 'discover_security_data'],
        goldenPath: ['triage_alerts', 'manage_detection_rules', 'discover_security_data'],
      },
      evaluators: ['tool-selection', 'trajectory', 'security'],
      maxTurns: 8,
    });
  },
);

// ─── Multi-judge configuration demo ─────────────────────────────────────────

export const multiJudgeDemo = defineSuite(
  {
    name: 'ts-multi-judge-demo',
    layer: 'llm',
    defaults: {
      repetitions: 2,
      multiJudge: {
        judges: ['gpt-4o', 'claude-sonnet-4-20250514'],
        aggregation: 'borda_count',
        supremeJudges: ['gpt-4o'],
      },
    },
  },
  ({ llm }) => {
    llm('blind-eval-cluster-health', {
      prompt: 'Check the health of my Elasticsearch cluster.',
      expected: {
        tools: ['get_cluster_context'],
      },
      evaluators: ['tool-selection', 'response-quality'],
    });

    llm('blind-eval-security-triage', {
      prompt: 'Are there any active security alerts I should worry about?',
      expected: {
        tools: ['triage_alerts'],
      },
      evaluators: ['tool-selection', 'response-quality', 'security'],
    });
  },
);

export default [
  integrationDemo,
  newAssertionOpsDemo,
  runAssertionDemo,
  llmDemo,
  multiJudgeDemo,
  trajectoryDemo,
];
