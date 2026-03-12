export type { Severity, SecurityFinding, SecurityRule, RuleContext } from './types.js';
export { SsrfRule } from './ssrf.js';
export { PathTraversalRule } from './path-traversal.js';
export { ExcessiveAgencyRule } from './excessive-agency.js';
export { CredentialExposureRule } from './credential-exposure.js';

import type { SecurityRule } from './types.js';
import { SsrfRule } from './ssrf.js';
import { PathTraversalRule } from './path-traversal.js';
import { ExcessiveAgencyRule } from './excessive-agency.js';
import { CredentialExposureRule } from './credential-exposure.js';

export function createAllRules(): SecurityRule[] {
  return [
    new CredentialExposureRule(),
    new SsrfRule(),
    new PathTraversalRule(),
    new ExcessiveAgencyRule(),
  ];
}
