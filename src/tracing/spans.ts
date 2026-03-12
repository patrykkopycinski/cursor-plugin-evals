import { randomBytes } from 'node:crypto';

export interface SpanContext {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
  attributes: Record<string, string | number | boolean>;
  children: SpanContext[];
  endTime?: number;
  status?: 'ok' | 'error';
}

function generateId(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export class Tracer {
  readonly serviceName: string;
  private readonly roots: SpanContext[] = [];
  private readonly stack: SpanContext[] = [];

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  startSpan(name: string, attributes: Record<string, string | number | boolean> = {}): SpanContext {
    const parent = this.stack[this.stack.length - 1];
    const span: SpanContext = {
      traceId: parent?.traceId ?? generateId(16),
      spanId: generateId(8),
      name,
      startTime: Date.now(),
      attributes: { 'service.name': this.serviceName, ...attributes },
      children: [],
    };

    if (parent) {
      parent.children.push(span);
    } else {
      this.roots.push(span);
    }

    this.stack.push(span);
    return span;
  }

  endSpan(span: SpanContext, status: 'ok' | 'error' = 'ok'): void {
    span.endTime = Date.now();
    span.status = status;

    const idx = this.stack.lastIndexOf(span);
    if (idx !== -1) {
      this.stack.splice(idx, 1);
    }
  }

  getRootSpans(): SpanContext[] {
    return this.roots;
  }

  getAllSpans(): SpanContext[] {
    const result: SpanContext[] = [];
    const collect = (spans: SpanContext[]): void => {
      for (const span of spans) {
        result.push(span);
        collect(span.children);
      }
    };
    collect(this.roots);
    return result;
  }
}

export function createTracer(serviceName: string): Tracer {
  return new Tracer(serviceName);
}

async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, attributes);
  try {
    const result = await fn();
    tracer.endSpan(span, 'ok');
    return result;
  } catch (err) {
    tracer.endSpan(span, 'error');
    throw err;
  }
}

export function withRunSpan<T>(
  tracer: Tracer,
  runId: string,
  config: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(tracer, 'eval.run', { 'eval.run_id': runId, 'eval.config': config }, fn);
}

export function withSuiteSpan<T>(
  tracer: Tracer,
  suiteName: string,
  layer: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(
    tracer,
    `eval.suite.${suiteName}`,
    { 'eval.suite': suiteName, 'eval.layer': layer },
    fn,
  );
}

export function withTestSpan<T>(
  tracer: Tracer,
  testName: string,
  prompt: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const attributes: Record<string, string | number | boolean> = { 'eval.test': testName };
  if (prompt !== undefined) {
    attributes['eval.prompt'] = prompt;
  }
  return withSpan(tracer, `eval.test.${testName}`, attributes, fn);
}

export function withToolCallSpan<T>(
  tracer: Tracer,
  toolName: string,
  argsHash: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(
    tracer,
    `tool.${toolName}`,
    { 'tool.name': toolName, 'tool.args_hash': argsHash },
    fn,
  );
}

export function withLlmCallSpan<T>(
  tracer: Tracer,
  model: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(tracer, `llm.${model}`, { 'llm.model': model }, fn);
}

export function withEvaluatorSpan<T>(
  tracer: Tracer,
  evaluatorName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(
    tracer,
    `eval.evaluator.${evaluatorName}`,
    { 'eval.evaluator': evaluatorName },
    fn,
  );
}
