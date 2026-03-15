import { evaluateAssertions } from './assertions.js';

describe('evaluateAssertions', () => {
  describe('eq operator', () => {
    it('passes when values are equal', () => {
      const result = evaluateAssertions({ status: 'ok' }, [
        { field: 'status', op: 'eq', value: 'ok' },
      ]);
      expect(result.pass).toBe(true);
      expect(result.results[0].pass).toBe(true);
    });

    it('fails when values differ', () => {
      const result = evaluateAssertions({ status: 'error' }, [
        { field: 'status', op: 'eq', value: 'ok' },
      ]);
      expect(result.pass).toBe(false);
    });
  });

  describe('neq operator', () => {
    it('passes when values differ', () => {
      const result = evaluateAssertions({ status: 'error' }, [
        { field: 'status', op: 'neq', value: 'ok' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('fails when values are equal', () => {
      const result = evaluateAssertions({ status: 'ok' }, [
        { field: 'status', op: 'neq', value: 'ok' },
      ]);
      expect(result.pass).toBe(false);
    });
  });

  describe('gt / gte / lt / lte operators', () => {
    it('gt passes when actual > expected', () => {
      const result = evaluateAssertions({ count: 10 }, [{ field: 'count', op: 'gt', value: 5 }]);
      expect(result.pass).toBe(true);
    });

    it('gt fails when actual <= expected', () => {
      const result = evaluateAssertions({ count: 5 }, [{ field: 'count', op: 'gt', value: 5 }]);
      expect(result.pass).toBe(false);
    });

    it('gte passes when actual >= expected', () => {
      const result = evaluateAssertions({ count: 5 }, [{ field: 'count', op: 'gte', value: 5 }]);
      expect(result.pass).toBe(true);
    });

    it('lt passes when actual < expected', () => {
      const result = evaluateAssertions({ count: 3 }, [{ field: 'count', op: 'lt', value: 5 }]);
      expect(result.pass).toBe(true);
    });

    it('lte passes when actual <= expected', () => {
      const result = evaluateAssertions({ count: 5 }, [{ field: 'count', op: 'lte', value: 5 }]);
      expect(result.pass).toBe(true);
    });
  });

  describe('contains operator', () => {
    it('passes when string contains substring', () => {
      const result = evaluateAssertions({ message: 'hello world' }, [
        { field: 'message', op: 'contains', value: 'world' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('fails when string does not contain substring', () => {
      const result = evaluateAssertions({ message: 'hello world' }, [
        { field: 'message', op: 'contains', value: 'xyz' },
      ]);
      expect(result.pass).toBe(false);
    });
  });

  describe('not_contains operator', () => {
    it('passes when string does not contain substring', () => {
      const result = evaluateAssertions({ message: 'hello world' }, [
        { field: 'message', op: 'not_contains', value: 'xyz' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('fails when string contains substring', () => {
      const result = evaluateAssertions({ message: 'hello world' }, [
        { field: 'message', op: 'not_contains', value: 'world' },
      ]);
      expect(result.pass).toBe(false);
    });
  });

  describe('exists operator', () => {
    it('passes when field exists', () => {
      const result = evaluateAssertions({ name: 'test' }, [{ field: 'name', op: 'exists' }]);
      expect(result.pass).toBe(true);
    });

    it('fails when field is undefined', () => {
      const result = evaluateAssertions({}, [{ field: 'name', op: 'exists' }]);
      expect(result.pass).toBe(false);
    });
  });

  describe('not_exists operator', () => {
    it('passes when field is missing', () => {
      const result = evaluateAssertions({}, [{ field: 'name', op: 'not_exists' }]);
      expect(result.pass).toBe(true);
    });

    it('fails when field is present', () => {
      const result = evaluateAssertions({ name: 'test' }, [{ field: 'name', op: 'not_exists' }]);
      expect(result.pass).toBe(false);
    });
  });

  describe('length_gte / length_lte operators', () => {
    it('length_gte passes when array length >= expected', () => {
      const result = evaluateAssertions({ items: [1, 2, 3] }, [
        { field: 'items', op: 'length_gte', value: 2 },
      ]);
      expect(result.pass).toBe(true);
    });

    it('length_gte fails when array length < expected', () => {
      const result = evaluateAssertions({ items: [1] }, [
        { field: 'items', op: 'length_gte', value: 2 },
      ]);
      expect(result.pass).toBe(false);
    });

    it('length_lte passes when string length <= expected', () => {
      const result = evaluateAssertions({ text: 'hi' }, [
        { field: 'text', op: 'length_lte', value: 5 },
      ]);
      expect(result.pass).toBe(true);
    });

    it('length_lte fails when string length > expected', () => {
      const result = evaluateAssertions({ text: 'hello world' }, [
        { field: 'text', op: 'length_lte', value: 5 },
      ]);
      expect(result.pass).toBe(false);
    });
  });

  describe('type operator', () => {
    it('passes for matching type', () => {
      const result = evaluateAssertions({ val: 'hello' }, [
        { field: 'val', op: 'type', value: 'string' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('detects array type', () => {
      const result = evaluateAssertions({ val: [1, 2] }, [
        { field: 'val', op: 'type', value: 'array' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('fails on type mismatch', () => {
      const result = evaluateAssertions({ val: 42 }, [
        { field: 'val', op: 'type', value: 'string' },
      ]);
      expect(result.pass).toBe(false);
    });
  });

  describe('matches operator (regex)', () => {
    it('passes when regex matches', () => {
      const result = evaluateAssertions({ id: 'abc-123' }, [
        { field: 'id', op: 'matches', value: '^[a-z]+-\\d+$' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('fails when regex does not match', () => {
      const result = evaluateAssertions({ id: 'ABC' }, [
        { field: 'id', op: 'matches', value: '^[a-z]+$' },
      ]);
      expect(result.pass).toBe(false);
    });
  });

  describe('dot-path field access', () => {
    it('resolves nested fields', () => {
      const result = evaluateAssertions({ nested: { field: 'value' } }, [
        { field: 'nested.field', op: 'eq', value: 'value' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('returns undefined for missing nested path', () => {
      const result = evaluateAssertions({ a: {} }, [{ field: 'a.b.c', op: 'not_exists' }]);
      expect(result.pass).toBe(true);
    });
  });

  describe('array index access', () => {
    it('resolves numeric array indices', () => {
      const result = evaluateAssertions({ content: [{ text: 'first' }, { text: 'second' }] }, [
        { field: 'content.0.text', op: 'eq', value: 'first' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('resolves deeper array indices', () => {
      const result = evaluateAssertions({ content: [{ text: 'first' }, { text: 'second' }] }, [
        { field: 'content.1.text', op: 'eq', value: 'second' },
      ]);
      expect(result.pass).toBe(true);
    });
  });

  describe('multiple assertions', () => {
    it('reports overall pass when all assertions pass', () => {
      const result = evaluateAssertions({ status: 'ok', count: 10 }, [
        { field: 'status', op: 'eq', value: 'ok' },
        { field: 'count', op: 'gt', value: 5 },
      ]);
      expect(result.pass).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.pass)).toBe(true);
    });

    it('reports overall fail when any assertion fails', () => {
      const result = evaluateAssertions({ status: 'error', count: 10 }, [
        { field: 'status', op: 'eq', value: 'ok' },
        { field: 'count', op: 'gt', value: 5 },
      ]);
      expect(result.pass).toBe(false);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].pass).toBe(false);
      expect(result.results[1].pass).toBe(true);
    });
  });

  describe('universal not_ prefix negation', () => {
    it('not_eq passes when values differ', () => {
      const result = evaluateAssertions({ status: 'error' }, [
        { field: 'status', op: 'not_eq' as any, value: 'ok' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_eq fails when values are equal', () => {
      const result = evaluateAssertions({ status: 'ok' }, [
        { field: 'status', op: 'not_eq' as any, value: 'ok' },
      ]);
      expect(result.pass).toBe(false);
    });

    it('not_gt passes when actual <= expected', () => {
      const result = evaluateAssertions({ count: 5 }, [
        { field: 'count', op: 'not_gt' as any, value: 5 },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_gt fails when actual > expected', () => {
      const result = evaluateAssertions({ count: 10 }, [
        { field: 'count', op: 'not_gt' as any, value: 5 },
      ]);
      expect(result.pass).toBe(false);
    });

    it('not_gte passes when actual < expected', () => {
      const result = evaluateAssertions({ count: 4 }, [
        { field: 'count', op: 'not_gte' as any, value: 5 },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_lt passes when actual >= expected', () => {
      const result = evaluateAssertions({ count: 5 }, [
        { field: 'count', op: 'not_lt' as any, value: 5 },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_lte passes when actual > expected', () => {
      const result = evaluateAssertions({ count: 6 }, [
        { field: 'count', op: 'not_lte' as any, value: 5 },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_matches passes when regex does not match', () => {
      const result = evaluateAssertions({ id: 'ABC' }, [
        { field: 'id', op: 'not_matches' as any, value: '^[a-z]+$' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_matches fails when regex matches', () => {
      const result = evaluateAssertions({ id: 'abc' }, [
        { field: 'id', op: 'not_matches' as any, value: '^[a-z]+$' },
      ]);
      expect(result.pass).toBe(false);
    });

    it('not_one_of passes when value is not in list', () => {
      const result = evaluateAssertions({ color: 'green' }, [
        { field: 'color', op: 'not_one_of' as any, value: ['red', 'blue'] },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_one_of fails when value is in list', () => {
      const result = evaluateAssertions({ color: 'red' }, [
        { field: 'color', op: 'not_one_of' as any, value: ['red', 'blue'] },
      ]);
      expect(result.pass).toBe(false);
    });

    it('not_starts_with passes when string does not start with prefix', () => {
      const result = evaluateAssertions({ name: 'world' }, [
        { field: 'name', op: 'not_starts_with' as any, value: 'hello' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_starts_with fails when string starts with prefix', () => {
      const result = evaluateAssertions({ name: 'hello world' }, [
        { field: 'name', op: 'not_starts_with' as any, value: 'hello' },
      ]);
      expect(result.pass).toBe(false);
    });

    it('not_ends_with passes when string does not end with suffix', () => {
      const result = evaluateAssertions({ name: 'hello' }, [
        { field: 'name', op: 'not_ends_with' as any, value: 'world' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_ends_with fails when string ends with suffix', () => {
      const result = evaluateAssertions({ name: 'hello world' }, [
        { field: 'name', op: 'not_ends_with' as any, value: 'world' },
      ]);
      expect(result.pass).toBe(false);
    });

    it('not_length_gte passes when array length < expected', () => {
      const result = evaluateAssertions({ items: [1] }, [
        { field: 'items', op: 'not_length_gte' as any, value: 3 },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_length_lte passes when string length > expected', () => {
      const result = evaluateAssertions({ text: 'hello world' }, [
        { field: 'text', op: 'not_length_lte' as any, value: 5 },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_type passes when type does not match', () => {
      const result = evaluateAssertions({ val: 42 }, [
        { field: 'val', op: 'not_type' as any, value: 'string' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('not_type fails when type matches', () => {
      const result = evaluateAssertions({ val: 'hello' }, [
        { field: 'val', op: 'not_type' as any, value: 'string' },
      ]);
      expect(result.pass).toBe(false);
    });

    it('existing not_contains still works via explicit implementation', () => {
      const result = evaluateAssertions({ message: 'hello world' }, [
        { field: 'message', op: 'not_contains', value: 'xyz' },
      ]);
      expect(result.pass).toBe(true);
    });

    it('existing not_exists still works via explicit implementation', () => {
      const result = evaluateAssertions({}, [{ field: 'name', op: 'not_exists' }]);
      expect(result.pass).toBe(true);
    });

    it('fails for completely unknown ops', () => {
      const result = evaluateAssertions({ val: 1 }, [
        { field: 'val', op: 'bogus_op' as any, value: 1 },
      ]);
      expect(result.pass).toBe(false);
    });
  });
});
