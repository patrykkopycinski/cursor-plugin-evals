import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { FixtureEntry } from './recorder.js';

interface ToolFixtures {
  toolName: string;
  entries: FixtureEntry[];
}

async function loadFixtures(fixtureDir: string): Promise<ToolFixtures[]> {
  let files: string[];
  try {
    files = await readdir(fixtureDir);
  } catch (err: unknown) {
    const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isNotFound) throw new Error(`Fixture directory not found: ${fixtureDir}`);
    throw err;
  }

  const jsonlGzFiles = files.filter((f) => f.endsWith('.jsonl.gz'));
  if (jsonlGzFiles.length === 0) {
    throw new Error(`No .jsonl.gz files found in ${fixtureDir}`);
  }

  const results: ToolFixtures[] = [];

  for (const file of jsonlGzFiles) {
    const filePath = join(fixtureDir, file);
    const compressed = await readFile(filePath);
    const decompressed = gunzipSync(compressed);
    const lines = decompressed.toString('utf-8').split('\n').filter((l) => l.trim().length > 0);
    const entries = lines.map((line) => JSON.parse(line) as FixtureEntry);
    const toolName = file.replace(/\.jsonl\.gz$/, '');
    results.push({ toolName, entries });
  }

  return results;
}

function generateServerSource(allFixtures: ToolFixtures[]): string {
  const fixtureData: Record<string, Array<{ argsHash: string; result: unknown }>> = {};

  for (const { toolName, entries } of allFixtures) {
    fixtureData[toolName] = entries.map((e) => ({
      argsHash: e.argsHash,
      result: e.result,
    }));
  }

  const jsonData = JSON.stringify(fixtureData);
  const b64Data = Buffer.from(jsonData).toString('base64');

  return `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash } from "node:crypto";

const FIXTURE_DATA_B64 = ${JSON.stringify(b64Data)};

function loadFixtures() {
  const json = Buffer.from(FIXTURE_DATA_B64, "base64").toString("utf-8");
  return JSON.parse(json);
}

function hashArgs(args) {
  const sorted = JSON.stringify(args, Object.keys(args).sort());
  return createHash("sha256").update(sorted).digest("hex");
}

const fixtures = loadFixtures();

const server = new Server(
  { name: "mock-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(
  { method: "tools/list" },
  async () => ({
    tools: Object.keys(fixtures).map((name) => ({
      name,
      description: \`Mock tool: \${name}\`,
      inputSchema: { type: "object", properties: {} },
    })),
  })
);

server.setRequestHandler(
  { method: "tools/call" },
  async (request) => {
    const { name, arguments: args = {} } = request.params;
    const entries = fixtures[name];

    if (!entries || entries.length === 0) {
      return {
        content: [{ type: "text", text: \`Unknown tool: \${name}\` }],
        isError: true,
      };
    }

    const argsHash = hashArgs(args);
    const exact = entries.find((e) => e.argsHash === argsHash);
    if (exact) {
      return exact.result;
    }

    return entries[0].result;
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Mock server failed:", err);
  process.exit(1);
});
`;
}

export async function generateMockServer(fixtureDir: string, outputPath: string): Promise<void> {
  const allFixtures = await loadFixtures(fixtureDir);
  const source = generateServerSource(allFixtures);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source, 'utf-8');
}

export { generateServerSource as _generateServerSource };
export { loadFixtures as _loadFixtures };
