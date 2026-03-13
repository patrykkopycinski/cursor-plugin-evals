import { log } from './logger.js';

const SENSITIVE_PATTERN = /KEY|TOKEN|SECRET/i;

const ENV_VARS = [
  { name: 'OPENAI_API_KEY', description: 'OpenAI API key for LLM evaluators', default: '' },
  { name: 'ANTHROPIC_API_KEY', description: 'Anthropic API key for Claude adapters', default: '' },
  {
    name: 'AZURE_OPENAI_API_KEY',
    description: 'Azure OpenAI API key (alternative to OPENAI_API_KEY)',
    default: '',
  },
  { name: 'AZURE_OPENAI_ENDPOINT', description: 'Azure OpenAI resource endpoint URL', default: '' },
  { name: 'AZURE_OPENAI_DEPLOYMENT', description: 'Azure OpenAI deployment name', default: '' },
  {
    name: 'AZURE_OPENAI_API_VERSION',
    description: 'Azure OpenAI API version',
    default: '2025-01-01-preview',
  },
  {
    name: 'AZURE_JUDGE_DEPLOYMENT',
    description: 'Azure deployment for LLM judge (defaults to AZURE_OPENAI_DEPLOYMENT)',
    default: '',
  },
  { name: 'JUDGE_MODEL', description: 'LLM model for judge evaluators', default: 'gpt-4o' },
  {
    name: 'LITELLM_URL',
    description: 'LiteLLM proxy URL for LLM routing',
    default: 'https://api.openai.com/v1',
  },
  { name: 'ES_API_KEY', description: 'Elasticsearch API key for integration tests', default: '' },
  {
    name: 'EVALUATIONS_ES_URL',
    description: 'Elasticsearch URL for storing eval results',
    default: 'http://localhost:9200',
  },
  { name: 'PLUGIN_DIR', description: 'Path to the Cursor plugin directory', default: '.' },
  {
    name: 'OTEL_EXPORTER_OTLP_ENDPOINT',
    description: 'OTLP endpoint for trace export',
    default: 'http://localhost:4318',
  },
  { name: 'EVAL_TASK_MODEL', description: 'Default model for task adapters', default: '' },
  {
    name: 'EVALUATION_REPETITIONS',
    description: 'Number of repetitions per test example',
    default: '3',
  },
  { name: 'CPE_CACHE_ENABLED', description: 'Enable LLM response cache', default: 'true' },
  { name: 'CPE_CACHE_TTL', description: 'Cache time-to-live', default: '7d' },
  {
    name: 'CPE_CACHE_DIR',
    description: 'Cache directory path',
    default: '.cursor-plugin-evals/cache',
  },
] as const;

function formatValue(name: string, value: string | undefined): string {
  const isSensitive = SENSITIVE_PATTERN.test(name);
  if (!value) return isSensitive ? '(empty)' : '(empty)';
  return isSensitive ? '[set]' : value;
}

export function envCommand(): void {
  log.header('Environment Variables');

  const rows: string[][] = [['Variable', 'Value', 'Default', 'Description']];

  for (const v of ENV_VARS) {
    const current = process.env[v.name];
    rows.push([v.name, formatValue(v.name, current), v.default || '—', v.description]);
  }

  log.table(rows);
}
