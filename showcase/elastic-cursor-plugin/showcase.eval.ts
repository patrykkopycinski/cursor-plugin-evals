/**
 * TypeScript Expect API demo for the elastic-cursor-plugin showcase.
 *
 * This file demonstrates how to define integration and LLM eval suites
 * using the programmatic API instead of (or alongside) YAML.
 */
import { defineSuite, field } from 'cursor-plugin-evals';

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
      prompt: 'Give me a quick cluster overview — health, node count, and what data is available.',
      expected: {
        tools: ['get_cluster_context', 'elasticsearch_api'],
      },
      evaluators: ['tool-selection', 'tool-sequence', 'security'],
      maxTurns: 6,
    });
  },
);

export default [integrationDemo, llmDemo];
