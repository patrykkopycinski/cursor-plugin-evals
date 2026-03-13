import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DEFAULT_DIR = '.cursor-plugin-evals/baselines';

function resolveDir(dir?: string): string {
  return dir ?? DEFAULT_DIR;
}

export async function saveBaseline(
  name: string,
  screenshot: Buffer,
  dir?: string,
): Promise<string> {
  const baseDir = resolveDir(dir);
  await fs.mkdir(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${name}.png`);
  await fs.writeFile(filePath, screenshot);
  return filePath;
}

export async function loadBaseline(name: string, dir?: string): Promise<Buffer | null> {
  const baseDir = resolveDir(dir);
  const filePath = path.join(baseDir, `${name}.png`);

  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}
