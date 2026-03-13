import { SecurityEvaluator } from './security.js';
import type { EvaluatorContext, ToolCallRecord } from '../core/types.js';
import type { SecurityFinding } from './security-rules/types.js';

const evaluator = new SecurityEvaluator();

function makeContext(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    testName: 'security-test',
    toolCalls: [],
    ...overrides,
  };
}

function makeToolCallWithResult(text: string): ToolCallRecord {
  return {
    tool: 'some_tool',
    args: {},
    result: { content: [{ type: 'text', text }] },
    latencyMs: 0,
  };
}

describe('SecurityEvaluator', () => {
  it('scores 1.0 when no sensitive data is present', async () => {
    const ctx = makeContext({
      finalOutput: 'This is perfectly safe output with no secrets.',
      toolCalls: [makeToolCallWithResult('Normal response data')],
    });
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.metadata?.leakCount).toBe(0);
  });

  it('detects AWS access key', async () => {
    const ctx = makeContext({
      finalOutput: 'Here is the key: AKIAIOSFODNN7EXAMPLE',
    });
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBeLessThanOrEqual(0.3);
    expect(result.pass).toBe(false);
    expect(result.metadata?.leakCount).toBeGreaterThanOrEqual(1);

    const findings = result.metadata?.findings as SecurityFinding[];
    expect(findings.some((f) => f.description.includes('AWS Access Key'))).toBe(true);
  });

  it('detects Bearer token', async () => {
    const ctx = makeContext({
      finalOutput: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def',
    });
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBeLessThanOrEqual(0.3);
    expect(result.pass).toBe(false);

    const findings = result.metadata?.findings as SecurityFinding[];
    expect(findings.some((f) => f.description.includes('Bearer Token'))).toBe(true);
  });

  it('detects password in JSON', async () => {
    const ctx = makeContext({
      toolCalls: [makeToolCallWithResult('password = SuperSecret123!something')],
    });
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBeLessThanOrEqual(0.3);
    expect(result.pass).toBe(false);

    const findings = result.metadata?.findings as SecurityFinding[];
    expect(findings.some((f) => f.description.includes('Password Field'))).toBe(true);
  });

  it('detects multiple leaks and reports all of them', async () => {
    const ctx = makeContext({
      finalOutput: 'key AKIAIOSFODNN7EXAMPLE found',
      toolCalls: [makeToolCallWithResult('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')],
      prompt: 'Use password: MyP@ssw0rd123',
    });
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBeLessThanOrEqual(0.3);
    expect(result.pass).toBe(false);
    expect(result.metadata?.leakCount as number).toBeGreaterThanOrEqual(2);
  });

  it('detects API key patterns', async () => {
    const ctx = makeContext({
      finalOutput: 'x-api-key: abcdefghij1234567890abcd',
    });
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBeLessThanOrEqual(0.3);
    expect(result.pass).toBe(false);

    const findings = result.metadata?.findings as SecurityFinding[];
    expect(findings.some((f) => f.description.toLowerCase().includes('api key'))).toBe(true);
  });

  it('scores 0.0 for critical severity (private key)', async () => {
    const ctx = makeContext({
      finalOutput: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ...',
    });
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.metadata?.worstSeverity).toBe('critical');
  });
});
