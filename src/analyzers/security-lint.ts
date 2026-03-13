import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

export interface SecurityCheckResult {
  check: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  file?: string;
}

export interface SkillSecurityReport {
  skill: string;
  passed: boolean;
  checks: SecurityCheckResult[];
}

interface FileContent {
  path: string;
  content: string;
  lines: string[];
}

const CREDENTIAL_PATTERNS = [
  /api_key\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /token\s*[:=]\s*["']sk-[a-zA-Z0-9]+["']/i,
  /AKIA[0-9A-Z]{16}/,
  /(?:secret_?key|api_?secret)\s*[:=]\s*["'][^"']{8,}["']/i,
  /eyJ[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/,
];

const REAL_EMAIL_PATTERN =
  /[a-zA-Z0-9._%+-]+@(?!example\.com|test\.com|localhost)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// Matches non-RFC1918 IPs (not 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x)
const PUBLIC_IP_PATTERN =
  /\b(?!10\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?!192\.168\.)(?!127\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

const PRODUCTION_DOMAIN_PATTERN = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|org|net|io|co)\b/i;
const SAFE_DOMAINS = /(?:example\.com|test\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)/i;

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous/i,
  /\bsystem\s*:/i,
  /forget\s+(?:all\s+)?(?:your\s+)?instructions/i,
  /you\s+are\s+now/i,
  /disregard\s+(?:all\s+)?(?:prior|previous)/i,
];

async function loadFiles(dir: string): Promise<FileContent[]> {
  const files: FileContent[] = [];
  let names: string[];

  try {
    names = await readdir(dir);
  } catch {
    return files;
  }

  for (const name of names) {
    const ext = name.split('.').pop() ?? '';
    if (!['md', 'ts', 'js', 'mjs'].includes(ext)) continue;

    const filePath = join(dir, name);
    try {
      const content = await readFile(filePath, 'utf-8');
      files.push({ path: filePath, content, lines: content.split('\n') });
    } catch {
      // Unreadable file (or directory with matching extension) — skip
    }
  }

  return files;
}

function checkNoHardcodedCreds(files: FileContent[]): SecurityCheckResult[] {
  const results: SecurityCheckResult[] = [];

  for (const file of files) {
    let found = false;
    for (let i = 0; i < file.lines.length; i++) {
      for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.test(file.lines[i])) {
          results.push({
            check: 'no-hardcoded-creds',
            passed: false,
            severity: 'error',
            message: `Potential hardcoded credential matches pattern ${pattern.source}`,
            line: i + 1,
            file: file.path,
          });
          found = true;
          break;
        }
      }
    }
    if (!found) {
      results.push({
        check: 'no-hardcoded-creds',
        passed: true,
        severity: 'info',
        message: `No hardcoded credentials found`,
        file: file.path,
      });
    }
  }

  return results;
}

function checkScopeDeclaration(files: FileContent[]): SecurityCheckResult[] {
  const skillMd = files.find((f) => f.path.endsWith('SKILL.md'));
  if (!skillMd) {
    return [
      {
        check: 'scope-declaration',
        passed: false,
        severity: 'warning',
        message: 'No SKILL.md found in skill directory',
      },
    ];
  }

  const hasToolsSection =
    /^#+\s*tools/im.test(skillMd.content) || /tools\s*:/im.test(skillMd.content);
  const hasToolReferences = /`\w+(?:_\w+)+`/.test(skillMd.content);

  if (hasToolsSection || hasToolReferences) {
    return [
      {
        check: 'scope-declaration',
        passed: true,
        severity: 'info',
        message: 'SKILL.md declares tools/resources used',
        file: skillMd.path,
      },
    ];
  }

  return [
    {
      check: 'scope-declaration',
      passed: false,
      severity: 'warning',
      message: 'SKILL.md does not declare which tools or resources the skill uses',
      file: skillMd.path,
    },
  ];
}

function checkCleanExampleData(files: FileContent[]): SecurityCheckResult[] {
  const results: SecurityCheckResult[] = [];

  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];

      if (REAL_EMAIL_PATTERN.test(line)) {
        results.push({
          check: 'clean-example-data',
          passed: false,
          severity: 'warning',
          message: 'Line contains what looks like a real email address',
          line: i + 1,
          file: file.path,
        });
      }

      if (PUBLIC_IP_PATTERN.test(line)) {
        const match = line.match(PUBLIC_IP_PATTERN);
        if (match) {
          const octets = match[0].split('.').map(Number);
          if (octets.every((o) => o >= 0 && o <= 255)) {
            results.push({
              check: 'clean-example-data',
              passed: false,
              severity: 'warning',
              message: `Line contains a public IP address: ${match[0]}`,
              line: i + 1,
              file: file.path,
            });
          }
        }
      }

      if (PRODUCTION_DOMAIN_PATTERN.test(line) && !SAFE_DOMAINS.test(line)) {
        results.push({
          check: 'clean-example-data',
          passed: false,
          severity: 'info',
          message: 'Line references a domain that may be production-like',
          line: i + 1,
          file: file.path,
        });
      }
    }
  }

  if (results.length === 0) {
    results.push({
      check: 'clean-example-data',
      passed: true,
      severity: 'info',
      message: 'No suspicious example data found',
    });
  }

  return results;
}

function checkToolDescriptionHygiene(files: FileContent[]): SecurityCheckResult[] {
  const results: SecurityCheckResult[] = [];

  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      for (const pattern of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(file.lines[i])) {
          results.push({
            check: 'tool-description-hygiene',
            passed: false,
            severity: 'error',
            message: `Potential prompt injection pattern: ${pattern.source}`,
            line: i + 1,
            file: file.path,
          });
        }
      }
    }
  }

  if (results.length === 0) {
    results.push({
      check: 'tool-description-hygiene',
      passed: true,
      severity: 'info',
      message: 'No prompt injection patterns detected',
    });
  }

  return results;
}

export async function runSkillSecurityChecks(skillDir: string): Promise<SkillSecurityReport> {
  const files = await loadFiles(skillDir);
  const skillName = skillDir.split('/').pop() ?? skillDir;

  const checks = [
    ...checkNoHardcodedCreds(files),
    ...checkScopeDeclaration(files),
    ...checkCleanExampleData(files),
    ...checkToolDescriptionHygiene(files),
  ];

  return {
    skill: skillName,
    passed: checks.every((c) => c.passed),
    checks,
  };
}

export async function runAllSkillSecurityChecks(pluginDir: string): Promise<SkillSecurityReport[]> {
  const skillsDir = join(pluginDir, 'skills');
  let names: string[];

  try {
    names = await readdir(skillsDir);
  } catch {
    return [];
  }

  const reports: SkillSecurityReport[] = [];
  for (const name of names) {
    const childPath = join(skillsDir, name);
    try {
      const content = await readFile(join(childPath, 'SKILL.md'), 'utf-8');
      // Only scan directories that contain a SKILL.md
      if (content) reports.push(await runSkillSecurityChecks(childPath));
    } catch {
      // Not a skill directory — skip
    }
  }

  return reports;
}

export function formatSecurityReport(reports: SkillSecurityReport[]): string {
  if (reports.length === 0) return 'No skills found to scan.\n';

  const lines: string[] = ['# Security Scan Results\n'];
  const totalPassed = reports.filter((r) => r.passed).length;
  lines.push(`**${totalPassed}/${reports.length}** skills passed all checks.\n`);

  for (const report of reports) {
    const icon = report.passed ? '\u2705' : '\u274c';
    lines.push(`## ${icon} ${report.skill}\n`);

    const failures = report.checks.filter((c) => !c.passed);
    if (failures.length === 0) {
      lines.push('All checks passed.\n');
      continue;
    }

    for (const check of failures) {
      const loc = check.line ? `:${check.line}` : '';
      const fileRef = check.file ? ` (${check.file}${loc})` : '';
      lines.push(
        `- **[${check.severity.toUpperCase()}]** \`${check.check}\`: ${check.message}${fileRef}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
