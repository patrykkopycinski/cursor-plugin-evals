import type { FaultRule } from './types.js';

export async function applyFault(
  rule: FaultRule,
  toolName: string,
  execute: () => Promise<unknown>,
): Promise<{ result: unknown; survived: boolean; error?: string }> {
  switch (rule.kind) {
    case 'timeout': {
      const delay = rule.delayMs ?? 30_000;
      const result = await Promise.race([
        execute().then((r) => ({ r, timedOut: false })),
        new Promise<{ r: null; timedOut: true }>((resolve) =>
          setTimeout(() => resolve({ r: null, timedOut: true }), delay),
        ),
      ]);
      if (result.timedOut) {
        return { result: null, survived: false, error: `Chaos: timeout after ${delay}ms on ${toolName}` };
      }
      return { result: result.r, survived: true };
    }

    case 'drop':
      return { result: null, survived: false, error: `Chaos: dropped request to ${toolName}` };

    case 'corrupt': {
      const res = await execute();
      const text = JSON.stringify(res);
      const bytes = rule.corruptBytes ?? 10;
      const corrupted = corruptString(text, bytes);
      try {
        const parsed = JSON.parse(corrupted);
        return { result: parsed, survived: true };
      } catch (_e) {
        return { result: corrupted, survived: false, error: `Chaos: corrupted response from ${toolName}` };
      }
    }

    case 'error_response':
      return {
        result: { jsonrpc: '2.0', error: { code: -32603, message: 'Chaos: internal error injected' } },
        survived: false,
        error: `Chaos: error_response injected for ${toolName}`,
      };

    case 'disconnect':
      return { result: null, survived: false, error: `Chaos: connection disconnected during ${toolName}` };

    case 'slow_drain': {
      const delay = rule.delayMs ?? 5000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      const res = await execute();
      return { result: res, survived: true };
    }

    case 'reorder': {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200));
      const res = await execute();
      return { result: res, survived: true };
    }

    case 'duplicate': {
      const res = await execute();
      return { result: res, survived: true };
    }

    default:
      return { result: await execute(), survived: true };
  }
}

function corruptString(s: string, bytes: number): string {
  const arr = s.split('');
  for (let i = 0; i < Math.min(bytes, arr.length); i++) {
    const idx = Math.floor(Math.random() * arr.length);
    arr[idx] = String.fromCharCode(arr[idx].charCodeAt(0) ^ 0xff);
  }
  return arr.join('');
}
