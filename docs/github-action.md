# GitHub Action: Cursor Plugin Evals

Run `cursor-plugin-evals` in CI to gate plugin quality on every push and pull request.

## Quick Start

Create `.github/workflows/plugin-eval.yml` in your repository:

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
      - uses: your-org/cursor-plugin-evals/.github/action@main
        with:
          config-path: plugin-eval.yaml
          layers: 'static unit integration'
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Inputs

| Input | Description | Required | Default |
|---|---|---|---|
| `config-path` | Path to `plugin-eval.yaml` config file | No | `plugin-eval.yaml` |
| `layers` | Layers to run (space-separated) | No | `static unit integration` |
| `node-version` | Node.js version to use | No | `22` |
| `working-directory` | Working directory for commands | No | `.` |

### Available Layers

- `static` — Schema validation, manifest checks, tool naming conventions
- `unit` — Deterministic tool-call tests with mock fixtures
- `integration` — Live MCP server interaction tests
- `llm` — LLM-judged output quality (requires `OPENAI_API_KEY`)

## Outputs

| Output | Description | Example |
|---|---|---|
| `score` | Overall quality score (0–100) | `96` |
| `pass-rate` | Percentage of passing tests | `98.5` |
| `report-path` | Path to the HTML report artifact | `.cursor-plugin-evals/report.html` |

### Using Outputs

```yaml
- uses: your-org/cursor-plugin-evals/.github/action@main
  id: eval
  with:
    layers: 'static unit'
- name: Check quality gate
  if: steps.eval.outputs.score < 80
  run: |
    echo "Quality score ${{ steps.eval.outputs.score }} is below threshold"
    exit 1
```

## Report Artifacts

The action uploads three artifacts on every run (even on failure):

| File | Format | Description |
|---|---|---|
| `report.html` | HTML | Visual dashboard with pass/fail breakdown |
| `report.xml` | JUnit XML | Machine-readable results for CI integrations |
| `latest-run.json` | JSON | Raw structured results |

Artifacts are uploaded under the name `eval-reports` and can be downloaded from the workflow run summary.

## Secrets Setup

### Required for `llm` Layer

| Secret | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key for LLM-judged evaluations |

### Optional

| Secret | Description |
|---|---|
| `ES_URL` | Elasticsearch URL (if your plugin connects to ES) |
| `ES_API_KEY` | Elasticsearch API key |

To add secrets, go to **Settings > Secrets and variables > Actions** in your repository.

## Advanced Usage

### Running Only Specific Layers

```yaml
- uses: your-org/cursor-plugin-evals/.github/action@main
  with:
    layers: 'static'  # fast, no external deps
```

### Monorepo Setup

```yaml
- uses: your-org/cursor-plugin-evals/.github/action@main
  with:
    working-directory: packages/my-plugin
    config-path: plugin-eval.yaml
```

### Quality Gate with PR Comment

```yaml
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/cursor-plugin-evals/.github/action@main
        id: eval
        with:
          layers: 'static unit integration'
      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Plugin Eval Results\n\n**Score:** ${{ steps.eval.outputs.score }}\n**Pass rate:** ${{ steps.eval.outputs.pass-rate }}%`
            })
```

### Full Layer Run with LLM

```yaml
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/cursor-plugin-evals/.github/action@main
        with:
          layers: 'static unit integration llm'
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Local Equivalent

The action runs the same command you can use locally:

```bash
npx cursor-plugin-evals run \
  --config plugin-eval.yaml \
  --layer static unit integration \
  --format json --format junit --format html \
  --ci
```
