import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { runStaticSuite } from './index.js';
import { discoverPlugin } from '../../plugin/discovery.js';
import type { SuiteConfig, PluginManifest, StaticTestConfig } from '../../core/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `static-test-${randomUUID().slice(0, 8)}`);
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

function makeSuite(checks: StaticTestConfig[]): SuiteConfig {
  return { name: 'test-suite', layer: 'static', tests: checks };
}

function setupFullPlugin(dir: string): PluginManifest {
  writeJson(dir, '.cursor-plugin/plugin.json', {
    name: 'test-plugin',
    description: 'A test plugin',
    version: '1.0.0',
  });
  writeText(dir, 'skills/helper/SKILL.md', '---\nname: helper\ndescription: A helpful assistant skill for daily automation tasks.\n---\n# Helper\n\n## Instructions\n- Do helpful things');
  writeText(dir, 'rules/prefer-const.mdc', '---\ndescription: Prefer const over let\nalwaysApply: true\n---\nAlways use const for variables that are never reassigned.');
  writeText(dir, 'agents/reviewer.md', '---\nname: reviewer\ndescription: Code reviewer agent\nmodel: fast\n---\n# Reviewer\nReview code.');
  writeText(dir, 'commands/deploy.md', '---\nname: deploy\ndescription: Deploy to staging\n---\n# Deploy\nDeploy steps.');
  return discoverPlugin(dir);
}

describe('Static Layer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('manifest check', () => {
    it('passes for valid manifest', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'manifest-check', check: 'manifest' }]),
        manifest,
      );
      expect(results).toHaveLength(1);
      expect(results[0].pass).toBe(true);
    });

    it('fails for non-kebab-case name', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'MyPlugin' });
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'manifest-check', check: 'manifest' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('kebab-case');
    });
  });

  describe('skill_frontmatter check', () => {
    it('passes for well-formed skills', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'skill-fm', check: 'skill_frontmatter' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('fails for short description', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeText(tmpDir, 'skills/bad/SKILL.md', '---\nname: bad\ndescription: Short\n---\nBody');
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'skill-fm', check: 'skill_frontmatter' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('too short');
    });

    it('fails for missing name', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeText(tmpDir, 'skills/noname/SKILL.md', '---\ndescription: A reasonably long description for testing.\n---\nBody');
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'skill-fm', check: 'skill_frontmatter' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('missing "name"');
    });

    it('passes when no skills exist', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'skill-fm', check: 'skill_frontmatter' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });
  });

  describe('rule_frontmatter check', () => {
    it('passes for valid rules', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'rule-fm', check: 'rule_frontmatter' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('fails for missing description', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeText(tmpDir, 'rules/bad.mdc', '---\nalwaysApply: true\n---\nBody');
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'rule-fm', check: 'rule_frontmatter' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('missing "description"');
    });
  });

  describe('agent_frontmatter check', () => {
    it('passes for valid agents', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'agent-fm', check: 'agent_frontmatter' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });
  });

  describe('command_frontmatter check', () => {
    it('passes for valid commands', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'cmd-fm', check: 'command_frontmatter' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });
  });

  describe('hooks_schema check', () => {
    it('passes when no hooks exist', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'hooks', check: 'hooks_schema' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('passes for valid hooks', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeJson(tmpDir, 'hooks/hooks.json', {
        version: 1,
        hooks: { stop: [{ command: 'echo done' }] },
      });
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'hooks', check: 'hooks_schema' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('flags unknown hook events', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeJson(tmpDir, 'hooks/hooks.json', {
        hooks: { madeUpEvent: [{ command: 'echo' }] },
      });
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'hooks', check: 'hooks_schema' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('madeUpEvent');
    });
  });

  describe('mcp_config check', () => {
    it('passes when no MCP servers exist', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'mcp', check: 'mcp_config' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('passes for valid MCP config', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeJson(tmpDir, '.mcp.json', { mcpServers: { pg: { command: 'npx', args: ['pg-server'] } } });
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'mcp', check: 'mcp_config' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('fails when server has no command or url', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeJson(tmpDir, '.mcp.json', { mcpServers: { bad: { env: {} } } });
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'mcp', check: 'mcp_config' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('needs either');
    });
  });

  describe('component_references check', () => {
    it('passes when all references resolve', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeText(tmpDir, 'skills/deploy-helper/SKILL.md', '---\nname: deploy-helper\ndescription: Help with deployment tasks and automation.\n---\nBody');
      writeText(tmpDir, 'commands/deploy.md', '---\ndescription: Deploy\nallowed-tools: Skill(deploy-helper)\n---\nBody');
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'refs', check: 'component_references' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('fails when command references nonexistent skill', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeText(tmpDir, 'commands/deploy.md', '---\ndescription: Deploy\nallowed-tools: Skill(nonexistent)\n---\nBody');
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'refs', check: 'component_references' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('nonexistent');
    });
  });

  describe('cross_component_coherence check', () => {
    it('passes when no duplicate names', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'coherence', check: 'cross_component_coherence' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('fails when skill and agent share a name', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeText(tmpDir, 'skills/dupe/SKILL.md', '---\nname: dupe\ndescription: A duplicate name skill for testing conflicts.\n---\nBody');
      writeText(tmpDir, 'agents/dupe.md', '---\nname: dupe\ndescription: Duplicate agent\n---\nBody');
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'coherence', check: 'cross_component_coherence' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('Duplicate name "dupe"');
    });
  });

  describe('naming_conventions check', () => {
    it('passes for kebab-case names', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'naming', check: 'naming_conventions' }]),
        manifest,
      );
      expect(results[0].pass).toBe(true);
    });

    it('fails for non-kebab-case names', async () => {
      writeJson(tmpDir, '.cursor-plugin/plugin.json', { name: 'test-plugin' });
      writeText(tmpDir, 'skills/badName/SKILL.md', '---\nname: badName\ndescription: A skill with bad camelCase naming convention.\n---\nBody');
      const manifest = discoverPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'naming', check: 'naming_conventions' }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('not kebab-case');
    });
  });

  describe('unknown check type', () => {
    it('reports error for unknown check', async () => {
      const manifest = setupFullPlugin(tmpDir);
      const results = await runStaticSuite(
        makeSuite([{ name: 'bad', check: 'nonexistent' as any }]),
        manifest,
      );
      expect(results[0].pass).toBe(false);
      expect(results[0].error).toContain('Unknown check type');
    });
  });
});
