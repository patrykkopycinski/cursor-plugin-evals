import { describe, it, expect } from 'vitest';
import {
  inferCapabilities,
  buildCapabilityGraph,
  formatCapabilityReport,
} from './capability-graph.js';
import type { ToolDefinition } from './capability-graph.js';

describe('inferCapabilities', () => {
  it('identifies read tools from name', () => {
    const tools: ToolDefinition[] = [{ name: 'read_file', description: 'Read a file from disk' }];
    const [cap] = inferCapabilities(tools);
    expect(cap.reads).toContain('filesystem');
    expect(cap.executes).toBe(false);
  });

  it('identifies write tools from name', () => {
    const tools: ToolDefinition[] = [
      { name: 'create_index', description: 'Create a database index' },
    ];
    const [cap] = inferCapabilities(tools);
    expect(cap.writes).toContain('database');
  });

  it('identifies destructive tools from name', () => {
    const tools: ToolDefinition[] = [
      { name: 'delete_record', description: 'Delete a record from the store' },
    ];
    const [cap] = inferCapabilities(tools);
    expect(cap.destructive).toBe(true);
  });

  it('identifies execute tools from name', () => {
    const tools: ToolDefinition[] = [
      { name: 'run_command', description: 'Execute a shell command' },
    ];
    const [cap] = inferCapabilities(tools);
    expect(cap.executes).toBe(true);
  });

  it('identifies network access from description', () => {
    const tools: ToolDefinition[] = [
      { name: 'submit_data', description: 'Send data to an HTTP API endpoint' },
    ];
    const [cap] = inferCapabilities(tools);
    expect(cap.networkAccess).toBe(true);
  });

  it('identifies network access from schema fields', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'call_service',
        description: 'Call a service',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      },
    ];
    const [cap] = inferCapabilities(tools);
    expect(cap.networkAccess).toBe(true);
  });

  it('identifies filesystem from schema fields', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'process',
        description: 'Process something',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];
    const [cap] = inferCapabilities(tools);
    expect(cap.reads).toContain('filesystem');
  });

  it('handles tools with no signals gracefully', () => {
    const tools: ToolDefinition[] = [{ name: 'noop' }];
    const [cap] = inferCapabilities(tools);
    expect(cap.reads).toEqual([]);
    expect(cap.writes).toEqual([]);
    expect(cap.executes).toBe(false);
    expect(cap.networkAccess).toBe(false);
    expect(cap.destructive).toBe(false);
  });

  it('handles multiple capabilities on a single tool', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search_api',
        description: 'Search the remote API for files',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, endpoint: { type: 'string' } },
        },
      },
    ];
    const [cap] = inferCapabilities(tools);
    expect(cap.reads).toContain('filesystem');
    expect(cap.reads).toContain('network');
    expect(cap.networkAccess).toBe(true);
  });
});

describe('buildCapabilityGraph', () => {
  it('creates edges between tools that share data sources', () => {
    const caps = inferCapabilities([
      { name: 'read_file', description: 'Read a file' },
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
    const graph = buildCapabilityGraph(caps);
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);
    expect(graph.edges[0].from).toBe('read_file');
    expect(graph.edges[0].to).toBe('write_file');
  });

  it('detects data exfiltration risk', () => {
    const caps = inferCapabilities([
      { name: 'read_database', description: 'Query the database' },
      { name: 'send_webhook', description: 'Send data to an HTTP endpoint' },
    ]);
    const graph = buildCapabilityGraph(caps);
    const exfil = graph.findings.find((f) => f.title === 'Data exfiltration risk');
    expect(exfil).toBeDefined();
    expect(exfil!.severity).toBe('high');
    expect(exfil!.tools).toContain('read_database');
    expect(exfil!.tools).toContain('send_webhook');
  });

  it('detects code injection risk', () => {
    const caps = inferCapabilities([
      { name: 'exec_command', description: 'Execute a shell command' },
      { name: 'get_input', description: 'Read user input from a file' },
    ]);
    const graph = buildCapabilityGraph(caps);
    const injection = graph.findings.find((f) => f.title === 'Code injection risk');
    expect(injection).toBeDefined();
    expect(injection!.severity).toBe('critical');
  });

  it('detects excessive agency with multiple destructive tools', () => {
    const caps = inferCapabilities([
      { name: 'delete_file', description: 'Delete a file' },
      { name: 'drop_table', description: 'Drop a database table' },
      { name: 'remove_index', description: 'Remove an index' },
    ]);
    const graph = buildCapabilityGraph(caps);
    const agency = graph.findings.find((f) => f.title === 'Excessive agency risk');
    expect(agency).toBeDefined();
    expect(agency!.tools.length).toBe(3);
  });

  it('detects lateral movement risk', () => {
    const caps = inferCapabilities([
      { name: 'fetch_url', description: 'Fetch content from an HTTP URL' },
      {
        name: 'list_dir',
        description: 'List files in a directory',
        inputSchema: { type: 'object', properties: { directory: { type: 'string' } } },
      },
    ]);
    const graph = buildCapabilityGraph(caps);
    const lateral = graph.findings.find((f) => f.title === 'Lateral movement risk');
    expect(lateral).toBeDefined();
    expect(lateral!.severity).toBe('high');
  });

  it('calculates risk score based on findings', () => {
    const safeCaps = inferCapabilities([{ name: 'noop', description: 'Does nothing' }]);
    const safeGraph = buildCapabilityGraph(safeCaps);
    expect(safeGraph.riskScore).toBe(0);

    const riskyCaps = inferCapabilities([
      { name: 'exec_shell', description: 'Execute shell commands' },
      { name: 'read_db', description: 'Read from the database' },
      { name: 'send_http', description: 'Send data to HTTP API endpoint' },
    ]);
    const riskyGraph = buildCapabilityGraph(riskyCaps);
    expect(riskyGraph.riskScore).toBeGreaterThan(0);
  });

  it('caps risk score at 100', () => {
    const caps = inferCapabilities([
      { name: 'exec_cmd', description: 'Execute commands' },
      { name: 'run_shell', description: 'Run shell scripts' },
      { name: 'read_file', description: 'Read files from disk' },
      { name: 'write_file', description: 'Write files to disk' },
      { name: 'delete_file', description: 'Delete files from disk' },
      { name: 'drop_table', description: 'Drop database table' },
      { name: 'fetch_api', description: 'Fetch data from HTTP API' },
      { name: 'send_webhook', description: 'Send HTTP webhook notification' },
    ]);
    const graph = buildCapabilityGraph(caps);
    expect(graph.riskScore).toBeLessThanOrEqual(100);
  });
});

describe('formatCapabilityReport', () => {
  it('returns markdown with tool table', () => {
    const caps = inferCapabilities([
      { name: 'read_file', description: 'Read a file' },
      { name: 'exec_shell', description: 'Run a shell command' },
    ]);
    const graph = buildCapabilityGraph(caps);
    const report = formatCapabilityReport(graph);
    expect(report).toContain('# Capability Graph Analysis');
    expect(report).toContain('read_file');
    expect(report).toContain('exec_shell');
    expect(report).toContain('Risk Score');
  });

  it('includes findings section when findings exist', () => {
    const caps = inferCapabilities([
      { name: 'read_db', description: 'Read from the database' },
      { name: 'send_http', description: 'Send data to HTTP API endpoint' },
    ]);
    const graph = buildCapabilityGraph(caps);
    const report = formatCapabilityReport(graph);
    expect(report).toContain('## Findings');
  });

  it('includes edges section when edges exist', () => {
    const caps = inferCapabilities([
      { name: 'read_file', description: 'Read a file from disk' },
      { name: 'write_file', description: 'Write a file to disk' },
    ]);
    const graph = buildCapabilityGraph(caps);
    const report = formatCapabilityReport(graph);
    expect(report).toContain('## Edges');
  });
});
