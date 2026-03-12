import { describe, it, expect } from 'vitest';
import { generateGitHubActionsYaml } from '../templates/github-actions.js';
import { generateGitLabCiYaml } from '../templates/gitlab-ci.js';
import { generateShellScript } from '../templates/shell-script.js';

describe('GitHub Actions template', () => {
  const yaml = generateGitHubActionsYaml();

  it('is a non-empty string', () => {
    expect(yaml).toBeTruthy();
    expect(typeof yaml).toBe('string');
  });

  it('contains workflow trigger configuration', () => {
    expect(yaml).toContain('on:');
    expect(yaml).toContain('push:');
    expect(yaml).toContain('pull_request:');
  });

  it('contains layer matrix strategy', () => {
    expect(yaml).toContain('matrix:');
    expect(yaml).toContain('layer: [static, unit, integration, llm]');
  });

  it('contains node setup', () => {
    expect(yaml).toContain('actions/setup-node@v4');
    expect(yaml).toContain("node-version: '20'");
  });

  it('contains fixture caching', () => {
    expect(yaml).toContain('actions/cache@v4');
    expect(yaml).toContain('.cursor-plugin-evals/fixtures');
  });

  it('contains docker compose lifecycle', () => {
    expect(yaml).toContain('docker compose up -d');
    expect(yaml).toContain('docker compose down');
  });

  it('contains --ci flag in eval run', () => {
    expect(yaml).toContain('--ci');
    expect(yaml).toContain('--report json');
  });

  it('contains artifact upload', () => {
    expect(yaml).toContain('actions/upload-artifact@v4');
  });
});

describe('GitLab CI template', () => {
  const yaml = generateGitLabCiYaml();

  it('is a non-empty string', () => {
    expect(yaml).toBeTruthy();
    expect(typeof yaml).toBe('string');
  });

  it('contains stages definition', () => {
    expect(yaml).toContain('stages:');
    expect(yaml).toContain('- eval');
  });

  it('contains eval jobs for all layers', () => {
    expect(yaml).toContain('eval-static:');
    expect(yaml).toContain('eval-unit:');
    expect(yaml).toContain('eval-integration:');
    expect(yaml).toContain('eval-llm:');
  });

  it('contains Docker-in-Docker service for integration/llm', () => {
    expect(yaml).toContain('docker:dind');
  });

  it('contains --ci flag in eval run', () => {
    expect(yaml).toContain('--ci');
  });

  it('contains artifact configuration', () => {
    expect(yaml).toContain('artifacts:');
    expect(yaml).toContain('when: always');
  });

  it('contains shared base template', () => {
    expect(yaml).toContain('.eval-base:');
    expect(yaml).toContain('extends: .eval-base');
  });
});

describe('Shell script template', () => {
  const script = generateShellScript();

  it('is a non-empty string', () => {
    expect(script).toBeTruthy();
    expect(typeof script).toBe('string');
  });

  it('starts with shebang', () => {
    expect(script).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it('uses strict mode', () => {
    expect(script).toContain('set -euo pipefail');
  });

  it('checks for node prerequisite', () => {
    expect(script).toContain('command -v node');
  });

  it('checks node version', () => {
    expect(script).toContain('NODE_MAJOR');
    expect(script).toContain('-lt 20');
  });

  it('contains docker compose lifecycle', () => {
    expect(script).toContain('docker compose');
    expect(script).toContain('cleanup()');
    expect(script).toContain('trap cleanup EXIT');
  });

  it('supports --layer and --mock flags', () => {
    expect(script).toContain('--layer)');
    expect(script).toContain('--mock)');
  });

  it('runs eval with --ci flag', () => {
    expect(script).toContain('cursor-plugin-evals run');
    expect(script).toContain('--ci');
  });

  it('exits with evaluation exit code', () => {
    expect(script).toContain('exit $EXIT_CODE');
  });
});
