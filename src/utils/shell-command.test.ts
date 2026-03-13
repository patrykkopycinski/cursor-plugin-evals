import { describe, it, expect } from 'vitest';
import {
  extractToolNameFromShellCommand,
  parseShellCommandArgs,
  normalizeToolCall,
  buildToolCatalogSection,
} from './shell-command.js';

const SECURITY_SCRIPTS: Record<string, string> = {
  'case-manager.js': 'case_manager',
  'fetch-next-alert.js': 'fetch_next_alert',
  'acknowledge-alert.js': 'acknowledge_alert',
  'run-query.js': 'run_query',
  'rule-manager.js': 'rule_manager',
  'response-actions.js': 'response_actions',
  'entity-analytics.js': 'entity_analytics',
  'workflow-manager.js': 'workflow_manager',
};

describe('extractToolNameFromShellCommand', () => {
  it('returns the canonical tool name for a known script', () => {
    expect(
      extractToolNameFromShellCommand(
        'node skills/security/case-management/scripts/case-manager.js create',
        SECURITY_SCRIPTS,
      ),
    ).toBe('case_manager');
  });

  it('returns undefined for an unknown script', () => {
    expect(
      extractToolNameFromShellCommand('node some-other-script.js', SECURITY_SCRIPTS),
    ).toBeUndefined();
  });

  it('matches scripts embedded in longer commands', () => {
    expect(
      extractToolNameFromShellCommand(
        'cd /tmp/workspace && node skills/security/alert-triage/scripts/run-query.js --type esql',
        SECURITY_SCRIPTS,
      ),
    ).toBe('run_query');
  });

  it('returns undefined with empty mapping', () => {
    expect(extractToolNameFromShellCommand('node case-manager.js create')).toBeUndefined();
  });
});

describe('parseShellCommandArgs', () => {
  it('parses action as the first positional argument', () => {
    const result = parseShellCommandArgs(
      'node scripts/case-manager.js create --title "Test Case"',
      SECURITY_SCRIPTS,
    );
    expect(result).toEqual({ action: 'create', title: 'Test Case' });
  });

  it('parses multiple flags', () => {
    const result = parseShellCommandArgs(
      'node scripts/case-manager.js create --title "My Case" --severity critical',
      SECURITY_SCRIPTS,
    );
    expect(result).toEqual({
      action: 'create',
      title: 'My Case',
      severity: 'critical',
    });
  });

  it('parses boolean flags', () => {
    const result = parseShellCommandArgs(
      'node scripts/fetch-next-alert.js --json',
      SECURITY_SCRIPTS,
    );
    expect(result).toEqual({ action: undefined, json: true });
  });

  it('returns undefined for unknown scripts', () => {
    expect(parseShellCommandArgs('node unknown.js --flag', SECURITY_SCRIPTS)).toBeUndefined();
  });

  it('parses flags with dashes converted to underscores', () => {
    const result = parseShellCommandArgs(
      'node scripts/case-manager.js get --case-id abc-123',
      SECURITY_SCRIPTS,
    );
    expect(result).toEqual({ action: 'get', case_id: 'abc-123' });
  });

  it('parses piped input', () => {
    const result = parseShellCommandArgs(
      'echo "SELECT * FROM logs" | node scripts/run-query.js',
      SECURITY_SCRIPTS,
    );
    expect(result).toEqual({ action: 'SELECT * FROM logs' });
  });
});

describe('normalizeToolCall', () => {
  it('resolves shell commands to canonical tool names', () => {
    const result = normalizeToolCall(
      'shell',
      { command: 'node skills/security/case-management/scripts/case-manager.js list' },
      { scriptToTool: SECURITY_SCRIPTS },
    );
    expect(result.name).toBe('case_manager');
    expect(result.arguments).toEqual({ action: 'list' });
  });

  it('passes through non-shell tool calls unchanged', () => {
    const result = normalizeToolCall(
      'read_file',
      { path: '/tmp/file.txt' },
      { scriptToTool: SECURITY_SCRIPTS },
    );
    expect(result.name).toBe('read_file');
    expect(result.arguments).toEqual({ path: '/tmp/file.txt' });
  });

  it('passes through when no mapping provided', () => {
    const result = normalizeToolCall('shell', { command: 'ls -la' });
    expect(result.name).toBe('shell');
  });

  it('falls back to original when command does not match mapping', () => {
    const result = normalizeToolCall(
      'shell',
      { command: 'ls -la' },
      { scriptToTool: SECURITY_SCRIPTS },
    );
    expect(result.name).toBe('shell');
    expect(result.arguments).toEqual({ command: 'ls -la' });
  });

  it('works with cmd alias', () => {
    const result = normalizeToolCall(
      'shell',
      { cmd: 'node scripts/entity-analytics.js engine-status' },
      { scriptToTool: SECURITY_SCRIPTS },
    );
    expect(result.name).toBe('entity_analytics');
  });
});

describe('buildToolCatalogSection', () => {
  it('returns empty string for empty catalog', () => {
    expect(buildToolCatalogSection({})).toBe('');
  });

  it('returns markdown-formatted tool list', () => {
    const section = buildToolCatalogSection({
      case_manager: 'Manage SOC cases',
      run_query: 'Run ES|QL queries',
    });
    expect(section).toContain('## Available Tools');
    expect(section).toContain('**case_manager**: Manage SOC cases');
    expect(section).toContain('**run_query**: Run ES|QL queries');
  });
});
