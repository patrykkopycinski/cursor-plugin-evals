import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './logger.js';
import { generateGitHubActionsYaml } from '../templates/github-actions.js';
import { generateGitLabCiYaml } from '../templates/gitlab-ci.js';
import { generateShellScript } from '../templates/shell-script.js';

export interface CiInitOptions {
  preset?: 'github' | 'gitlab' | 'shell';
  output?: string;
  interactive?: boolean;
}

const PRESETS: Record<string, { generator: () => string; defaultPath: string; label: string }> = {
  github: {
    generator: generateGitHubActionsYaml,
    defaultPath: '.github/workflows/plugin-eval.yml',
    label: 'GitHub Actions',
  },
  gitlab: {
    generator: generateGitLabCiYaml,
    defaultPath: '.gitlab-ci.yml',
    label: 'GitLab CI',
  },
  shell: {
    generator: generateShellScript,
    defaultPath: 'eval-ci.sh',
    label: 'Shell script',
  },
};

export async function ciInitCommand(opts: CiInitOptions): Promise<void> {
  log.header('CI Init — Scaffold CI pipeline');

  let preset = opts.preset;

  if (!preset && opts.interactive !== false) {
    const { select } = await import('@inquirer/prompts');
    preset = await select({
      message: 'CI platform:',
      choices: [
        { value: 'github' as const, name: 'GitHub Actions' },
        { value: 'gitlab' as const, name: 'GitLab CI' },
        { value: 'shell' as const, name: 'Shell script (portable)' },
      ],
    });
  }

  if (!preset) {
    log.error('No preset specified. Use --preset github|gitlab|shell');
    return;
  }

  const config = PRESETS[preset];
  if (!config) {
    log.error(`Unknown preset: ${preset}. Choose github, gitlab, or shell.`);
    return;
  }

  const content = config.generator();
  const outputPath = resolve(process.cwd(), opts.output ?? config.defaultPath);

  const { mkdirSync } = await import('fs');
  const { dirname } = await import('path');
  mkdirSync(dirname(outputPath), { recursive: true });

  writeFileSync(outputPath, content, 'utf-8');
  log.success(`${config.label} config written to ${outputPath}`);

  if (preset === 'shell') {
    const { chmodSync } = await import('fs');
    chmodSync(outputPath, 0o755);
    log.info('  Made script executable (chmod +x)');
  }
}
