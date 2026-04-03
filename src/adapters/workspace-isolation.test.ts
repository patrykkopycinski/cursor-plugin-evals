import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readlinkSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  copyDirFiltered,
  EVAL_INFRA_BLOCKLIST,
  createSimpleWorkspaceCopy,
  findProjectRoot,
} from './workspace-isolation.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), 'ws-iso-test-' + randomBytes(6).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_e) {
      // best-effort
    }
  }
  cleanupDirs.length = 0;
});

describe('EVAL_INFRA_BLOCKLIST', () => {
  it('contains expected files', () => {
    expect(EVAL_INFRA_BLOCKLIST.has('eval.yaml')).toBe(true);
    expect(EVAL_INFRA_BLOCKLIST.has('eval-defaults.yaml')).toBe(true);
    expect(EVAL_INFRA_BLOCKLIST.has('eval-defaults.yml')).toBe(true);
  });

  it('does not contain regular files', () => {
    expect(EVAL_INFRA_BLOCKLIST.has('SKILL.md')).toBe(false);
    expect(EVAL_INFRA_BLOCKLIST.has('index.ts')).toBe(false);
  });
});

describe('copyDirFiltered', () => {
  it('copies files while skipping blocklisted ones', async () => {
    const src = makeTmpDir();
    const dest = makeTmpDir();
    cleanupDirs.push(src, dest);

    writeFileSync(join(src, 'SKILL.md'), '# Skill');
    writeFileSync(join(src, 'eval.yaml'), 'tests: []');
    writeFileSync(join(src, 'eval-defaults.yaml'), 'defaults: {}');
    writeFileSync(join(src, 'helper.ts'), 'export {}');

    const destCopy = join(dest, 'output');
    await copyDirFiltered(src, destCopy);

    expect(existsSync(join(destCopy, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(destCopy, 'helper.ts'))).toBe(true);
    expect(existsSync(join(destCopy, 'eval.yaml'))).toBe(false);
    expect(existsSync(join(destCopy, 'eval-defaults.yaml'))).toBe(false);
  });

  it('copies subdirectories recursively', async () => {
    const src = makeTmpDir();
    const dest = makeTmpDir();
    cleanupDirs.push(src, dest);

    mkdirSync(join(src, 'sub'));
    writeFileSync(join(src, 'sub', 'file.txt'), 'content');

    const destCopy = join(dest, 'output');
    await copyDirFiltered(src, destCopy);

    expect(readFileSync(join(destCopy, 'sub', 'file.txt'), 'utf-8')).toBe('content');
  });

  it('creates dest directory if it does not exist', async () => {
    const src = makeTmpDir();
    cleanupDirs.push(src);

    writeFileSync(join(src, 'file.txt'), 'data');
    const dest = join(tmpdir(), 'ws-iso-noexist-' + randomBytes(4).toString('hex'), 'deep', 'path');
    cleanupDirs.push(dest);

    await copyDirFiltered(src, dest);
    expect(existsSync(join(dest, 'file.txt'))).toBe(true);
  });
});

describe('createSimpleWorkspaceCopy', () => {
  it('creates symlinks for all root entries except .git', async () => {
    const root = makeTmpDir();
    cleanupDirs.push(root);

    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main');

    const ws = await createSimpleWorkspaceCopy(root);
    cleanupDirs.push(ws.dir);

    expect(existsSync(join(ws.dir, 'src'))).toBe(true);
    expect(existsSync(join(ws.dir, 'package.json'))).toBe(true);
    expect(existsSync(join(ws.dir, '.git'))).toBe(false);

    // Verify they are symlinks pointing back to original
    expect(readlinkSync(join(ws.dir, 'src'))).toBe(join(root, 'src'));
    expect(readlinkSync(join(ws.dir, 'package.json'))).toBe(join(root, 'package.json'));

    expect(ws.includedSkills).toEqual([]);
    expect(ws.skillDir).toBeNull();
  });

  it('cleanup removes the workspace directory', async () => {
    const root = makeTmpDir();
    cleanupDirs.push(root);
    writeFileSync(join(root, 'file.txt'), 'data');

    const ws = await createSimpleWorkspaceCopy(root);
    expect(existsSync(ws.dir)).toBe(true);

    await ws.cleanup();
    expect(existsSync(ws.dir)).toBe(false);
  });
});

describe('findProjectRoot', () => {
  it('finds root by .git marker', async () => {
    const root = makeTmpDir();
    cleanupDirs.push(root);

    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'src', 'deep', 'nested'), { recursive: true });

    const found = await findProjectRoot(join(root, 'src', 'deep', 'nested'));
    expect(found).toBe(root);
  });

  it('finds root by custom marker', async () => {
    const root = makeTmpDir();
    cleanupDirs.push(root);

    writeFileSync(join(root, 'package.json'), '{}');
    mkdirSync(join(root, 'a', 'b'), { recursive: true });

    const found = await findProjectRoot(join(root, 'a', 'b'), ['package.json']);
    expect(found).toBe(root);
  });

  it('returns parent of startDir when no marker found', async () => {
    const isolated = makeTmpDir();
    cleanupDirs.push(isolated);

    mkdirSync(join(isolated, 'child'), { recursive: true });

    const found = await findProjectRoot(join(isolated, 'child'), ['nonexistent-marker']);
    // Should return dirname of startDir
    expect(found).toBe(isolated);
  });
});
