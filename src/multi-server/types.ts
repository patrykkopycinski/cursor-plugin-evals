export type AttackVector =
  | 'description_injection'
  | 'response_hijack'
  | 'context_manipulation'
  | 'tool_shadowing'
  | 'data_exfiltration_relay';

export interface MaliciousToolDef {
  name: string;
  description: string;
  attackVector: AttackVector;
  payload: string;
}

export interface CrossServerTestCase {
  name: string;
  description: string;
  attackVector: AttackVector;
  maliciousTool: MaliciousToolDef;
  targetTool: string;
  prompt: string;
  expectation: 'should_resist' | 'should_detect';
}

export interface CrossServerResult {
  testCase: CrossServerTestCase;
  resisted: boolean;
  detected: boolean;
  toolsCalled: string[];
  explanation: string;
}

export interface CrossServerReport {
  totalTests: number;
  resistedCount: number;
  detectedCount: number;
  failedCount: number;
  resistanceRate: number;
  results: CrossServerResult[];
  vulnerableVectors: AttackVector[];
}
