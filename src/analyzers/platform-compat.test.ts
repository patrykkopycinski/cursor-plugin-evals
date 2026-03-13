import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { checkPlatformCompatibility, formatCompatibilityReport } from './platform-compat.js';

const TMP_DIR = join(__dirname, '__tmp_platform_compat_test__');

function scaffold(structure: Record<string, string | Record<string, string>>): void {
  for (const [path, content] of Object.entries(structure)) {
    const fullPath = join(TMP_DIR, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    if (typeof content === 'string') {
      writeFileSync(fullPath, content, 'utf-8');
    }
  }
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('checkPlatformCompatibility', () => {
  describe('cursor', () => {
    it('passes all checks for a valid plugin', async () => {
      scaffold({
        '.cursor-plugin/plugin.json': JSON.stringify({
          name: 'my-plugin',
          description: 'A test plugin',
          mcpServers: {
            main: { command: 'node', args: ['server.js'] },
          },
        }),
        'skills/my-skill/SKILL.md': '---\nname: my-skill\n---\n# My Skill',
        'rules/my-rule.mdc': '---\ndescription: test\n---\nRule body',
      });

      const report = await checkPlatformCompatibility(TMP_DIR, ['cursor']);
      const cursor = report.platforms[0];

      expect(cursor.platform).toBe('cursor');
      expect(cursor.compatible).toBe(true);
      expect(cursor.passedChecks).toBe(cursor.totalChecks);
    });

    it('fails when manifest is missing', async () => {
      const report = await checkPlatformCompatibility(TMP_DIR, ['cursor']);
      const cursor = report.platforms[0];

      expect(cursor.compatible).toBe(false);
      expect(cursor.results[0].passed).toBe(false);
    });

    it('fails for non-kebab-case name', async () => {
      scaffold({
        '.cursor-plugin/plugin.json': JSON.stringify({
          name: 'My Plugin',
          description: 'Bad name',
        }),
      });

      const report = await checkPlatformCompatibility(TMP_DIR, ['cursor']);
      const nameCheck = report.platforms[0].results.find((r) =>
        r.requirement.includes('kebab-case'),
      );

      expect(nameCheck).toBeDefined();
      expect(nameCheck!.passed).toBe(false);
    });
  });

  describe('claude-code', () => {
    it('passes when .cursor-plugin can be adapted', async () => {
      scaffold({
        '.cursor-plugin/plugin.json': JSON.stringify({
          name: 'my-plugin',
          description: 'Adaptable',
        }),
        'CLAUDE.md': '# Claude instructions',
        '.mcp.json': JSON.stringify({ server: { command: 'node' } }),
      });

      const report = await checkPlatformCompatibility(TMP_DIR, ['claude-code']);
      const claude = report.platforms[0];

      expect(claude.compatible).toBe(true);
    });

    it('fails when no manifest exists', async () => {
      const report = await checkPlatformCompatibility(TMP_DIR, ['claude-code']);
      const claude = report.platforms[0];

      expect(claude.compatible).toBe(false);
    });
  });

  describe('chatgpt', () => {
    it('passes when HTTP transport is configured', async () => {
      scaffold({
        '.mcp.json': JSON.stringify({
          server: { url: 'https://example.com/mcp', type: 'sse' },
        }),
      });

      const report = await checkPlatformCompatibility(TMP_DIR, ['chatgpt']);
      const chatgpt = report.platforms[0];
      const httpCheck = chatgpt.results.find((r) => r.requirement.includes('HTTP/SSE'));

      expect(httpCheck).toBeDefined();
      expect(httpCheck!.passed).toBe(true);
    });

    it('fails when only stdio transport is available', async () => {
      scaffold({
        '.mcp.json': JSON.stringify({
          server: { command: 'node', args: ['server.js'] },
        }),
      });

      const report = await checkPlatformCompatibility(TMP_DIR, ['chatgpt']);
      const chatgpt = report.platforms[0];
      const httpCheck = chatgpt.results.find((r) => r.requirement.includes('HTTP/SSE'));

      expect(httpCheck).toBeDefined();
      expect(httpCheck!.passed).toBe(false);
    });
  });

  describe('generic-mcp', () => {
    it('passes with valid MCP configuration', async () => {
      scaffold({
        '.mcp.json': JSON.stringify({ server: { command: 'node' } }),
      });

      const report = await checkPlatformCompatibility(TMP_DIR, ['generic-mcp']);
      const generic = report.platforms[0];

      expect(generic.compatible).toBe(true);
    });

    it('detects platform-specific assumptions in source', async () => {
      scaffold({
        '.mcp.json': JSON.stringify({ server: { command: 'node' } }),
        'src/index.ts': 'const path = ".cursor-plugin/plugin.json";',
      });

      const report = await checkPlatformCompatibility(TMP_DIR, ['generic-mcp']);
      const generic = report.platforms[0];
      const assumption = generic.results.find((r) =>
        r.requirement.includes('No Cursor/Claude-specific'),
      );

      expect(assumption).toBeDefined();
      expect(assumption!.passed).toBe(false);
    });
  });

  describe('overall score', () => {
    it('returns 100 for fully compatible plugin', async () => {
      scaffold({
        '.cursor-plugin/plugin.json': JSON.stringify({
          name: 'my-plugin',
          description: 'Full compat',
          mcpServers: {
            main: { url: 'https://example.com/mcp', type: 'sse', command: 'node' },
          },
        }),
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'my-plugin' }),
        '.mcp.json': JSON.stringify({
          server: { url: 'https://example.com/mcp', type: 'sse' },
        }),
        'CLAUDE.md': '# Claude',
        'skills/s1/SKILL.md': '# Skill',
        'rules/r1.mdc': '# Rule',
      });

      const report = await checkPlatformCompatibility(TMP_DIR);

      expect(report.overallScore).toBeGreaterThanOrEqual(80);
      expect(report.platforms).toHaveLength(4);
    });

    it('returns 0 for empty directory', async () => {
      const report = await checkPlatformCompatibility(TMP_DIR);

      expect(report.overallScore).toBeLessThan(50);
      expect(report.universallyCompatible).toBe(false);
    });
  });
});

describe('formatCompatibilityReport', () => {
  it('produces readable markdown output', async () => {
    scaffold({
      '.cursor-plugin/plugin.json': JSON.stringify({
        name: 'test-plugin',
        description: 'Test',
      }),
    });

    const report = await checkPlatformCompatibility(TMP_DIR, ['cursor']);
    const output = formatCompatibilityReport(report);

    expect(output).toContain('# Cross-Platform Compatibility Report');
    expect(output).toContain('Overall Score');
    expect(output).toContain('cursor');
  });
});
