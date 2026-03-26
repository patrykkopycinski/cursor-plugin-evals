import { describe, it, expect } from 'vitest';
import { SnapshotStore, defaultSanitizers, type Sanitizer } from './store.js';

describe('SnapshotStore', () => {
  it('captures and matches identical snapshots', () => {
    const store = new SnapshotStore();
    const data = { result: 'hello', count: 3 };
    store.update('test-1', data);
    expect(store.match('test-1', data)).toEqual({ matches: true, diff: null });
  });

  it('detects differences', () => {
    const store = new SnapshotStore();
    store.update('test-1', { result: 'hello' });
    const result = store.match('test-1', { result: 'world' });
    expect(result.matches).toBe(false);
    expect(result.diff).toBeTruthy();
  });

  it('returns no-snapshot for unknown keys', () => {
    const store = new SnapshotStore();
    const result = store.match('unknown', { a: 1 });
    expect(result.matches).toBe(false);
    expect(result.diff).toContain('no snapshot');
  });

  it('applies sanitizers before comparison', () => {
    const store = new SnapshotStore();
    const sanitize: Sanitizer = (obj) => { const c = { ...obj }; delete c.timestamp; delete c.id; return c; };
    store.update('test-1', { result: 'ok', timestamp: '2026-01-01', id: 'abc' }, [sanitize]);
    const result = store.match('test-1', { result: 'ok', timestamp: '2026-12-31', id: 'xyz' }, [sanitize]);
    expect(result.matches).toBe(true);
  });

  it('serializes and deserializes via JSON', () => {
    const store1 = new SnapshotStore();
    store1.update('k', { v: 1 });
    const json = store1.toJSON();
    const store2 = new SnapshotStore();
    store2.loadFromJSON(json);
    expect(store2.match('k', { v: 1 })).toEqual({ matches: true, diff: null });
  });
});

describe('defaultSanitizers', () => {
  it('strips timestamps', () => {
    const s = defaultSanitizers.timestamps({ created_at: '2026-03-26T12:00:00Z', name: 'test' });
    expect(s.created_at).toBe('[TIMESTAMP]');
    expect(s.name).toBe('test');
  });

  it('strips UUIDs', () => {
    const s = defaultSanitizers.uuids({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'test' });
    expect(s.id).toBe('[UUID]');
  });

  it('strips numeric IDs', () => {
    const s = defaultSanitizers.numericIds({ id: 123456789, name: 'test' });
    expect(s.id).toBe('[ID]');
  });

  it('leaves non-matching values unchanged', () => {
    const s = defaultSanitizers.timestamps({ name: 'not-a-date', count: 5 });
    expect(s.name).toBe('not-a-date');
    expect(s.count).toBe(5);
  });
});
