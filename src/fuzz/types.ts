export interface FuzzInput {
  description: string;
  args: Record<string, unknown>;
  category: 'boundary' | 'type_coercion' | 'null_injection' | 'overflow' | 'empty' | 'unicode' | 'nested' | 'combinatorial';
}

export interface FuzzResult {
  input: FuzzInput;
  accepted: boolean;
  isError: boolean;
  errorMessage?: string;
  crashed: boolean;
  latencyMs: number;
}

export interface FuzzReport {
  toolName: string;
  totalInputs: number;
  accepted: number;
  rejected: number;
  crashed: number;
  results: FuzzResult[];
  crashRate: number;
  categories: Record<string, { total: number; crashed: number }>;
}
