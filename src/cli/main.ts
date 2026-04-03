#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { SERVICE_NAME } from '../core/constants.js';
import { log } from './logger.js';
import { registerRunCommands } from './commands/run.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerInfraCommands } from './commands/infrastructure.js';
import { registerAnalysisCommands } from './commands/analysis.js';
import { registerSkillEvalCommands } from './commands/skill-eval.js';
import { registerGenerationCommands } from './commands/generation.js';
import { registerDashboardCommands } from './commands/dashboard.js';
import { registerSecurityCommands } from './commands/security.js';
import { registerRegressionCommands } from './commands/regression.js';
import { registerAdvancedCommands } from './commands/advanced.js';
import { registerMonitorCommand } from './monitor.js';
import { registerEvaluatorInitCommand } from './evaluator-init.js';

const EXIT_CONFIG_ERROR = 2;

const program = new Command()
  .name(SERVICE_NAME)
  .description(
    'End-to-end testing framework for Cursor plugins — static analysis, MCP tool testing, and LLM evaluation',
  )
  .version('0.0.1');

registerRunCommands(program);
registerDoctorCommand(program);
registerInfraCommands(program);
registerAnalysisCommands(program);
registerSkillEvalCommands(program);
registerGenerationCommands(program);
registerDashboardCommands(program);
registerSecurityCommands(program);
registerRegressionCommands(program);
registerAdvancedCommands(program);

// Enhanced live-scoring monitor (replaces basic anomaly-only monitor)
registerMonitorCommand(program);

// Custom evaluator scaffolding
registerEvaluatorInitCommand(program);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    log.error('Fatal error', err);
    process.exitCode = EXIT_CONFIG_ERROR;
  }
}

main();
