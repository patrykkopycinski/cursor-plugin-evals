import { DATA_DIR, CLI_NAME } from '../core/constants.js';

export function generateGitHubActionsYaml(): string {
  return `name: Plugin Evaluation

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  eval:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        layer: [static, unit, integration, llm]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Cache fixtures
        uses: actions/cache@v4
        with:
          path: ${DATA_DIR}/fixtures
          key: eval-fixtures-\${{ hashFiles('plugin-eval.yaml') }}
          restore-keys: eval-fixtures-

      - name: Start Elasticsearch
        if: matrix.layer == 'integration' || matrix.layer == 'llm'
        run: |
          curl -fsSL https://elastic.co/start-local | sh -s --
          source elastic-start-local/.env
          echo "ELASTICSEARCH_URL=http://localhost:9200" >> \$GITHUB_ENV
          echo "ES_USER=elastic" >> \$GITHUB_ENV
          echo "ES_PASS=\${ES_LOCAL_PASSWORD}" >> \$GITHUB_ENV

      - name: Wait for Elasticsearch
        if: matrix.layer == 'integration' || matrix.layer == 'llm'
        run: |
          source elastic-start-local/.env
          until curl -sf "http://elastic:\${ES_LOCAL_PASSWORD}@localhost:9200/_cluster/health"; do sleep 2; done

      - name: Run \${{ matrix.layer }} evaluation
        run: npx ${CLI_NAME} run --layer \${{ matrix.layer }} --ci --report json --output eval-\${{ matrix.layer }}.json
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: eval-results-\${{ matrix.layer }}
          path: eval-\${{ matrix.layer }}.json

      - name: Stop Elasticsearch
        if: always() && (matrix.layer == 'integration' || matrix.layer == 'llm')
        run: |
          cd elastic-start-local && docker compose down || true
`;
}

export function generateSkillEvalWorkflow(): string {
  return `name: Skill Evaluation (Sandbox)

on:
  push:
    branches: [main]
    paths:
      - 'skills/**'
      - 'eval.yaml'
      - 'plugin-eval.yaml'
  pull_request:
    branches: [main]
    paths:
      - 'skills/**'
      - 'eval.yaml'
      - 'plugin-eval.yaml'
  workflow_dispatch:
    inputs:
      skill_dir:
        description: 'Skill directory to evaluate'
        required: true
      adapter:
        description: 'Adapter (plain-llm or claude-sdk)'
        default: 'claude-sdk'

jobs:
  skill-eval:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Start Elasticsearch via start-local
        run: |
          curl -fsSL https://elastic.co/start-local | sh -s --
          source elastic-start-local/.env
          echo "ELASTICSEARCH_URL=http://localhost:9200" >> \$GITHUB_ENV
          echo "ES_USER=elastic" >> \$GITHUB_ENV
          echo "ES_PASS=\${ES_LOCAL_PASSWORD}" >> \$GITHUB_ENV

      - name: Wait for Elasticsearch
        run: |
          source elastic-start-local/.env
          until curl -sf "http://elastic:\${ES_LOCAL_PASSWORD}@localhost:9200/_cluster/health"; do sleep 2; done

      - name: Run skill evaluation
        run: |
          SKILL_DIR="\${{ github.event.inputs.skill_dir || 'skills' }}"
          ADAPTER="\${{ github.event.inputs.adapter || 'claude-sdk' }}"
          node dist/cli/main.js skill-eval \\
            --skill-dir "\$SKILL_DIR" \\
            --adapter "\$ADAPTER" \\
            --setup \\
            --no-sandbox \\
            --output eval-results.json \\
            --verbose
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: skill-eval-results
          path: eval-results.json

      - name: Check pass rate
        run: |
          PASS_RATE=\$(node -e "const r = require('./eval-results.json'); console.log(r.overall.passRate)")
          echo "Pass rate: \$PASS_RATE"
          if (( \$(echo "\$PASS_RATE < 0.85" | bc -l) )); then
            echo "::error::Pass rate \$PASS_RATE is below 85% threshold"
            exit 1
          fi

      - name: Stop Elasticsearch
        if: always()
        run: |
          cd elastic-start-local && docker compose down || true
`;
}
