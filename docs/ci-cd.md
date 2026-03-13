# CI/CD Integration

Enforce plugin quality gates in continuous integration pipelines with automated reports, thresholds, and notifications.

## GitHub Actions

The fastest way to add plugin evals to CI. See [GitHub Action](./github-action.md) for the ready-made action.

```yaml
name: Plugin Evaluation
on:
  push:
    branches: [main]
  pull_request:

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx cursor-plugin-evals run --ci --report json -o results.json
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: eval-reports
          path: |
            results.json
            .cursor-plugin-evals/report.html
            .cursor-plugin-evals/badges/quality.svg
```

## GitLab CI

```yaml
plugin-eval:
  image: node:22
  stage: test
  script:
    - npm ci
    - npx cursor-plugin-evals run --ci --report junit-xml -o results.xml
  artifacts:
    reports:
      junit: results.xml
    paths:
      - .cursor-plugin-evals/
    when: always
  variables:
    OPENAI_API_KEY: $OPENAI_API_KEY
```

## Generic Shell Script

For any CI system:

```bash
#!/bin/bash
set -euo pipefail

npm ci

# Run evals with CI mode (exits non-zero on failure)
npx cursor-plugin-evals run \
  --ci \
  --config plugin-eval.yaml \
  --layer static unit integration \
  --report json \
  -o results.json

# Extract score for custom gating
SCORE=$(node -e "const r=require('./results.json'); console.log(r.qualityScore?.composite ?? r.overall.passRate * 100)")
echo "Quality score: $SCORE"

if (( $(echo "$SCORE < 80" | bc -l) )); then
  echo "Quality gate failed: $SCORE < 80"
  exit 1
fi
```

## Scaffold CI Config

Generate CI configuration interactively:

```bash
# Interactive mode
cursor-plugin-evals ci-init

# Non-interactive with preset
cursor-plugin-evals ci-init --preset github -o .github/workflows/plugin-eval.yml
cursor-plugin-evals ci-init --preset gitlab -o .gitlab-ci.yml
cursor-plugin-evals ci-init --preset shell -o scripts/run-evals.sh
```

## CI Thresholds

Configure thresholds in `plugin-eval.yaml` under the `ci` section:

```yaml
ci:
  score:
    avg: 0.8
    min: 0.5
  latency:
    p95: 10000
  cost:
    max: 1.00
  evaluators:
    tool-selection:
      avg: 0.85
    response-quality:
      avg: 0.7
  required_pass:
    - critical-safety-test
```

When running with `--ci`, all thresholds are enforced and the process exits with code 1 on any violation.

## JUnit XML Reports

Generate JUnit XML for integration with CI dashboards (Jenkins, GitLab, CircleCI):

```bash
cursor-plugin-evals run --report junit-xml -o results.xml
```

Each test maps to a JUnit test case with the evaluator scores in the output.

## Badge Generation

After each run, a quality badge SVG is generated at `.cursor-plugin-evals/badges/quality.svg`:

```markdown
![Plugin Quality](/.cursor-plugin-evals/badges/quality.svg)
```

The badge shows the composite score and letter grade.

## Notification on Failure

Combine CI with notifications to alert on failures:

```yaml
notifications:
  slack:
    webhook_url: ${SLACK_WEBHOOK_URL}
  github:
    token: ${GITHUB_TOKEN}
    repo: owner/repo
  triggers:
    - on: failure
```

See [Notifications](./notifications.md) for details.

## Programmatic CI API

```typescript
import { loadConfig, runEvaluation, evaluateCi, convertFlatThresholds } from 'cursor-plugin-evals';
import type { CiThresholds, CiResult } from 'cursor-plugin-evals';

const config = loadConfig('./plugin-eval.yaml');
const result = await runEvaluation(config, { ci: true });

// Evaluate against thresholds
const thresholds: CiThresholds = config.ci ?? { score: { avg: 0.8 } };
const ciResult: CiResult = evaluateCi(result, thresholds);

if (!ciResult.passed) {
  console.error(`CI gate failed: ${ciResult.summary}`);
  for (const v of ciResult.violations) {
    console.error(`  ${v.metric}: ${v.actual.toFixed(3)} (threshold: ${v.threshold})`);
  }
  process.exit(1);
}

console.log('CI gate passed');
```

## See Also

- [GitHub Action](./github-action.md) — ready-made action
- [Configuration Reference](./configuration.md) — `ci` section
- [Notifications](./notifications.md)
- [Regression Detection](./regression.md)
