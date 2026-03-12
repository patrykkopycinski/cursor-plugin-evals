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
          path: .cursor-plugin-evals/fixtures
          key: eval-fixtures-\${{ hashFiles('plugin-eval.yaml') }}
          restore-keys: eval-fixtures-

      - name: Start services
        if: matrix.layer == 'integration' || matrix.layer == 'llm'
        run: docker compose up -d
        env:
          COMPOSE_FILE: docker/docker-compose.yml

      - name: Wait for services
        if: matrix.layer == 'integration' || matrix.layer == 'llm'
        run: sleep 10

      - name: Run \${{ matrix.layer }} evaluation
        run: npx cursor-plugin-evals run --layer \${{ matrix.layer }} --ci --report json --output eval-\${{ matrix.layer }}.json
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: eval-results-\${{ matrix.layer }}
          path: eval-\${{ matrix.layer }}.json

      - name: Stop services
        if: always() && (matrix.layer == 'integration' || matrix.layer == 'llm')
        run: docker compose down
        env:
          COMPOSE_FILE: docker/docker-compose.yml
`;
}
