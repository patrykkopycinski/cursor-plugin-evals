import type { TaskAdapter, AdapterConfig } from '../core/types.js';

export type AdapterName = 'mcp' | 'plain-llm' | 'headless-coder' | 'gemini-cli' | 'claude-sdk';

type AdapterFactory = (config: AdapterConfig) => TaskAdapter;

const adapterCache = new Map<string, AdapterFactory>();

async function getAdapterFactory(name: string): Promise<AdapterFactory> {
  const cached = adapterCache.get(name);
  if (cached) return cached;

  let factory: AdapterFactory;
  switch (name) {
    case 'mcp': {
      const mod = await import('./mcp.js');
      factory = mod.createMcpAdapter;
      break;
    }
    case 'plain-llm': {
      const mod = await import('./plain-llm.js');
      factory = mod.createPlainLlmAdapter;
      break;
    }
    case 'headless-coder': {
      const mod = await import('./headless-coder.js');
      factory = mod.createHeadlessCoderAdapter;
      break;
    }
    case 'gemini-cli': {
      const mod = await import('./gemini-cli.js');
      factory = mod.createGeminiCliAdapter;
      break;
    }
    case 'claude-sdk': {
      const mod = await import('./claude-sdk.js');
      factory = mod.createClaudeSdkAdapter;
      break;
    }
    default:
      throw new Error(
        `Unknown adapter "${name}". Available: mcp, plain-llm, headless-coder, gemini-cli, claude-sdk`,
      );
  }

  adapterCache.set(name, factory);
  return factory;
}

export function createAdapter(name: AdapterName | string, config: AdapterConfig): TaskAdapter {
  return async (example) => {
    const factory = await getAdapterFactory(name);
    const adapter = factory(config);
    return adapter(example);
  };
}

export { createMcpAdapter } from './mcp.js';
