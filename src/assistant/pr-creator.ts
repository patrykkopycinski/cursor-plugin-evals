import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { PrRequest, PrResult, GeneratedFix } from './types.js';

export async function applyFixes(rootDir: string, fixes: GeneratedFix[]): Promise<string[]> {
  const applied: string[] = [];

  for (const fix of fixes) {
    for (const file of fix.files) {
      const fullPath = join(rootDir, file.path);
      await mkdir(dirname(fullPath), { recursive: true });

      if (file.action === 'create') {
        await writeFile(fullPath, file.content, 'utf-8');
        applied.push(`Created ${file.path}`);
      } else if (file.action === 'append') {
        const { readFile: rf } = await import('node:fs/promises');
        let existing = '';
        try {
          existing = await rf(fullPath, 'utf-8');
        } catch (_e) {
          // file doesn't exist — create it
        }
        await writeFile(fullPath, existing + file.content, 'utf-8');
        applied.push(`Updated ${file.path}`);
      } else if (file.action === 'modify') {
        await writeFile(fullPath, file.content, 'utf-8');
        applied.push(`Modified ${file.path}`);
      }
    }
  }

  return applied;
}

export async function createPr(request: PrRequest): Promise<PrResult> {
  const { execSync } = await import('child_process');
  const cwd = request.repoDir;

  try {
    execSync('which gh', { encoding: 'utf-8', cwd });
  } catch (_e) {
    return { success: false, error: 'GitHub CLI (gh) not found. Install: https://cli.github.com' };
  }

  try {
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      cwd,
    }).trim();

    execSync(`git checkout -b ${request.branchName}`, { cwd, stdio: 'pipe' });

    const applied = await applyFixes(cwd, request.fixes);
    if (applied.length === 0) {
      execSync(`git checkout ${currentBranch}`, { cwd, stdio: 'pipe' });
      execSync(`git branch -D ${request.branchName}`, { cwd, stdio: 'pipe' });
      return { success: false, error: 'No files to commit' };
    }

    execSync('git add -A', { cwd, stdio: 'pipe' });

    const commitMsg = `fix: ${request.title}\n\n${request.body.slice(0, 500)}`;
    execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd, stdio: 'pipe' });
    execSync(`git push -u origin ${request.branchName}`, { cwd, stdio: 'pipe' });

    const labels = request.labels?.length ? `--label ${request.labels.join(',')}` : '';
    const draft = request.draft ? '--draft' : '';

    const prOutput = execSync(
      `gh pr create --title ${JSON.stringify(request.title)} --body ${JSON.stringify(request.body)} ${labels} ${draft}`,
      { encoding: 'utf-8', cwd },
    ).trim();

    const prUrlMatch = prOutput.match(/https:\/\/github\.com\/.+\/pull\/\d+/);
    const prNumberMatch = prOutput.match(/\/pull\/(\d+)/);

    execSync(`git checkout ${currentBranch}`, { cwd, stdio: 'pipe' });

    return {
      success: true,
      prUrl: prUrlMatch?.[0] ?? prOutput,
      prNumber: prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: `PR creation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
