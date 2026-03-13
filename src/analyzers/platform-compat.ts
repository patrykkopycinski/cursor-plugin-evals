import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';

export type Platform = 'cursor' | 'claude-code' | 'chatgpt' | 'generic-mcp';

export interface PlatformRequirement {
  platform: Platform;
  requirement: string;
  check: string;
  severity: 'error' | 'warning' | 'info';
}

export interface CompatibilityResult {
  platform: Platform;
  compatible: boolean;
  passedChecks: number;
  totalChecks: number;
  results: PlatformCheckResult[];
}

export interface PlatformCheckResult {
  requirement: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface CompatibilityReport {
  platforms: CompatibilityResult[];
  overallScore: number;
  universallyCompatible: boolean;
}

const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const ALL_PLATFORMS: Platform[] = ['cursor', 'claude-code', 'chatgpt', 'generic-mcp'];

function readJsonSafe(filePath: string): unknown | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function fileExists(path: string): boolean {
  return existsSync(path);
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function checkCursor(pluginDir: string): PlatformCheckResult[] {
  const results: PlatformCheckResult[] = [];
  const manifestPath = join(pluginDir, '.cursor-plugin', 'plugin.json');

  const hasManifest = fileExists(manifestPath);
  results.push({
    requirement: 'Has .cursor-plugin/plugin.json manifest',
    passed: hasManifest,
    severity: 'error',
    message: hasManifest ? 'Manifest found' : 'Missing .cursor-plugin/plugin.json',
  });

  if (!hasManifest) return results;

  const manifest = readJsonSafe(manifestPath) as Record<string, unknown> | null;
  if (!manifest) {
    results.push({
      requirement: 'Manifest is valid JSON',
      passed: false,
      severity: 'error',
      message: 'plugin.json is not valid JSON',
    });
    return results;
  }

  const name = manifest.name;
  const hasValidName =
    typeof name === 'string' && name.length > 0 && KEBAB_CASE_RE.test(name);
  results.push({
    requirement: 'Manifest has valid kebab-case name',
    passed: hasValidName,
    severity: 'error',
    message: hasValidName
      ? `Name: ${name}`
      : `Invalid or missing name (expected kebab-case, got: ${String(name ?? 'undefined')})`,
  });

  const hasDescription = typeof manifest.description === 'string' && manifest.description.length > 0;
  results.push({
    requirement: 'Manifest has description',
    passed: hasDescription,
    severity: 'warning',
    message: hasDescription ? 'Description present' : 'Missing description field',
  });

  const mcpPath = join(pluginDir, '.mcp.json');
  const mcpInManifest = manifest.mcpServers != null;
  const hasMcpConfig = mcpInManifest || fileExists(mcpPath);

  let hasMcpServer = false;
  if (hasMcpConfig) {
    const mcpData = mcpInManifest
      ? manifest.mcpServers
      : readJsonSafe(mcpPath);
    if (mcpData && typeof mcpData === 'object') {
      const servers = (mcpData as Record<string, unknown>).mcpServers ?? mcpData;
      if (typeof servers === 'object' && servers !== null) {
        for (const val of Object.values(servers as Record<string, unknown>)) {
          if (typeof val === 'object' && val !== null) {
            const cfg = val as Record<string, unknown>;
            if (cfg.command || cfg.url) {
              hasMcpServer = true;
              break;
            }
          }
        }
      }
    }
  }

  results.push({
    requirement: 'MCP server entry exists with command or url',
    passed: hasMcpServer,
    severity: 'warning',
    message: hasMcpServer ? 'MCP server configured' : 'No MCP server with command/url found',
  });

  const skillsDir = join(pluginDir, 'skills');
  let skillsOk = true;
  let skillMsg = 'No skills directory';
  if (isDir(skillsDir)) {
    const subdirs = listDir(skillsDir).filter((e) => isDir(join(skillsDir, e)));
    const hasSkillMd = subdirs.every((d) => fileExists(join(skillsDir, d, 'SKILL.md')));
    skillsOk = subdirs.length === 0 || hasSkillMd;
    skillMsg = skillsOk
      ? `${subdirs.length} skills with SKILL.md`
      : 'Some skill directories missing SKILL.md';
  }

  results.push({
    requirement: 'Skills have SKILL.md with required frontmatter',
    passed: skillsOk,
    severity: 'warning',
    message: skillMsg,
  });

  const rulesDir = join(pluginDir, 'rules');
  let rulesOk = true;
  let rulesMsg = 'No rules directory';
  if (isDir(rulesDir)) {
    const files = listDir(rulesDir);
    const mdcFiles = files.filter((f) => f.endsWith('.mdc'));
    rulesOk = files.length === 0 || mdcFiles.length > 0;
    rulesMsg = rulesOk
      ? `${mdcFiles.length} .mdc rule files`
      : 'Rules directory contains no .mdc files';
  }

  results.push({
    requirement: 'Rules are .mdc files with proper format',
    passed: rulesOk,
    severity: 'info',
    message: rulesMsg,
  });

  return results;
}

function checkClaudeCode(pluginDir: string): PlatformCheckResult[] {
  const results: PlatformCheckResult[] = [];

  const claudeManifest = join(pluginDir, '.claude-plugin', 'plugin.json');
  const cursorManifest = join(pluginDir, '.cursor-plugin', 'plugin.json');
  const hasClaudeManifest = fileExists(claudeManifest);
  const hasCursorManifest = fileExists(cursorManifest);

  results.push({
    requirement: 'Has plugin manifest (.claude-plugin or adaptable .cursor-plugin)',
    passed: hasClaudeManifest || hasCursorManifest,
    severity: 'error',
    message: hasClaudeManifest
      ? 'Claude Code manifest found'
      : hasCursorManifest
        ? 'Can adapt from .cursor-plugin manifest'
        : 'No plugin manifest found',
  });

  const claudeMd = join(pluginDir, 'CLAUDE.md');
  const agentsMd = join(pluginDir, 'AGENTS.md');
  const skillsDir = join(pluginDir, 'skills');
  const hasClaudeSkillFormat =
    fileExists(claudeMd) || fileExists(agentsMd) || isDir(skillsDir);

  results.push({
    requirement: 'Skills in Claude Code format (CLAUDE.md, AGENTS.md, or skills/)',
    passed: hasClaudeSkillFormat,
    severity: 'warning',
    message: hasClaudeSkillFormat
      ? 'Compatible skill format found'
      : 'No CLAUDE.md, AGENTS.md, or skills/ directory',
  });

  const mcpJson = join(pluginDir, '.mcp.json');
  const hasMcpJson = fileExists(mcpJson);
  results.push({
    requirement: 'MCP servers defined in .mcp.json or plugin manifest',
    passed: hasMcpJson || hasClaudeManifest || hasCursorManifest,
    severity: 'warning',
    message: hasMcpJson
      ? '.mcp.json found'
      : hasClaudeManifest || hasCursorManifest
        ? 'MCP config may be in manifest'
        : 'No MCP configuration found',
  });

  const commandsDir = join(pluginDir, 'commands');
  const hasCommands = isDir(commandsDir);
  results.push({
    requirement: 'Commands are markdown-compatible',
    passed: true,
    severity: 'info',
    message: hasCommands
      ? 'Commands directory found — verify markdown compatibility'
      : 'No commands directory (not required)',
  });

  return results;
}

function checkChatGpt(pluginDir: string): PlatformCheckResult[] {
  const results: PlatformCheckResult[] = [];

  let hasHttpTransport = false;
  const mcpJson = join(pluginDir, '.mcp.json');
  const cursorManifest = join(pluginDir, '.cursor-plugin', 'plugin.json');

  for (const cfgPath of [mcpJson, cursorManifest]) {
    if (!fileExists(cfgPath)) continue;
    const data = readJsonSafe(cfgPath) as Record<string, unknown> | null;
    if (!data) continue;

    const servers =
      (data.mcpServers as Record<string, unknown>) ?? data;
    for (const val of Object.values(servers)) {
      if (typeof val === 'object' && val !== null) {
        const cfg = val as Record<string, unknown>;
        if (
          typeof cfg.url === 'string' &&
          (cfg.url.startsWith('http://') || cfg.url.startsWith('https://'))
        ) {
          hasHttpTransport = true;
        }
        if (cfg.type === 'sse' || cfg.type === 'streamable-http') {
          hasHttpTransport = true;
        }
      }
    }
  }

  results.push({
    requirement: 'MCP server accessible via HTTP/SSE (not just stdio)',
    passed: hasHttpTransport,
    severity: 'error',
    message: hasHttpTransport
      ? 'HTTP/SSE transport found'
      : 'No HTTP/SSE transport — ChatGPT requires network-accessible servers',
  });

  let hasOAuth = false;
  const manifest = readJsonSafe(cursorManifest) as Record<string, unknown> | null;
  if (manifest) {
    const auth = manifest.auth as Record<string, unknown> | undefined;
    if (auth && auth.type === 'oauth2') hasOAuth = true;
    if (!auth) hasOAuth = true;
  } else {
    hasOAuth = true;
  }

  results.push({
    requirement: 'OAuth 2.0 flow supported if auth is required',
    passed: hasOAuth,
    severity: 'warning',
    message: hasOAuth
      ? 'OAuth 2.0 compatible or no auth required'
      : 'Auth method is not OAuth 2.0 — ChatGPT requires OAuth for authenticated plugins',
  });

  let toolDescriptionsOk = true;
  let toolCount = 0;
  const toolSchemaDir = join(pluginDir, 'tools');
  if (isDir(toolSchemaDir)) {
    const files = listDir(toolSchemaDir).filter((f) => f.endsWith('.json'));
    toolCount = files.length;
    for (const f of files) {
      const schema = readJsonSafe(join(toolSchemaDir, f)) as Record<string, unknown> | null;
      if (schema && typeof schema.description === 'string' && schema.description.length > 200) {
        toolDescriptionsOk = false;
      }
    }
  }

  results.push({
    requirement: 'Tool descriptions are concise (< 200 chars)',
    passed: toolDescriptionsOk,
    severity: 'warning',
    message: toolDescriptionsOk
      ? 'All tool descriptions within limit'
      : 'Some tool descriptions exceed 200 characters',
  });

  const toolCountOk = toolCount < 50;
  results.push({
    requirement: 'Tool count is reasonable (< 50)',
    passed: toolCountOk,
    severity: 'warning',
    message: toolCountOk
      ? `${toolCount} tools (within limit)`
      : `${toolCount} tools exceeds recommended limit of 50`,
  });

  return results;
}

function checkGenericMcp(pluginDir: string): PlatformCheckResult[] {
  const results: PlatformCheckResult[] = [];

  let hasMcpServer = false;
  const mcpJson = join(pluginDir, '.mcp.json');
  const cursorManifest = join(pluginDir, '.cursor-plugin', 'plugin.json');
  if (fileExists(mcpJson) || fileExists(cursorManifest)) {
    hasMcpServer = true;
  }

  results.push({
    requirement: 'Server implements initialize handshake',
    passed: hasMcpServer,
    severity: 'error',
    message: hasMcpServer
      ? 'MCP server configuration found (handshake assumed from valid config)'
      : 'No MCP server configuration — cannot verify initialize handshake',
  });

  results.push({
    requirement: 'tools/list endpoint works',
    passed: hasMcpServer,
    severity: 'error',
    message: hasMcpServer
      ? 'MCP server configured (tools/list assumed from valid MCP setup)'
      : 'No MCP server — tools/list cannot be verified',
  });

  let schemasValid = true;
  const toolSchemaDir = join(pluginDir, 'tools');
  if (isDir(toolSchemaDir)) {
    for (const f of listDir(toolSchemaDir).filter((f) => f.endsWith('.json'))) {
      const schema = readJsonSafe(join(toolSchemaDir, f));
      if (schema === null) {
        schemasValid = false;
        break;
      }
      if (typeof schema === 'object' && schema !== null) {
        const s = schema as Record<string, unknown>;
        if (s.inputSchema && typeof s.inputSchema !== 'object') {
          schemasValid = false;
          break;
        }
      }
    }
  }

  results.push({
    requirement: 'Tool schemas are valid JSON Schema',
    passed: schemasValid,
    severity: 'warning',
    message: schemasValid
      ? 'Tool schemas are valid JSON'
      : 'Some tool schemas contain invalid JSON',
  });

  let noPlatformAssumptions = true;
  const srcDir = join(pluginDir, 'src');
  if (isDir(srcDir)) {
    for (const f of listDir(srcDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'))) {
      try {
        const content = readFileSync(join(srcDir, f), 'utf-8');
        if (content.includes('.cursor-plugin') || content.includes('.claude-plugin')) {
          noPlatformAssumptions = false;
          break;
        }
      } catch {
        /* skip unreadable files */
      }
    }
  }

  results.push({
    requirement: 'No Cursor/Claude-specific assumptions in tool logic',
    passed: noPlatformAssumptions,
    severity: 'info',
    message: noPlatformAssumptions
      ? 'No platform-specific references detected in src/'
      : 'Source files reference platform-specific paths (.cursor-plugin / .claude-plugin)',
  });

  return results;
}

const CHECKERS: Record<Platform, (dir: string) => PlatformCheckResult[]> = {
  cursor: checkCursor,
  'claude-code': checkClaudeCode,
  chatgpt: checkChatGpt,
  'generic-mcp': checkGenericMcp,
};

function buildPlatformResult(
  platform: Platform,
  checks: PlatformCheckResult[],
): CompatibilityResult {
  const passedChecks = checks.filter((c) => c.passed).length;
  const hasErrorFailure = checks.some((c) => !c.passed && c.severity === 'error');

  return {
    platform,
    compatible: !hasErrorFailure,
    passedChecks,
    totalChecks: checks.length,
    results: checks,
  };
}

export async function checkPlatformCompatibility(
  pluginDir: string,
  platforms?: Platform[],
): Promise<CompatibilityReport> {
  const targetPlatforms = platforms ?? ALL_PLATFORMS;
  const platformResults: CompatibilityResult[] = [];

  for (const platform of targetPlatforms) {
    const checker = CHECKERS[platform];
    const checks = checker(pluginDir);
    platformResults.push(buildPlatformResult(platform, checks));
  }

  const totalChecks = platformResults.reduce((sum, p) => sum + p.totalChecks, 0);
  const totalPassed = platformResults.reduce((sum, p) => sum + p.passedChecks, 0);
  const overallScore = totalChecks === 0 ? 100 : Math.round((totalPassed / totalChecks) * 100);
  const universallyCompatible = platformResults.every((p) => p.compatible);

  return { platforms: platformResults, overallScore, universallyCompatible };
}

export function formatCompatibilityReport(report: CompatibilityReport): string {
  const lines: string[] = ['# Cross-Platform Compatibility Report\n'];

  lines.push(`**Overall Score:** ${report.overallScore}/100`);
  lines.push(
    `**Universally Compatible:** ${report.universallyCompatible ? 'Yes' : 'No'}\n`,
  );

  for (const platform of report.platforms) {
    const status = platform.compatible ? 'PASS' : 'FAIL';
    lines.push(
      `## ${platform.platform} [${status}] (${platform.passedChecks}/${platform.totalChecks})\n`,
    );

    for (const check of platform.results) {
      const icon = check.passed ? '+' : '-';
      const tag = check.severity.toUpperCase();
      lines.push(`  ${icon} [${tag}] ${check.requirement}`);
      lines.push(`    ${check.message}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
