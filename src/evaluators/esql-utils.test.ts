import { describe, it, expect } from 'vitest';
import { extractEsql } from './esql-utils.js';

describe('extractEsql', () => {
  it('extracts from ```esql fenced block', () => {
    const input = 'Here is the query:\n```esql\nFROM logs | LIMIT 10\n```\nDone.';
    expect(extractEsql(input)).toBe('FROM logs | LIMIT 10');
  });

  it('extracts from generic fenced block with FROM keyword', () => {
    const input = '```\nFROM logs | KEEP @timestamp\n```';
    expect(extractEsql(input)).toBe('FROM logs | KEEP @timestamp');
  });

  it('prefers ```esql block over generic block', () => {
    const input = '```\nSELECT 1\n```\n```esql\nFROM logs\n```';
    expect(extractEsql(input)).toBe('FROM logs');
  });

  it('extracts bare pipe-syntax lines as fallback', () => {
    const input = 'The query is:\nFROM logs\n| KEEP message\n| LIMIT 5';
    expect(extractEsql(input)).toBe('FROM logs\n| KEEP message\n| LIMIT 5');
  });

  it('returns null when no ES|QL found', () => {
    expect(extractEsql('No query here, just text.')).toBeNull();
  });

  it('trims whitespace from extracted query', () => {
    const input = '```esql\n  FROM logs | LIMIT 10  \n```';
    expect(extractEsql(input)).toBe('FROM logs | LIMIT 10');
  });
});
