import { describe, it, expect } from 'vitest';
import {
  checkGuardrails,
  DEFAULT_GUARDRAILS,
  type GuardrailRule,
} from './index.js';

describe('checkGuardrails', () => {
  it('returns null when no rules match', () => {
    const result = checkGuardrails(DEFAULT_GUARDRAILS, 'elasticsearch_api', {
      method: 'GET',
      path: '/my-index/_search',
    });
    expect(result).toBeNull();
  });

  it('detects DELETE _all pattern', () => {
    const result = checkGuardrails(DEFAULT_GUARDRAILS, 'elasticsearch_api', {
      method: 'DELETE',
      path: '/_all',
    });
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('block-delete-all');
    expect(result!.action).toBe('block');
    expect(result!.message).toBe('Blocked destructive DELETE operation');
  });

  it('detects _delete_by_query pattern', () => {
    const result = checkGuardrails(DEFAULT_GUARDRAILS, 'elasticsearch_api', {
      method: 'POST',
      path: '/my-index/_delete_by_query',
    });
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('block-delete-all');
    expect(result!.action).toBe('block');
  });

  it('detects DROP DATABASE pattern', () => {
    const result = checkGuardrails(DEFAULT_GUARDRAILS, 'esql_query', {
      query: 'DROP DATABASE production',
    });
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('block-drop');
    expect(result!.action).toBe('block');
    expect(result!.message).toBe('Blocked destructive DROP operation');
  });

  it('detects DROP TABLE pattern', () => {
    const result = checkGuardrails(DEFAULT_GUARDRAILS, 'esql_query', {
      query: 'DROP TABLE users',
    });
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('block-drop');
  });

  it('detects DROP INDEX pattern', () => {
    const result = checkGuardrails(DEFAULT_GUARDRAILS, 'esql_query', {
      query: 'DROP INDEX idx_users',
    });
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('block-drop');
  });

  it('is case-insensitive for destructive patterns', () => {
    const result = checkGuardrails(DEFAULT_GUARDRAILS, 'esql_query', {
      query: 'drop table users',
    });
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('block-drop');
  });

  it('returns the first matching rule', () => {
    const rules: GuardrailRule[] = [
      { name: 'rule-a', pattern: /foo/i, action: 'warn', message: 'Warning A' },
      { name: 'rule-b', pattern: /foo/i, action: 'block', message: 'Block B' },
    ];

    const result = checkGuardrails(rules, 'tool', { text: 'foo' });
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('rule-a');
    expect(result!.action).toBe('warn');
  });

  it('supports warn action', () => {
    const rules: GuardrailRule[] = [
      { name: 'warn-rule', pattern: /sensitive/i, action: 'warn', message: 'Careful!' },
    ];

    const result = checkGuardrails(rules, 'my_tool', { data: 'sensitive info' });
    expect(result).not.toBeNull();
    expect(result!.action).toBe('warn');
    expect(result!.tool).toBe('my_tool');
  });

  it('supports log action', () => {
    const rules: GuardrailRule[] = [
      { name: 'log-rule', pattern: /audit/i, action: 'log' },
    ];

    const result = checkGuardrails(rules, 'audit_tool', { action: 'read' });
    expect(result).not.toBeNull();
    expect(result!.action).toBe('log');
    expect(result!.message).toContain('audit_tool');
  });

  it('returns null for empty rules array', () => {
    const result = checkGuardrails([], 'any_tool', { any: 'args' });
    expect(result).toBeNull();
  });

  it('matches against tool name', () => {
    const rules: GuardrailRule[] = [
      { name: 'block-rm', pattern: /rm_rf/i, action: 'block', message: 'No rm -rf' },
    ];

    const result = checkGuardrails(rules, 'rm_rf', {});
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('block-rm');
  });

  it('provides default message when none specified', () => {
    const rules: GuardrailRule[] = [
      { name: 'test-rule', pattern: /trigger/, action: 'block' },
    ];

    const result = checkGuardrails(rules, 'my_tool', { val: 'trigger' });
    expect(result).not.toBeNull();
    expect(result!.message).toBe('Guardrail "test-rule" triggered on tool "my_tool"');
  });
});

describe('DEFAULT_GUARDRAILS', () => {
  it('contains expected default rules', () => {
    expect(DEFAULT_GUARDRAILS).toHaveLength(2);
    expect(DEFAULT_GUARDRAILS.map((r) => r.name)).toEqual([
      'block-delete-all',
      'block-drop',
    ]);
  });

  it('all defaults use block action', () => {
    for (const rule of DEFAULT_GUARDRAILS) {
      expect(rule.action).toBe('block');
    }
  });
});
