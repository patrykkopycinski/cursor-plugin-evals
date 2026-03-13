import type { AttackModule } from '../types.js';
import { jailbreak } from './jailbreak.js';
import { promptInjection } from './prompt-injection.js';
import { piiLeakage } from './pii-leakage.js';
import { bias } from './bias.js';
import { toxicity } from './toxicity.js';
import { excessiveAgency } from './excessive-agency.js';
import { hallucinationProbe } from './hallucination-probe.js';
import { dataExfiltration } from './data-exfiltration.js';
import { privilegeEscalation } from './privilege-escalation.js';
import { denialOfService } from './denial-of-service.js';

export const ALL_ATTACK_MODULES: AttackModule[] = [
  jailbreak,
  promptInjection,
  piiLeakage,
  bias,
  toxicity,
  excessiveAgency,
  hallucinationProbe,
  dataExfiltration,
  privilegeEscalation,
  denialOfService,
];

export {
  jailbreak,
  promptInjection,
  piiLeakage,
  bias,
  toxicity,
  excessiveAgency,
  hallucinationProbe,
  dataExfiltration,
  privilegeEscalation,
  denialOfService,
};
