import type { DerivedMetricConfig, DerivedMetricResult } from '../core/types.js';

type EvaluatorSummary = Record<
  string,
  { mean: number; min: number; max: number; pass: number; total: number }
>;

type TokenKind = 'number' | 'name' | 'op' | 'lparen' | 'rparen' | 'comma';

interface Token {
  kind: TokenKind;
  value: string;
}

const FUNCTIONS = new Set(['min', 'max', 'avg']);

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    if (/\s/.test(expr[i])) {
      i++;
      continue;
    }

    if (/[0-9.]/.test(expr[i])) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i++];
      }
      tokens.push({ kind: 'number', value: num });
      continue;
    }

    if (/[a-zA-Z_]/.test(expr[i])) {
      let name = '';
      while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) {
        name += expr[i++];
      }
      tokens.push({ kind: 'name', value: name });
      continue;
    }

    if ('+-*/'.includes(expr[i])) {
      tokens.push({ kind: 'op', value: expr[i++] });
      continue;
    }

    if (expr[i] === '(') {
      tokens.push({ kind: 'lparen', value: '(' });
      i++;
      continue;
    }

    if (expr[i] === ')') {
      tokens.push({ kind: 'rparen', value: ')' });
      i++;
      continue;
    }

    if (expr[i] === ',') {
      tokens.push({ kind: 'comma', value: ',' });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${expr[i]}' at position ${i} in formula`);
  }

  return tokens;
}

/**
 * Recursive descent parser for math expressions.
 *
 * Grammar:
 *   expr     → term (('+' | '-') term)*
 *   term     → unary (('*' | '/') unary)*
 *   unary    → '-' unary | primary
 *   primary  → NUMBER | NAME | FUNC '(' arglist ')' | '(' expr ')'
 *   arglist  → expr (',' expr)*
 */
class Parser {
  private pos = 0;

  constructor(
    private tokens: Token[],
    private vars: Record<string, number>,
  ) {}

  parse(): number {
    const result = this.expr();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token '${this.tokens[this.pos].value}' at end of formula`);
    }
    return result;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expect(kind: TokenKind): Token {
    const tok = this.consume();
    if (!tok || tok.kind !== kind) {
      throw new Error(
        `Expected ${kind} but got ${tok ? `'${tok.value}'` : 'end of expression'}`,
      );
    }
    return tok;
  }

  private expr(): number {
    let left = this.term();
    while (this.peek()?.kind === 'op' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = this.consume().value;
      const right = this.term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number {
    let left = this.unary();
    while (this.peek()?.kind === 'op' && (this.peek()!.value === '*' || this.peek()!.value === '/')) {
      const op = this.consume().value;
      const right = this.unary();
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero in formula');
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private unary(): number {
    if (this.peek()?.kind === 'op' && this.peek()!.value === '-') {
      this.consume();
      return -this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const tok = this.peek();
    if (!tok) throw new Error('Unexpected end of formula');

    if (tok.kind === 'number') {
      this.consume();
      const val = Number(tok.value);
      if (!Number.isFinite(val)) throw new Error(`Invalid number literal '${tok.value}'`);
      return val;
    }

    if (tok.kind === 'name') {
      this.consume();
      if (FUNCTIONS.has(tok.value) && this.peek()?.kind === 'lparen') {
        return this.funcCall(tok.value);
      }
      if (!(tok.value in this.vars)) {
        throw new Error(`Unknown evaluator '${tok.value}' referenced in formula`);
      }
      return this.vars[tok.value];
    }

    if (tok.kind === 'lparen') {
      this.consume();
      const val = this.expr();
      this.expect('rparen');
      return val;
    }

    throw new Error(`Unexpected token '${tok.value}' in formula`);
  }

  private funcCall(name: string): number {
    this.expect('lparen');
    const args: number[] = [this.expr()];
    while (this.peek()?.kind === 'comma') {
      this.consume();
      args.push(this.expr());
    }
    this.expect('rparen');

    switch (name) {
      case 'min':
        return Math.min(...args);
      case 'max':
        return Math.max(...args);
      case 'avg':
        return args.reduce((a, b) => a + b, 0) / args.length;
      default:
        throw new Error(`Unknown function '${name}' in formula`);
    }
  }
}

function evaluateFormula(formula: string, vars: Record<string, number>): number {
  const tokens = tokenize(formula);
  if (tokens.length === 0) throw new Error('Empty formula');
  const parser = new Parser(tokens, vars);
  return parser.parse();
}

export function evaluateDerivedMetrics(
  metrics: DerivedMetricConfig[],
  evaluatorSummary: EvaluatorSummary,
): DerivedMetricResult[] {
  const vars: Record<string, number> = {};
  for (const [name, summary] of Object.entries(evaluatorSummary)) {
    vars[name] = summary.mean;
  }

  return metrics.map((metric) => {
    try {
      const value = evaluateFormula(metric.formula, vars);
      const pass = metric.threshold != null ? value >= metric.threshold : true;
      return { name: metric.name, value, threshold: metric.threshold, pass };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        name: metric.name,
        value: 0,
        threshold: metric.threshold,
        pass: false,
        error: `Formula evaluation failed: ${msg}`,
      };
    }
  });
}

export { evaluateFormula as _evaluateFormulaForTesting };
