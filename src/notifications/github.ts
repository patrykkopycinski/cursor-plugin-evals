import { execSync } from 'child_process';
import type { Notifier, NotificationPayload } from './types.js';

export class GitHubNotifier implements Notifier {
  readonly name = 'github';

  async send(payload: NotificationPayload): Promise<void> {
    const prNumber = process.env.GITHUB_PR_NUMBER ?? process.env.PR_NUMBER;
    const repo = process.env.GITHUB_REPOSITORY;

    if (!prNumber) {
      throw new Error('GitHubNotifier requires GITHUB_PR_NUMBER or PR_NUMBER environment variable');
    }

    const icon = payload.type === 'run-complete' ? '✅' : '❌';
    const lines = [`## ${icon} ${payload.title}`, '', payload.summary];

    if (payload.details) {
      lines.push('', '<details><summary>Details</summary>', '', payload.details, '', '</details>');
    }

    if (payload.score !== undefined) {
      lines.push('', `**Score:** ${payload.score.toFixed(2)}`);
    }
    if (payload.passRate !== undefined) {
      lines.push(`**Pass Rate:** ${(payload.passRate * 100).toFixed(1)}%`);
    }
    if (payload.url) {
      lines.push('', `[View full report](${payload.url})`);
    }

    const body = lines.join('\n');
    const repoFlag = repo ? ` --repo ${repo}` : '';
    const cmd = `gh pr comment ${prNumber}${repoFlag} --body ${JSON.stringify(body)}`;

    try {
      execSync(cmd, { stdio: 'pipe', timeout: 30_000 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub PR comment failed: ${message}`);
    }
  }
}
