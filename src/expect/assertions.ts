import type { AssertionConfig, AssertionOp } from '../core/types.js';

export class FieldAssertion {
  private fieldPath: string;
  private assertions: AssertionConfig[] = [];

  constructor(field: string) {
    this.fieldPath = field;
  }

  private push(op: AssertionOp, value?: unknown): this {
    this.assertions.push({ field: this.fieldPath, op, value });
    return this;
  }

  eq(value: unknown): this {
    return this.push('eq', value);
  }

  neq(value: unknown): this {
    return this.push('neq', value);
  }

  gt(value: number): this {
    return this.push('gt', value);
  }

  gte(value: number): this {
    return this.push('gte', value);
  }

  lt(value: number): this {
    return this.push('lt', value);
  }

  lte(value: number): this {
    return this.push('lte', value);
  }

  contains(value: string): this {
    return this.push('contains', value);
  }

  notContains(value: string): this {
    return this.push('not_contains', value);
  }

  exists(): this {
    return this.push('exists');
  }

  notExists(): this {
    return this.push('not_exists');
  }

  lengthGte(value: number): this {
    return this.push('length_gte', value);
  }

  lengthLte(value: number): this {
    return this.push('length_lte', value);
  }

  type(value: string): this {
    return this.push('type', value);
  }

  matches(value: string): this {
    return this.push('matches', value);
  }

  toAssertions(): AssertionConfig[] {
    return [...this.assertions];
  }
}
