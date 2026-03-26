export type { Severity, SecurityFinding, SecurityRule, RuleContext } from './types.js';
export { SsrfRule } from './ssrf.js';
export { PathTraversalRule } from './path-traversal.js';
export { ExcessiveAgencyRule } from './excessive-agency.js';
export { CredentialExposureRule } from './credential-exposure.js';
export { TokenMismanagementRule } from './token-mismanagement.js';
export { PrivilegeEscalationRule } from './privilege-escalation.js';
export { SupplyChainRule } from './supply-chain.js';
export { CommandInjectionRule } from './command-injection.js';
export { PromptInjectionRule } from './prompt-injection.js';
export { InsufficientAuthRule } from './insufficient-auth.js';
export { MissingAuditRule } from './missing-audit.js';
export { ShadowServerRule } from './shadow-server.js';
export { ContextOversharingRule } from './context-oversharing.js';
export { DataExfiltrationRule } from './data-exfiltration.js';
export { DenialOfServiceRule } from './denial-of-service.js';
export { SensitiveDataExposureRule } from './sensitive-data-exposure.js';
export { InsecureDeserializationRule } from './insecure-deserialization.js';
export { ResourceExhaustionRule } from './resource-exhaustion.js';
export { CrossToolContaminationRule } from './cross-tool-contamination.js';
export { UnsafeRedirectRule } from './unsafe-redirect.js';
export { UnicodeObfuscationRule } from './unicode-obfuscation.js';
export { YamlAnomalyRule } from './yaml-anomaly.js';

import type { SecurityRule } from './types.js';
import { SsrfRule } from './ssrf.js';
import { PathTraversalRule } from './path-traversal.js';
import { ExcessiveAgencyRule } from './excessive-agency.js';
import { CredentialExposureRule } from './credential-exposure.js';
import { TokenMismanagementRule } from './token-mismanagement.js';
import { PrivilegeEscalationRule } from './privilege-escalation.js';
import { SupplyChainRule } from './supply-chain.js';
import { CommandInjectionRule } from './command-injection.js';
import { PromptInjectionRule } from './prompt-injection.js';
import { InsufficientAuthRule } from './insufficient-auth.js';
import { MissingAuditRule } from './missing-audit.js';
import { ShadowServerRule } from './shadow-server.js';
import { ContextOversharingRule } from './context-oversharing.js';
import { DataExfiltrationRule } from './data-exfiltration.js';
import { DenialOfServiceRule } from './denial-of-service.js';
import { SensitiveDataExposureRule } from './sensitive-data-exposure.js';
import { InsecureDeserializationRule } from './insecure-deserialization.js';
import { ResourceExhaustionRule } from './resource-exhaustion.js';
import { CrossToolContaminationRule } from './cross-tool-contamination.js';
import { UnsafeRedirectRule } from './unsafe-redirect.js';
import { UnicodeObfuscationRule } from './unicode-obfuscation.js';
import { YamlAnomalyRule } from './yaml-anomaly.js';

export function createAllRules(): SecurityRule[] {
  return [
    new CredentialExposureRule(),
    new SsrfRule(),
    new PathTraversalRule(),
    new ExcessiveAgencyRule(),
    new TokenMismanagementRule(),
    new PrivilegeEscalationRule(),
    new SupplyChainRule(),
    new CommandInjectionRule(),
    new PromptInjectionRule(),
    new InsufficientAuthRule(),
    new MissingAuditRule(),
    new ShadowServerRule(),
    new ContextOversharingRule(),
    new DataExfiltrationRule(),
    new DenialOfServiceRule(),
    new SensitiveDataExposureRule(),
    new InsecureDeserializationRule(),
    new ResourceExhaustionRule(),
    new CrossToolContaminationRule(),
    new UnsafeRedirectRule(),
    new UnicodeObfuscationRule(),
    new YamlAnomalyRule(),
  ];
}
