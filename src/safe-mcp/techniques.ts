export interface SafeMcpTechnique {
  id: string;
  name: string;
  tactic: SafeMcpTactic;
  description: string;
  mitreMappings?: string[];
}

export type SafeMcpTactic =
  | 'reconnaissance'
  | 'resource_development'
  | 'initial_access'
  | 'execution'
  | 'persistence'
  | 'privilege_escalation'
  | 'defense_evasion'
  | 'credential_access'
  | 'discovery'
  | 'lateral_movement'
  | 'collection'
  | 'command_and_control'
  | 'exfiltration'
  | 'impact';

export const SAFE_MCP_TECHNIQUES: SafeMcpTechnique[] = [
  { id: 'SAFE-T1001', name: 'Tool Poisoning', tactic: 'initial_access', description: 'Manipulation of MCP tool definitions to inject malicious behavior', mitreMappings: ['T1195'] },
  { id: 'SAFE-T1002', name: 'Tool Description Injection', tactic: 'initial_access', description: 'Hidden instructions embedded in tool descriptions', mitreMappings: ['T1059'] },
  { id: 'SAFE-T1003', name: 'Schema Manipulation', tactic: 'initial_access', description: 'Altering tool schemas to accept unexpected inputs' },
  { id: 'SAFE-T1101', name: 'Prompt Injection via Tools', tactic: 'execution', description: 'Injecting malicious prompts through tool responses', mitreMappings: ['T1059'] },
  { id: 'SAFE-T1102', name: 'Prompt Injection', tactic: 'execution', description: 'Bypassing safety controls through malicious prompts' },
  { id: 'SAFE-T1103', name: 'Unauthorized Tool Invocation', tactic: 'execution', description: 'Calling tools without proper authorization' },
  { id: 'SAFE-T1201', name: 'MCP Rug Pull', tactic: 'impact', description: 'Sudden change in tool behavior after trust is established' },
  { id: 'SAFE-T1202', name: 'Resource Exhaustion', tactic: 'impact', description: 'Overwhelming MCP servers with excessive requests', mitreMappings: ['T1499'] },
  { id: 'SAFE-T1203', name: 'Denial of Service', tactic: 'impact', description: 'Preventing legitimate use of MCP services' },
  { id: 'SAFE-T1301', name: 'Token Theft', tactic: 'credential_access', description: 'Stealing authentication tokens used by MCP clients', mitreMappings: ['T1528'] },
  { id: 'SAFE-T1302', name: 'Credential Exposure', tactic: 'credential_access', description: 'Leaking credentials through tool responses or logs', mitreMappings: ['T1552'] },
  { id: 'SAFE-T1303', name: 'Token Mismanagement', tactic: 'credential_access', description: 'Improper handling of authentication tokens' },
  { id: 'SAFE-T1401', name: 'Data Exfiltration via Tools', tactic: 'exfiltration', description: 'Using tool capabilities to extract sensitive data', mitreMappings: ['T1041'] },
  { id: 'SAFE-T1402', name: 'Cross-Tool Data Leakage', tactic: 'exfiltration', description: 'Data leaking between tools in multi-server environments' },
  { id: 'SAFE-T1501', name: 'Privilege Escalation', tactic: 'privilege_escalation', description: 'Gaining elevated access through MCP tool abuse', mitreMappings: ['T1068'] },
  { id: 'SAFE-T1502', name: 'Excessive Agency', tactic: 'privilege_escalation', description: 'AI agent performing actions beyond intended scope' },
  { id: 'SAFE-T1601', name: 'Context Oversharing', tactic: 'collection', description: 'MCP server exposing unnecessary context to clients' },
  { id: 'SAFE-T1602', name: 'System Information Discovery', tactic: 'discovery', description: 'Probing MCP infrastructure for system details', mitreMappings: ['T1082'] },
  { id: 'SAFE-T1701', name: 'Command Injection', tactic: 'execution', description: 'Injecting OS commands through tool parameters', mitreMappings: ['T1059'] },
  { id: 'SAFE-T1702', name: 'SSRF via Tools', tactic: 'initial_access', description: 'Using tools to make requests to internal resources', mitreMappings: ['T1090'] },
  { id: 'SAFE-T1703', name: 'Path Traversal', tactic: 'collection', description: 'Accessing unauthorized files via path manipulation' },
  { id: 'SAFE-T1801', name: 'Supply Chain Compromise', tactic: 'resource_development', description: 'Compromising MCP server dependencies', mitreMappings: ['T1195'] },
  { id: 'SAFE-T1802', name: 'Shadow Server', tactic: 'persistence', description: 'Running unauthorized MCP servers that mimic legitimate ones' },
  { id: 'SAFE-T1803', name: 'Insecure Deserialization', tactic: 'execution', description: 'Exploiting deserialization flaws in MCP message handling' },
  { id: 'SAFE-T1901', name: 'Unsafe Redirect', tactic: 'defense_evasion', description: 'Redirecting MCP clients to malicious endpoints' },
  { id: 'SAFE-T1902', name: 'Missing Audit Trail', tactic: 'defense_evasion', description: 'Lack of logging for security-relevant MCP operations' },
];
