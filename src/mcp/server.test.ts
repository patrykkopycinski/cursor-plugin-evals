import { vi, beforeEach, type Mock } from 'vitest';
import { execSync } from 'child_process';
import { createEvalServer } from './server.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../plugin/discovery.js', () => ({
  discoverPlugin: vi.fn(),
}));

vi.mock('../dashboard/db.js', () => ({
  initDb: vi.fn(),
  getLatestRuns: vi.fn(),
  getRun: vi.fn(),
}));

vi.mock('../coverage/analyzer.js', () => ({
  analyzeCoverage: vi.fn(),
}));

vi.mock('../assistant/codebase-scanner.js', () => ({
  scanCodebase: vi.fn(),
}));

vi.mock('../assistant/coverage-analyzer.js', () => ({
  auditCoverage: vi.fn(),
}));

vi.mock('../assistant/gap-detector.js', () => ({
  detectGaps: vi.fn(),
}));

vi.mock('../assistant/fix-generator.js', () => ({
  generateFixes: vi.fn(),
}));

vi.mock('../analyzers/skill-collision.js', () => ({
  analyzeCollisions: vi.fn(),
}));

vi.mock('../analyzers/security-audit.js', () => ({
  runSecurityAudit: vi.fn(),
}));

vi.mock('../core/runner.js', () => ({
  runEvaluation: vi.fn(),
}));

vi.mock('../regression/fingerprint.js', () => ({
  loadFingerprint: vi.fn(),
  buildFingerprint: vi.fn(),
  listFingerprints: vi.fn(),
}));

vi.mock('../regression/detector.js', () => ({
  detectRegressions: vi.fn(),
}));

vi.mock('../comparison/index.js', () => ({
  buildComparisonFromRuns: vi.fn(),
}));

vi.mock('../cost-advisor/index.js', () => ({
  analyzeCosts: vi.fn(),
}));

vi.mock('./client.js', () => ({
  McpPluginClient: { connect: vi.fn() },
}));

vi.mock('../core/utils.js', () => ({
  parseEntry: vi.fn().mockReturnValue({ command: 'node', args: ['server.js'] }),
}));

// Helper to call tools via the server's internal handler registry
async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const handler = server._requestHandlers.get('tools/call');
  if (!handler) throw new Error('No tools/call handler registered');
  return handler({ method: 'tools/call', params: { name, arguments: args } });
}

async function listTools(server: any) {
  const handler = server._requestHandlers.get('tools/list');
  if (!handler) throw new Error('No tools/list handler registered');
  return handler({ method: 'tools/list', params: {} });
}

async function readResource(server: any, uri: string) {
  const handler = server._requestHandlers.get('resources/read');
  if (!handler) throw new Error('No resources/read handler registered');
  return handler({ method: 'resources/read', params: { uri } });
}

async function listResources(server: any) {
  const handler = server._requestHandlers.get('resources/list');
  if (!handler) throw new Error('No resources/list handler registered');
  return handler({ method: 'resources/list', params: {} });
}

function parseContent(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe('createEvalServer', () => {
  let server: ReturnType<typeof createEvalServer>;

  beforeEach(() => {
    vi.resetAllMocks();
    server = createEvalServer();
  });

  describe('tools/list', () => {
    it('returns all registered tools', async () => {
      const result = await listTools(server);
      const names = result.tools.map((t: any) => t.name);

      expect(names).toContain('load_config');
      expect(names).toContain('discover_plugin');
      expect(names).toContain('audit_coverage');
      expect(names).toContain('detect_gaps');
      expect(names).toContain('list_runs');
      expect(names).toContain('get_run_detail');
      expect(names).toContain('run_evals');
      expect(names).toContain('doctor');
      expect(names).toContain('analyze_collisions');
      expect(names).toContain('security_audit');
      expect(names).toContain('regression_check');
      expect(names).toContain('compare_models');
      expect(names).toContain('cost_report');
      expect(names).toContain('generate_fixes');
      expect(result.tools.length).toBe(14);
    });

    it('each tool has name, description, and inputSchema', async () => {
      const result = await listTools(server);
      for (const tool of result.tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  describe('tool: doctor', () => {
    it('returns an array of environment checks', async () => {
      (execSync as Mock).mockImplementation(() => Buffer.from(''));

      const result = await callTool(server, 'doctor');
      const checks = parseContent(result);

      expect(Array.isArray(checks)).toBe(true);
      const nodeCheck = checks.find((c: any) => c.name === 'Node.js');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck.status).toBe('ok');
      expect(nodeCheck.message).toContain(process.version);
    });

    it('reports correct Node.js version', async () => {
      (execSync as Mock).mockImplementation(() => Buffer.from(''));

      const result = await callTool(server, 'doctor');
      const checks = parseContent(result);
      const nodeCheck = checks.find((c: any) => c.name === 'Node.js');

      expect(nodeCheck.message).toBe(process.version);
    });

    it('handles missing Docker gracefully', async () => {
      (execSync as Mock).mockImplementation((cmd: string) => {
        if (cmd === 'docker info' || cmd === 'docker compose version') {
          throw new Error('command not found');
        }
        return Buffer.from('');
      });

      const result = await callTool(server, 'doctor');
      const checks = parseContent(result);

      const dockerCheck = checks.find((c: any) => c.name === 'Docker');
      expect(dockerCheck.status).toBe('warn');
      expect(dockerCheck.message).toBe('Not running or not installed');
    });

    it('reports API key availability from env', async () => {
      (execSync as Mock).mockImplementation(() => Buffer.from(''));
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-test';

      try {
        const result = await callTool(server, 'doctor');
        const checks = parseContent(result);
        const openaiCheck = checks.find((c: any) => c.name === 'OpenAI API Key');
        expect(openaiCheck.status).toBe('ok');
        expect(openaiCheck.message).toBe('Set');
      } finally {
        if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = originalKey;
      }
    });
  });

  describe('tool: load_config', () => {
    it('returns structured config summary when config exists', async () => {
      const { loadConfig } = await import('../core/config.js');
      (loadConfig as Mock).mockReturnValue({
        plugin: { name: 'test-plugin', dir: '/tmp/plugin' },
        suites: [
          { layer: 'unit', tests: [{ name: 't1' }, { name: 't2' }] },
          { layer: 'llm', tests: [{ name: 't3' }] },
        ],
        ci: { score: { avg: 0.8 } },
        defaults: { timeout: 30000 },
      });

      const result = await callTool(server, 'load_config', { config_path: 'test.yaml' });
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data.pluginName).toBe('test-plugin');
      expect(data.suiteCount).toBe(2);
      expect(data.testCount).toBe(3);
      expect(data.layerBreakdown).toEqual({ unit: 1, llm: 1 });
      expect(data.ciThresholds).toEqual({ score: { avg: 0.8 } });
    });

    it('returns error when config is missing', async () => {
      const { loadConfig } = await import('../core/config.js');
      (loadConfig as Mock).mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      const result = await callTool(server, 'load_config');
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('Failed to load config');
      expect(data.error).toContain('ENOENT');
    });
  });

  describe('tool: discover_plugin', () => {
    it('returns manifest with component counts', async () => {
      const { discoverPlugin } = await import('../plugin/discovery.js');
      (discoverPlugin as Mock).mockReturnValue({
        name: 'my-plugin',
        description: 'A plugin',
        version: '1.0.0',
        skills: [{ name: 'skill-a', description: 'Does A' }],
        rules: [{ path: 'rules/r1.mdc', description: 'Rule 1' }],
        agents: [{ name: 'agent-a', description: 'Agent A' }],
        commands: [{ name: 'cmd-a', path: 'cmd/a.md', description: 'Cmd A' }],
        hooks: [{ event: 'onSave', handlers: ['h1', 'h2'] }],
        mcpServers: [{ name: 'srv', type: 'stdio', command: 'node srv.js', url: undefined }],
      });

      const result = await callTool(server, 'discover_plugin', { dir: '/tmp' });
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data.name).toBe('my-plugin');
      expect(data.skills).toHaveLength(1);
      expect(data.rules).toHaveLength(1);
      expect(data.agents).toHaveLength(1);
      expect(data.commands).toHaveLength(1);
      expect(data.hooks[0].handlerCount).toBe(2);
      expect(data.mcpServers[0].name).toBe('srv');
    });

    it('returns error when plugin directory is missing', async () => {
      const { discoverPlugin } = await import('../plugin/discovery.js');
      (discoverPlugin as Mock).mockImplementation(() => {
        throw new Error('Directory not found: /nonexistent');
      });

      const result = await callTool(server, 'discover_plugin', { dir: '/nonexistent' });
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('Plugin discovery failed');
    });
  });

  describe('tool: audit_coverage', () => {
    it('returns coverage report', async () => {
      const { analyzeCoverage } = await import('../coverage/analyzer.js');
      (analyzeCoverage as Mock).mockReturnValue({
        score: 85,
        gaps: [],
        matrix: { unit: 1.0, llm: 0.7 },
      });

      const result = await callTool(server, 'audit_coverage');
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data.score).toBe(85);
    });
  });

  describe('tool: detect_gaps', () => {
    it('returns gaps array', async () => {
      const { scanCodebase } = await import('../assistant/codebase-scanner.js');
      const { auditCoverage } = await import('../assistant/coverage-analyzer.js');
      const { detectGaps } = await import('../assistant/gap-detector.js');

      const mockProfile = { tools: ['t1'], skills: ['s1'] };
      const mockAudit = { covered: ['t1'], missing: ['s1'] };
      const mockGaps = [
        { component: 's1', severity: 'high', suggestion: 'Add llm test' },
      ];

      (scanCodebase as Mock).mockResolvedValue(mockProfile);
      (auditCoverage as Mock).mockReturnValue(mockAudit);
      (detectGaps as Mock).mockReturnValue(mockGaps);

      const result = await callTool(server, 'detect_gaps');
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].component).toBe('s1');
      expect(data[0].severity).toBe('high');
    });

    it('returns error on failure', async () => {
      const { scanCodebase } = await import('../assistant/codebase-scanner.js');
      (scanCodebase as Mock).mockRejectedValue(new Error('scan failed'));

      const result = await callTool(server, 'detect_gaps');
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('Gap detection failed');
    });
  });

  describe('tool: list_runs', () => {
    it('returns empty array when no runs exist', async () => {
      const { initDb, getLatestRuns } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getLatestRuns as Mock).mockReturnValue([]);

      const result = await callTool(server, 'list_runs');
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data).toEqual([]);
    });

    it('respects limit parameter', async () => {
      const { initDb, getLatestRuns } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getLatestRuns as Mock).mockReturnValue([]);

      await callTool(server, 'list_runs', { limit: 5 });

      expect(getLatestRuns).toHaveBeenCalledWith(mockDb, 5);
    });

    it('parses overall_json and merges with run data', async () => {
      const { initDb, getLatestRuns } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getLatestRuns as Mock).mockReturnValue([
        {
          id: 'run-1',
          timestamp: '2025-01-01',
          config: 'test.yaml',
          overall_json: JSON.stringify({ passRate: 0.9, score: 85 }),
        },
      ]);

      const result = await callTool(server, 'list_runs');
      const data = parseContent(result);

      expect(data[0].id).toBe('run-1');
      expect(data[0].passRate).toBe(0.9);
      expect(data[0].score).toBe(85);
    });
  });

  describe('tool: get_run_detail', () => {
    it('returns error when run_id is missing', async () => {
      const result = await callTool(server, 'get_run_detail', {});
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('run_id is required');
    });

    it('returns error when run not found', async () => {
      const { initDb, getRun } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getRun as Mock).mockReturnValue(null);

      const result = await callTool(server, 'get_run_detail', { run_id: 'nonexistent' });
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('Run not found: nonexistent');
    });

    it('returns run details when found', async () => {
      const { initDb, getRun } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getRun as Mock).mockReturnValue({
        id: 'run-42',
        timestamp: '2025-01-01',
        suites: [],
      });

      const result = await callTool(server, 'get_run_detail', { run_id: 'run-42' });
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data.id).toBe('run-42');
    });
  });

  describe('tool: run_evals', () => {
    it('returns structured evaluation results', async () => {
      const { loadConfig } = await import('../core/config.js');
      const { runEvaluation } = await import('../core/runner.js');

      (loadConfig as Mock).mockReturnValue({
        plugin: { name: 'test', dir: '.' },
        suites: [],
      });
      (runEvaluation as Mock).mockResolvedValue({
        runId: 'run-99',
        timestamp: '2025-01-01',
        overall: { passRate: 1.0 },
        suites: [
          {
            name: 'suite-1',
            layer: 'unit',
            passRate: 1.0,
            duration: 100,
            tests: [
              {
                name: 'test-a',
                pass: true,
                latencyMs: 50,
                evaluatorResults: [{ name: 'keywords', score: 1.0 }],
              },
            ],
          },
        ],
        ciResult: { pass: true },
        qualityScore: 95,
      });

      const result = await callTool(server, 'run_evals');
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data.runId).toBe('run-99');
      expect(data.suites[0].tests[0].pass).toBe(true);
      expect(data.ciResult.pass).toBe(true);
    });

    it('returns error when config fails to load', async () => {
      const { loadConfig } = await import('../core/config.js');
      (loadConfig as Mock).mockImplementation(() => {
        throw new Error('invalid YAML');
      });

      const result = await callTool(server, 'run_evals');
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('Config error');
    });
  });

  describe('tool: analyze_collisions', () => {
    it('returns collision report', async () => {
      const { analyzeCollisions } = await import('../analyzers/skill-collision.js');
      (analyzeCollisions as Mock).mockResolvedValue({
        skills: [{ name: 'skill-a' }, { name: 'skill-b' }],
        errors: [],
        warnings: ['skill-a and skill-b have 70% overlap'],
        clean: [{ pair: ['skill-c', 'skill-d'] }],
      });

      const result = await callTool(server, 'analyze_collisions');
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data.skillCount).toBe(2);
      expect(data.errors).toEqual([]);
      expect(data.warnings).toHaveLength(1);
      expect(data.cleanPairs).toBe(1);
    });

    it('returns error on failure', async () => {
      const { analyzeCollisions } = await import('../analyzers/skill-collision.js');
      (analyzeCollisions as Mock).mockRejectedValue(new Error('no skills dir'));

      const result = await callTool(server, 'analyze_collisions');
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('Collision analysis failed');
    });
  });

  describe('tool: security_audit', () => {
    it('returns security audit result', async () => {
      const { loadConfig } = await import('../core/config.js');
      const { runSecurityAudit } = await import('../analyzers/security-audit.js');

      (loadConfig as Mock).mockImplementation(() => {
        throw new Error('no config');
      });
      (runSecurityAudit as Mock).mockResolvedValue({
        passes: 10,
        failures: 0,
        findings: [],
      });

      const result = await callTool(server, 'security_audit');
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data.passes).toBe(10);
    });
  });

  describe('tool: regression_check', () => {
    it('returns error when baseline_run_id is missing', async () => {
      const result = await callTool(server, 'regression_check', {});
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('baseline_run_id is required');
    });

    it('returns error when baseline fingerprint not found', async () => {
      const { loadFingerprint, listFingerprints } = await import(
        '../regression/fingerprint.js'
      );
      (loadFingerprint as Mock).mockResolvedValue(null);
      (listFingerprints as Mock).mockResolvedValue(['fp-1', 'fp-2']);

      const result = await callTool(server, 'regression_check', {
        baseline_run_id: 'missing',
      });
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('Baseline not found: missing');
      expect(data.error).toContain('fp-1, fp-2');
    });
  });

  describe('tool: compare_models', () => {
    it('returns error when fewer than 2 models provided', async () => {
      const result = await callTool(server, 'compare_models', { models: ['gpt-4'] });
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('At least 2 models');
    });
  });

  describe('tool: cost_report', () => {
    it('returns error when fewer than 2 models provided', async () => {
      const result = await callTool(server, 'cost_report', { models: ['gpt-4'] });
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('At least 2 models');
    });
  });

  describe('tool: unknown', () => {
    it('returns error for unknown tool name', async () => {
      const result = await callTool(server, 'nonexistent_tool');
      const data = parseContent(result);

      expect(result.isError).toBe(true);
      expect(data.error).toContain('Unknown tool: nonexistent_tool');
    });
  });

  describe('tool: generate_fixes', () => {
    it('returns fixes for auto-fixable gaps', async () => {
      const { scanCodebase } = await import('../assistant/codebase-scanner.js');
      const { auditCoverage } = await import('../assistant/coverage-analyzer.js');
      const { detectGaps } = await import('../assistant/gap-detector.js');
      const { generateFixes } = await import('../assistant/fix-generator.js');

      (scanCodebase as Mock).mockResolvedValue({ tools: [], skills: [] });
      (auditCoverage as Mock).mockReturnValue({ gaps: [] });
      (detectGaps as Mock).mockReturnValue([
        { id: 'gap-1', category: 'tool-coverage', autoFixable: true },
      ]);
      (generateFixes as Mock).mockReturnValue([
        { gapId: 'gap-1', description: 'Add unit test', files: [{ path: 'test.yaml', action: 'create', content: 'test' }] },
      ]);

      const result = await callTool(server, 'generate_fixes', { plugin_dir: '.' });
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data.gapCount).toBe(1);
      expect(data.fixCount).toBe(1);
      expect(data.fixes[0].gapId).toBe('gap-1');
    });
  });

  describe('resources/list', () => {
    it('returns all registered resources', async () => {
      const result = await listResources(server);
      const uris = result.resources.map((r: any) => r.uri);

      expect(uris).toContain('eval://config');
      expect(uris).toContain('eval://latest-run');
      expect(uris).toContain('eval://coverage');
      expect(uris).toContain('eval://history');
      expect(uris).toContain('eval://quickstart');
      expect(uris).toContain('eval://evaluators');
      expect(result.resources).toHaveLength(6);
    });
  });

  describe('resource: eval://config', () => {
    it('returns config JSON', async () => {
      const { loadConfig } = await import('../core/config.js');
      (loadConfig as Mock).mockReturnValue({
        plugin: { name: 'res-plugin' },
        suites: [],
      });

      const result = await readResource(server, 'eval://config');
      const data = JSON.parse(result.contents[0].text);

      expect(data.plugin.name).toBe('res-plugin');
    });

    it('returns error object when config fails', async () => {
      const { loadConfig } = await import('../core/config.js');
      (loadConfig as Mock).mockImplementation(() => {
        throw new Error('bad yaml');
      });

      const result = await readResource(server, 'eval://config');
      const data = JSON.parse(result.contents[0].text);

      expect(data.error).toContain('Failed to load config');
    });
  });

  describe('resource: eval://latest-run', () => {
    it('returns message when no runs exist', async () => {
      const { initDb, getLatestRuns } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getLatestRuns as Mock).mockReturnValue([]);

      const result = await readResource(server, 'eval://latest-run');
      const data = JSON.parse(result.contents[0].text);

      expect(data.message).toBe('No runs found');
    });

    it('returns latest run when available', async () => {
      const { initDb, getLatestRuns } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getLatestRuns as Mock).mockReturnValue([
        { id: 'latest-1', timestamp: '2025-06-01' },
      ]);

      const result = await readResource(server, 'eval://latest-run');
      const data = JSON.parse(result.contents[0].text);

      expect(data.id).toBe('latest-1');
    });
  });

  describe('resource: eval://coverage', () => {
    it('returns coverage report', async () => {
      const { analyzeCoverage } = await import('../coverage/analyzer.js');
      (analyzeCoverage as Mock).mockReturnValue({ score: 92, gaps: [] });

      const result = await readResource(server, 'eval://coverage');
      const data = JSON.parse(result.contents[0].text);

      expect(data.score).toBe(92);
    });
  });

  describe('resource: eval://history', () => {
    it('returns run history array', async () => {
      const { initDb, getLatestRuns } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getLatestRuns as Mock).mockReturnValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);

      const result = await readResource(server, 'eval://history');
      const data = JSON.parse(result.contents[0].text);

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
    });

    it('fetches up to 50 runs', async () => {
      const { initDb, getLatestRuns } = await import('../dashboard/db.js');
      const mockDb = { close: vi.fn() };
      (initDb as Mock).mockReturnValue(mockDb);
      (getLatestRuns as Mock).mockReturnValue([]);

      await readResource(server, 'eval://history');

      expect(getLatestRuns).toHaveBeenCalledWith(mockDb, 50);
    });
  });

  describe('resource: eval://quickstart', () => {
    it('returns markdown guide with tool table', async () => {
      const result = await readResource(server, 'eval://quickstart');
      const text = result.contents[0].text;

      expect(result.contents[0].mimeType).toBe('text/markdown');
      expect(text).toContain('Agent Quickstart');
      expect(text).toContain('discover_plugin');
      expect(text).toContain('run_evals');
    });
  });

  describe('resource: eval://evaluators', () => {
    it('returns evaluator content', async () => {
      const result = await readResource(server, 'eval://evaluators');
      const text = result.contents[0].text;

      expect(result.contents[0].mimeType).toBe('text/markdown');
      expect(text).toContain('Evaluator');
    });
  });

  describe('resource: unknown', () => {
    it('throws for unknown resource URI', async () => {
      await expect(readResource(server, 'eval://nonexistent')).rejects.toThrow(
        'Unknown resource',
      );
    });
  });
});
