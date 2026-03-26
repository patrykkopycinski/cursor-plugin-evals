import { describe, it, expect } from 'vitest';
import { validateToolDependencies } from './tool-deps.js';

describe('validateToolDependencies', () => {
  it('passes when all tools exist', () => {
    const r = validateToolDependencies(['search', 'query'], ['search', 'query', 'index']);
    expect(r.valid).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it('fails when tools missing', () => {
    const r = validateToolDependencies(['search', 'delete_all'], ['search', 'query']);
    expect(r.valid).toBe(false);
    expect(r.missing).toContain('delete_all');
  });

  it('passes with empty expected', () => {
    expect(validateToolDependencies([], ['search']).valid).toBe(true);
  });

  it('reports all missing', () => {
    const r = validateToolDependencies(['a', 'b', 'c'], ['d']);
    expect(r.missing).toEqual(['a', 'b', 'c']);
  });

  it('includes available tools', () => {
    const r = validateToolDependencies(['search'], ['search', 'query']);
    expect(r.available).toContain('query');
  });
});
