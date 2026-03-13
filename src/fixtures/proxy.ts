import type { ToolResult } from '../core/types.js';
import type { McpPluginClient } from '../mcp/client.js';
import { McpFixtureResponder } from './responder.js';
import { McpFixtureRecorder } from './recorder.js';

export type ProxyMode = 'mock' | 'passthrough' | 'hybrid';

export interface ProxyConfig {
  mode: ProxyMode;
  fixtureDir: string;
  fallbackClient?: McpPluginClient;
  recordMisses?: boolean;
  compareResponses?: boolean;
}

export interface ProxyResponse {
  result: ToolResult;
  source: 'fixture' | 'live';
  matchType: 'exact' | 'fuzzy' | 'miss';
  comparison?: ResponseComparison;
  latencyMs: number;
}

export interface ResponseComparison {
  match: boolean;
  fixtureResult: ToolResult | null;
  liveResult: ToolResult | null;
  differences: string[];
}

export interface ProxyStats {
  fixtureHits: number;
  fixtureMisses: number;
  liveRequests: number;
  comparisons: number;
  comparisonMatches: number;
  hitRate: number;
}

function extractText(result: ToolResult): string {
  return result.content
    .map((c) => c.text ?? '')
    .filter(Boolean)
    .join('\n');
}

function computeLineSimilarity(a: string, b: string): number {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const setB = new Set(linesB);

  let matching = 0;
  for (const line of linesA) {
    if (setB.has(line)) matching++;
  }

  const total = Math.max(linesA.length, linesB.length);
  return total === 0 ? 1 : matching / total;
}

function compareResults(fixture: ToolResult, live: ToolResult): ResponseComparison {
  const differences: string[] = [];

  if (Boolean(fixture.isError) !== Boolean(live.isError)) {
    differences.push(
      `isError mismatch: fixture=${String(fixture.isError ?? false)}, live=${String(live.isError ?? false)}`,
    );
  }

  const fixtureText = extractText(fixture);
  const liveText = extractText(live);

  if (fixtureText !== liveText) {
    const similarity = computeLineSimilarity(fixtureText, liveText);
    if (similarity < 1) {
      differences.push(`content differs (line similarity: ${(similarity * 100).toFixed(1)}%)`);
    }
  }

  if (fixture.content.length !== live.content.length) {
    differences.push(
      `content length mismatch: fixture=${fixture.content.length}, live=${live.content.length}`,
    );
  }

  return {
    match: differences.length === 0,
    fixtureResult: fixture,
    liveResult: live,
    differences,
  };
}

export class McpFixtureProxy {
  private readonly config: ProxyConfig;
  private responder: McpFixtureResponder;
  private recorder: McpFixtureRecorder | null = null;

  private stats: ProxyStats = {
    fixtureHits: 0,
    fixtureMisses: 0,
    liveRequests: 0,
    comparisons: 0,
    comparisonMatches: 0,
    hitRate: 0,
  };

  constructor(config: ProxyConfig) {
    this.config = config;
    this.responder = new McpFixtureResponder(config.fixtureDir);

    if (config.recordMisses) {
      this.recorder = new McpFixtureRecorder(config.fixtureDir);
    }
  }

  async init(): Promise<void> {
    if (this.config.mode !== 'passthrough') {
      await this.responder.load();
    }
  }

  async handle(tool: string, args: Record<string, unknown>): Promise<ProxyResponse> {
    const start = Date.now();

    if (this.config.mode === 'passthrough') {
      return this.handlePassthrough(tool, args, start);
    }

    const fixtureMatch = this.responder.respond(tool, args);

    if (this.config.mode === 'mock') {
      return this.handleMock(fixtureMatch, start);
    }

    return this.handleHybrid(tool, args, fixtureMatch, start);
  }

  getStats(): ProxyStats {
    const totalAttempts = this.stats.fixtureHits + this.stats.fixtureMisses;
    return {
      ...this.stats,
      hitRate: totalAttempts === 0 ? 0 : this.stats.fixtureHits / totalAttempts,
    };
  }

  async close(): Promise<void> {
    if (this.recorder) {
      await this.recorder.flush();
    }
  }

  private async handlePassthrough(
    tool: string,
    args: Record<string, unknown>,
    start: number,
  ): Promise<ProxyResponse> {
    const liveResult = await this.callLive(tool, args);
    this.stats.liveRequests++;

    return {
      result: liveResult,
      source: 'live',
      matchType: 'miss',
      latencyMs: Date.now() - start,
    };
  }

  private handleMock(
    fixtureMatch: ReturnType<McpFixtureResponder['respond']>,
    start: number,
  ): ProxyResponse {
    if (fixtureMatch) {
      this.stats.fixtureHits++;
      return {
        result: fixtureMatch.result,
        source: 'fixture',
        matchType: fixtureMatch.matchType,
        latencyMs: Date.now() - start,
      };
    }

    this.stats.fixtureMisses++;
    return {
      result: {
        content: [{ type: 'text', text: 'No fixture match found' }],
        isError: true,
      },
      source: 'fixture',
      matchType: 'miss',
      latencyMs: Date.now() - start,
    };
  }

  private async handleHybrid(
    tool: string,
    args: Record<string, unknown>,
    fixtureMatch: ReturnType<McpFixtureResponder['respond']>,
    start: number,
  ): Promise<ProxyResponse> {
    if (this.config.compareResponses && fixtureMatch && this.config.fallbackClient) {
      this.stats.fixtureHits++;
      const liveResult = await this.callLive(tool, args);
      this.stats.liveRequests++;

      const comparison = compareResults(fixtureMatch.result, liveResult);
      this.stats.comparisons++;
      if (comparison.match) this.stats.comparisonMatches++;

      return {
        result: liveResult,
        source: 'live',
        matchType: fixtureMatch.matchType,
        comparison,
        latencyMs: Date.now() - start,
      };
    }

    if (fixtureMatch) {
      this.stats.fixtureHits++;
      return {
        result: fixtureMatch.result,
        source: 'fixture',
        matchType: fixtureMatch.matchType,
        latencyMs: Date.now() - start,
      };
    }

    this.stats.fixtureMisses++;

    if (!this.config.fallbackClient) {
      return {
        result: {
          content: [{ type: 'text', text: 'No fixture match and no fallback client' }],
          isError: true,
        },
        source: 'fixture',
        matchType: 'miss',
        latencyMs: Date.now() - start,
      };
    }

    const liveResult = await this.callLive(tool, args);
    this.stats.liveRequests++;

    if (this.recorder) {
      this.recorder.record(tool, args, liveResult, Date.now() - start);
    }

    return {
      result: liveResult,
      source: 'live',
      matchType: 'miss',
      latencyMs: Date.now() - start,
    };
  }

  private async callLive(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.config.fallbackClient) {
      throw new Error('No fallback client configured for live calls');
    }
    return this.config.fallbackClient.callTool(tool, args);
  }
}
