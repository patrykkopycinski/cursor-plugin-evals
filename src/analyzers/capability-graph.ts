export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolCapability {
  tool: string;
  reads: string[];
  writes: string[];
  executes: boolean;
  networkAccess: boolean;
  destructive: boolean;
}

export interface CapabilityEdge {
  from: string;
  to: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

export interface CapabilityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  tools: string[];
}

export interface CapabilityGraph {
  tools: ToolCapability[];
  edges: CapabilityEdge[];
  riskScore: number;
  findings: CapabilityFinding[];
}

const READ_VERBS = /\b(read|get|list|search|query|fetch|find|lookup|browse|scan|inspect)\b/i;
const WRITE_VERBS = /\b(write|create|update|put|post|set|save|store|insert|modify|patch)\b/i;
const DELETE_VERBS = /\b(delete|remove|drop|destroy|purge|wipe|truncate|erase|clean)\b/i;
const EXEC_VERBS = /\b(exec|run|shell|command|execute|spawn|invoke|launch|eval)\b/i;
const NETWORK_TERMS =
  /\b(api|http|https|url|endpoint|fetch|request|webhook|remote|socket|download|upload)\b/i;

const FILESYSTEM_FIELDS = ['path', 'file', 'filename', 'directory', 'dir', 'filepath', 'folder'];
const NETWORK_FIELDS = ['url', 'endpoint', 'host', 'hostname', 'uri', 'domain', 'baseUrl'];
const DATABASE_FIELDS = ['query', 'sql', 'table', 'database', 'collection', 'index'];

function extractSchemaPropertyNames(schema: Record<string, unknown>): string[] {
  const props = schema.properties as Record<string, unknown> | undefined;
  if (!props || typeof props !== 'object') return [];
  return Object.keys(props);
}

function matchesAny(fields: string[], targets: string[]): boolean {
  const lower = fields.map((f) => f.toLowerCase());
  return targets.some((t) => lower.includes(t.toLowerCase()));
}

export function inferCapabilities(tools: ToolDefinition[]): ToolCapability[] {
  return tools.map((tool) => {
    const name = tool.name.toLowerCase();
    const desc = (tool.description ?? '').toLowerCase();
    const combined = `${name} ${desc}`;
    const schemaFields = tool.inputSchema ? extractSchemaPropertyNames(tool.inputSchema) : [];

    const reads: string[] = [];
    const writes: string[] = [];

    const hasFilesystemField = matchesAny(schemaFields, FILESYSTEM_FIELDS);
    const hasDatabaseField = matchesAny(schemaFields, DATABASE_FIELDS);
    const hasNetworkField = matchesAny(schemaFields, NETWORK_FIELDS);

    if (READ_VERBS.test(combined) || hasFilesystemField || hasDatabaseField) {
      if (hasFilesystemField || /file|path|dir/i.test(combined)) reads.push('filesystem');
      if (hasDatabaseField || /database|sql|query|table|index/i.test(combined))
        reads.push('database');
      if (hasNetworkField || NETWORK_TERMS.test(combined)) reads.push('network');
      if (reads.length === 0) reads.push('unknown');
    }

    if (WRITE_VERBS.test(combined)) {
      if (hasFilesystemField || /file|path|dir/i.test(combined)) writes.push('filesystem');
      if (hasDatabaseField || /database|sql|table|index/i.test(combined)) writes.push('database');
      if (hasNetworkField || NETWORK_TERMS.test(combined)) writes.push('network');
      if (writes.length === 0) writes.push('unknown');
    }

    const executes = EXEC_VERBS.test(combined);
    const networkAccess = NETWORK_TERMS.test(combined) || hasNetworkField;

    let destructive = DELETE_VERBS.test(combined);
    if (!destructive && WRITE_VERBS.test(name) && DELETE_VERBS.test(desc)) {
      destructive = true;
    }

    return {
      tool: tool.name,
      reads,
      writes,
      executes,
      networkAccess,
      destructive,
    };
  });
}

function sharedSources(a: ToolCapability, b: ToolCapability): string[] {
  const aAll = new Set([...a.reads, ...a.writes]);
  const bAll = new Set([...b.reads, ...b.writes]);
  return [...aAll].filter((s) => bAll.has(s));
}

function classifyEdgeRisk(a: ToolCapability, b: ToolCapability): 'low' | 'medium' | 'high' | 'critical' {
  if ((a.executes && b.networkAccess) || (b.executes && a.networkAccess)) return 'critical';
  if ((a.destructive || b.destructive) && (a.executes || b.executes)) return 'critical';
  if (a.reads.length > 0 && b.networkAccess) return 'high';
  if (b.reads.length > 0 && a.networkAccess) return 'high';
  if (a.destructive || b.destructive) return 'medium';
  return 'low';
}

function detectFindings(capabilities: ToolCapability[]): CapabilityFinding[] {
  const findings: CapabilityFinding[] = [];

  const readers = capabilities.filter((c) => c.reads.length > 0);
  const networked = capabilities.filter((c) => c.networkAccess);
  const executors = capabilities.filter((c) => c.executes);
  const destructives = capabilities.filter((c) => c.destructive);
  const fsReaders = capabilities.filter((c) => c.reads.includes('filesystem'));
  const fsWriters = capabilities.filter((c) => c.writes.includes('filesystem'));

  for (const reader of readers) {
    for (const net of networked) {
      if (reader.tool === net.tool) continue;
      findings.push({
        severity: 'high',
        title: 'Data exfiltration risk',
        description: `"${reader.tool}" reads data that "${net.tool}" could transmit over the network`,
        tools: [reader.tool, net.tool],
      });
    }
  }

  for (const executor of executors) {
    for (const other of capabilities) {
      if (executor.tool === other.tool) continue;
      const hasUserInput =
        other.reads.length > 0 || (other.writes.length > 0 && !other.executes);
      if (hasUserInput) {
        findings.push({
          severity: 'critical',
          title: 'Code injection risk',
          description: `"${executor.tool}" executes commands while "${other.tool}" accepts input — potential injection vector`,
          tools: [executor.tool, other.tool],
        });
      }
    }
  }

  if (destructives.length >= 2) {
    findings.push({
      severity: 'high',
      title: 'Excessive agency risk',
      description: `${destructives.length} tools have destructive capabilities: ${destructives.map((d) => `"${d.tool}"`).join(', ')}`,
      tools: destructives.map((d) => d.tool),
    });
  }

  for (const net of networked) {
    for (const fs of [...fsReaders, ...fsWriters]) {
      if (net.tool === fs.tool) continue;
      const alreadyReported = findings.some(
        (f) =>
          f.title === 'Lateral movement risk' &&
          f.tools.includes(net.tool) &&
          f.tools.includes(fs.tool),
      );
      if (alreadyReported) continue;
      findings.push({
        severity: 'high',
        title: 'Lateral movement risk',
        description: `"${net.tool}" has network access and "${fs.tool}" accesses the filesystem — lateral movement potential`,
        tools: [net.tool, fs.tool],
      });
    }
  }

  return findings;
}

const SEVERITY_WEIGHTS: Record<CapabilityFinding['severity'], number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

function computeRiskScore(findings: CapabilityFinding[]): number {
  const raw = findings.reduce((sum, f) => sum + SEVERITY_WEIGHTS[f.severity], 0);
  return Math.min(100, raw);
}

export function buildCapabilityGraph(capabilities: ToolCapability[]): CapabilityGraph {
  const edges: CapabilityEdge[] = [];

  for (let i = 0; i < capabilities.length; i++) {
    for (let j = i + 1; j < capabilities.length; j++) {
      const a = capabilities[i];
      const b = capabilities[j];
      const shared = sharedSources(a, b);
      if (shared.length === 0 && !a.executes && !b.executes) continue;

      const risk = classifyEdgeRisk(a, b);
      const reason =
        shared.length > 0
          ? `Shared data sources: ${shared.join(', ')}`
          : 'Execution capability coupling';

      edges.push({ from: a.tool, to: b.tool, risk, reason });
    }
  }

  const findings = detectFindings(capabilities);
  const riskScore = computeRiskScore(findings);

  return { tools: capabilities, edges, riskScore, findings };
}

export function formatCapabilityReport(graph: CapabilityGraph): string {
  const lines: string[] = ['# Capability Graph Analysis\n'];

  lines.push(`**Risk Score:** ${graph.riskScore}/100\n`);
  lines.push(`## Tools (${graph.tools.length})\n`);
  lines.push('| Tool | Reads | Writes | Exec | Network | Destructive |');
  lines.push('|------|-------|--------|------|---------|-------------|');

  for (const t of graph.tools) {
    lines.push(
      `| ${t.tool} | ${t.reads.join(', ') || '-'} | ${t.writes.join(', ') || '-'} | ${yn(t.executes)} | ${yn(t.networkAccess)} | ${yn(t.destructive)} |`,
    );
  }

  if (graph.findings.length > 0) {
    lines.push('');
    lines.push(`## Findings (${graph.findings.length})\n`);
    for (const f of graph.findings) {
      lines.push(`- **[${f.severity.toUpperCase()}]** ${f.title}: ${f.description}`);
    }
  }

  if (graph.edges.length > 0) {
    lines.push('');
    lines.push(`## Edges (${graph.edges.length})\n`);
    for (const e of graph.edges) {
      lines.push(`- \`${e.from}\` ↔ \`${e.to}\` [${e.risk}]: ${e.reason}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function yn(val: boolean): string {
  return val ? 'Yes' : '-';
}
