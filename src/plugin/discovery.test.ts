import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { discoverPlugin } from '../plugin/discovery.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `plugin-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(dir: string, relativePath: string, obj: unknown): void {
  const parts = relativePath.split('/');
  if (parts.length > 1) {
    mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
  }
  writeFileSync(join(dir, relativePath), JSON.stringify(obj, null, 2));
}

function writeText(dir: string, relativePath: string, content: string): void {
  const parts = relativePath.split('/');
  if (parts.length > 1) {
    mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
  }
  writeFileSync(join(dir, relativePath), content);
}

describe('discoverPlugin', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when plugin.json is missing', () => {
    expect(() => discoverPlugin(tmpDir)).toThrow('Plugin manifest not found');
  });

  it('throws when manifest has no name', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { description: 'No name' });
    expect(() => discoverPlugin(tmpDir)).toThrow('missing required "name" field');
  });

  it('discovers a minimal plugin with only a manifest', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
    const manifest = discoverPlugin(tmpDir);
    expect(manifest.name).toBe('test-plugin');
    expect(manifest.skills).toEqual([]);
    expect(manifest.rules).toEqual([]);
    expect(manifest.agents).toEqual([]);
    expect(manifest.commands).toEqual([]);
    expect(manifest.hooks).toEqual([]);
    expect(manifest.mcpServers).toEqual([]);
  });

  it('discovers skills in default directory', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
    writeText(
      tmpDir,
      'skills/code-review/SKILL.md',
      '---\nname: code-review\ndescription: Review code for quality issues and suggest improvements.\n---\n# Code Review\n\n## Instructions\n1. Check for bugs',
    );

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.skills[0].name).toBe('code-review');
    expect(manifest.skills[0].description).toBe(
      'Review code for quality issues and suggest improvements.',
    );
  });

  it('discovers root-level SKILL.md when no skills dir exists', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'single-skill' });
    writeText(
      tmpDir,
      'SKILL.md',
      '---\nname: root-skill\ndescription: A root-level skill for testing purposes.\n---\n# Root',
    );

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.skills[0].name).toBe('root-skill');
  });

  it('discovers skills in custom path from manifest', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', {
      name: 'test-plugin',
      skills: './my-skills/',
    });
    writeText(
      tmpDir,
      'my-skills/helper/SKILL.md',
      '---\nname: helper\ndescription: A helpful assistant skill for automation.\n---\n# Helper',
    );

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.skills[0].name).toBe('helper');
  });

  it('discovers rules in default directory', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
    writeText(
      tmpDir,
      'rules/prefer-const.mdc',
      '---\ndescription: Prefer const\nalwaysApply: true\n---\nUse const.',
    );

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.rules).toHaveLength(1);
    expect(manifest.rules[0].description).toBe('Prefer const');
    expect(manifest.rules[0].alwaysApply).toBe(true);
  });

  it('discovers agents', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
    writeText(
      tmpDir,
      'agents/reviewer.md',
      '---\nname: reviewer\ndescription: Code reviewer agent\nmodel: fast\n---\n# Reviewer',
    );

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.agents).toHaveLength(1);
    expect(manifest.agents[0].name).toBe('reviewer');
    expect(manifest.agents[0].model).toBe('fast');
  });

  it('discovers commands', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
    writeText(
      tmpDir,
      'commands/deploy.md',
      '---\nname: deploy\ndescription: Deploy to staging\nargument-hint: "[env]"\n---\n# Deploy',
    );

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.commands).toHaveLength(1);
    expect(manifest.commands[0].name).toBe('deploy');
    expect(manifest.commands[0].argumentHint).toBe('[env]');
  });

  it('discovers hooks from hooks.json', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
    writeJson(tmpDir, 'hooks/hooks.json', {
      version: 1,
      hooks: {
        stop: [{ command: 'echo done' }],
        afterFileEdit: [{ command: './scripts/fmt.sh' }],
      },
    });

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.hooks).toHaveLength(2);
    expect(manifest.hooks.map((h) => h.event).sort()).toEqual(['afterFileEdit', 'stop']);
  });

  it('discovers MCP servers from .mcp.json', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
    writeJson(tmpDir, '.mcp.json', {
      mcpServers: {
        postgres: { command: 'npx', args: ['-y', 'pg-server'], env: { PG_URL: 'localhost' } },
        figma: { type: 'http', url: 'https://mcp.figma.com/mcp' },
      },
    });

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.mcpServers).toHaveLength(2);
    const pg = manifest.mcpServers.find((s) => s.name === 'postgres');
    expect(pg?.command).toBe('npx');
    expect(pg?.args).toEqual(['-y', 'pg-server']);
    const figma = manifest.mcpServers.find((s) => s.name === 'figma');
    expect(figma?.type).toBe('http');
    expect(figma?.url).toBe('https://mcp.figma.com/mcp');
  });

  it('discovers a full plugin with all components', () => {
    writeJson(tmpDir, '.cursor-plugin/plugin.json', {
      name: 'full-plugin',
      description: 'A complete plugin',
      version: '1.0.0',
    });
    writeText(
      tmpDir,
      'skills/s1/SKILL.md',
      '---\nname: s1\ndescription: Skill one does important validation work.\n---\nBody',
    );
    writeText(tmpDir, 'rules/r1.mdc', '---\ndescription: Rule one\n---\nBody');
    writeText(tmpDir, 'agents/a1.md', '---\nname: a1\ndescription: Agent one\n---\nBody');
    writeText(tmpDir, 'commands/c1.md', '---\ndescription: Command one\n---\nBody');

    const manifest = discoverPlugin(tmpDir);
    expect(manifest.name).toBe('full-plugin');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.rules).toHaveLength(1);
    expect(manifest.agents).toHaveLength(1);
    expect(manifest.commands).toHaveLength(1);
  });

  it('uses pluginRoot to find manifest in a subdirectory', () => {
    const subDir = join(tmpDir, 'nested');
    mkdirSync(subDir, { recursive: true });
    writeJson(subDir, '.cursor-plugin/plugin.json', { name: 'nested-plugin' });

    const manifest = discoverPlugin(tmpDir, 'nested');
    expect(manifest.name).toBe('nested-plugin');
  });
});
