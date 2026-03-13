# Notifications

Send evaluation results to Slack, GitHub PRs, and generic webhooks with configurable triggers.

## YAML Config

```yaml
notifications:
  slack:
    webhook_url: ${SLACK_WEBHOOK_URL}
  github:
    token: ${GITHUB_TOKEN}
    repo: owner/repo
  webhook:
    url: https://hooks.example.com/eval-results
    headers:
      X-Api-Key: ${WEBHOOK_API_KEY}
  triggers:
    - on: failure
    - on: score_drop
      threshold: 0.05
    - on: always
```

## Slack Webhook

Posts a formatted message to a Slack channel with the overall score, pass rate, and failure summary.

### Setup

1. Create a Slack incoming webhook at [api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks).
2. Set the `SLACK_WEBHOOK_URL` environment variable.
3. Add the `slack` section to your config.

```yaml
notifications:
  slack:
    webhook_url: ${SLACK_WEBHOOK_URL}
```

The message includes:
- Overall score and grade
- Pass/fail counts
- List of failing tests (up to 10)
- Link to the full report (if available)

## GitHub PR Comments

Posts evaluation results as a comment on the current pull request.

### Setup

1. Create a GitHub personal access token with `repo` scope.
2. Set `GITHUB_TOKEN` and configure the `github` section.

```yaml
notifications:
  github:
    token: ${GITHUB_TOKEN}
    repo: owner/repo
```

The comment is posted to the PR associated with the current branch. It includes a summary table and expandable details for failures.

## Generic Webhooks

Send a JSON payload to any HTTP endpoint.

```yaml
notifications:
  webhook:
    url: https://hooks.example.com/eval
    headers:
      Authorization: "Bearer ${WEBHOOK_TOKEN}"
      Content-Type: application/json
```

### Payload Format

```json
{
  "runId": "abc123",
  "timestamp": "2026-03-13T10:00:00.000Z",
  "score": 92,
  "passRate": 96.5,
  "grade": "A",
  "total": 20,
  "passed": 19,
  "failed": 1,
  "failures": [
    {
      "suite": "llm-e2e",
      "test": "edge-case",
      "evaluator": "tool-selection",
      "score": 0.45
    }
  ]
}
```

## Trigger Configuration

Control when notifications fire:

| Trigger | Description |
|---------|-------------|
| `failure` | Send when any test fails |
| `score_drop` | Send when score drops by more than `threshold` from baseline |
| `always` | Send on every run |

```yaml
  triggers:
    - on: failure
    - on: score_drop
      threshold: 0.1     # 10% drop
```

Multiple triggers can be combined. The notification fires if any trigger matches.

## Programmatic API

```typescript
import { createNotifiers, sendNotifications } from 'cursor-plugin-evals';
import type { NotificationConfig, NotificationPayload } from 'cursor-plugin-evals';

const config: NotificationConfig = {
  slack: { webhookUrl: process.env.SLACK_WEBHOOK_URL! },
  github: { token: process.env.GITHUB_TOKEN!, repo: 'owner/repo' },
};

const notifiers = createNotifiers(config);

const payload: NotificationPayload = {
  runId: 'abc123',
  timestamp: new Date().toISOString(),
  score: 92,
  passRate: 96.5,
  grade: 'A',
  total: 20,
  passed: 19,
  failed: 1,
  failures: [
    { suite: 'llm-e2e', test: 'edge-case', evaluator: 'tool-selection', score: 0.45 },
  ],
};

await sendNotifications(notifiers, payload);
```

## See Also

- [CI/CD Integration](./ci-cd.md)
- [Configuration Reference](./configuration.md)
- [Production Monitoring](./monitoring.md)
