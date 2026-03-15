import { existsSync, copyFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { log } from './logger.js';

export interface SetupOptions {
  dir: string;
  interactive: boolean;
  skipDocker?: boolean;
  verbose?: boolean;
}

interface StepResult {
  label: string;
  ok: boolean;
  detail: string;
  action?: string;
}

async function checkNodeVersion(): Promise<StepResult> {
  const major = parseInt(process.version.slice(1), 10);
  return {
    label: 'Node.js',
    ok: major >= 20,
    detail: major >= 20 ? process.version : `${process.version} — requires >= 20`,
  };
}

async function checkPluginDir(dir: string): Promise<StepResult> {
  const pkgPath = resolve(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return {
      label: 'Plugin directory',
      ok: false,
      detail: `No package.json in ${dir}`,
    };
  }

  return {
    label: 'Plugin directory',
    ok: true,
    detail: dir,
  };
}

async function checkDependencies(): Promise<StepResult> {
  const hasNodeModules = existsSync(resolve(process.cwd(), 'node_modules'));
  if (hasNodeModules) {
    return { label: 'Dependencies', ok: true, detail: 'node_modules present' };
  }

  return {
    label: 'Dependencies',
    ok: false,
    detail: 'node_modules missing',
    action: 'npm install',
  };
}

async function checkDocker(): Promise<StepResult> {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10_000 });
    return { label: 'Docker', ok: true, detail: 'Running' };
  } catch (err) {
    console.warn('Docker check failed:', (err as Error).message ?? err);
    return {
      label: 'Docker',
      ok: false,
      detail: 'Not running or not installed',
      action: 'Start Docker Desktop or install Docker',
    };
  }
}

async function checkDockerServices(): Promise<StepResult> {
  try {
    const output = execSync('docker compose -f docker/docker-compose.yml ps --format json', {
      stdio: 'pipe',
      timeout: 10_000,
    }).toString();

    if (!output.trim()) {
      return {
        label: 'Docker services',
        ok: false,
        detail: 'Not running',
        action: 'docker compose -f docker/docker-compose.yml up -d',
      };
    }

    const lines = output.trim().split('\n').filter(Boolean);
    const running = lines.filter((l) => {
      try {
        const svc = JSON.parse(l) as { State: string };
        return svc.State === 'running';
      } catch (err) {
        console.warn('Failed to parse docker service JSON:', (err as Error).message ?? err);
        return l.includes('running');
      }
    });

    if (running.length === 0) {
      return {
        label: 'Docker services',
        ok: false,
        detail: 'Services not healthy',
        action: 'docker compose -f docker/docker-compose.yml up -d',
      };
    }

    return {
      label: 'Docker services',
      ok: true,
      detail: `${running.length} service(s) running`,
    };
  } catch (err) {
    console.warn('Docker services check failed:', (err as Error).message ?? err);
    return {
      label: 'Docker services',
      ok: false,
      detail: 'Not started',
      action: 'docker compose -f docker/docker-compose.yml up -d',
    };
  }
}

function checkEnvVar(name: string, label: string): StepResult {
  const present = !!process.env[name];
  return {
    label,
    ok: present,
    detail: present ? 'Set' : `${name} not set`,
  };
}

async function checkConfig(): Promise<StepResult> {
  const configPath = resolve(process.cwd(), 'plugin-eval.yaml');
  if (existsSync(configPath)) {
    return { label: 'Config file', ok: true, detail: 'plugin-eval.yaml found' };
  }

  return {
    label: 'Config file',
    ok: false,
    detail: 'plugin-eval.yaml not found',
    action: 'npx cursor-plugin-evals init',
  };
}

async function checkEnvFile(): Promise<StepResult> {
  const envPath = resolve(process.cwd(), '.env');
  const examplePath = resolve(process.cwd(), '.env.example');

  if (existsSync(envPath)) {
    return { label: '.env file', ok: true, detail: '.env exists' };
  }

  if (existsSync(examplePath)) {
    return {
      label: '.env file',
      ok: false,
      detail: '.env missing (example available)',
      action: 'cp .env.example .env',
    };
  }

  return {
    label: '.env file',
    ok: false,
    detail: '.env missing',
  };
}

function tryAutoFix(step: StepResult): boolean {
  if (!step.action) return false;

  switch (step.action) {
    case 'npm install': {
      log.info(`  Running: ${step.action}`);
      try {
        execSync('npm install', { stdio: 'pipe', timeout: 120_000 });
        return true;
      } catch (err) {
        console.warn('Auto-fix npm install failed:', (err as Error).message ?? err);
        return false;
      }
    }
    case 'cp .env.example .env': {
      log.info(`  Copying .env.example to .env`);
      try {
        copyFileSync(resolve(process.cwd(), '.env.example'), resolve(process.cwd(), '.env'));
        return true;
      } catch (err) {
        console.warn('Auto-fix copy .env failed:', (err as Error).message ?? err);
        return false;
      }
    }
    default:
      return false;
  }
}

export async function setupCommand(opts: SetupOptions): Promise<void> {
  log.header('Setup — Quick Start Wizard');
  console.log();

  const pluginDir = resolve(process.cwd(), opts.dir);
  const steps: StepResult[] = [];

  // Phase 1: Prerequisites
  log.info('Checking prerequisites...');
  console.log();

  steps.push(await checkNodeVersion());
  steps.push(await checkPluginDir(pluginDir));
  steps.push(await checkDependencies());
  steps.push(await checkEnvFile());
  steps.push(await checkConfig());

  if (!opts.skipDocker) {
    steps.push(await checkDocker());
    const dockerOk = steps[steps.length - 1].ok;
    if (dockerOk && existsSync(resolve(process.cwd(), 'docker/docker-compose.yml'))) {
      steps.push(await checkDockerServices());
    }
  }

  steps.push(checkEnvVar('OPENAI_API_KEY', 'OpenAI API Key (or set AZURE_OPENAI_API_KEY)'));
  steps.push(checkEnvVar('PLUGIN_DIR', 'PLUGIN_DIR'));

  // Display results
  for (const step of steps) {
    if (step.ok) {
      log.success(`${step.label}: ${step.detail}`);
    } else {
      log.warn(`${step.label}: ${step.detail}`);
    }
  }

  console.log();

  // Phase 2: Auto-fix what we can
  const failures = steps.filter((s) => !s.ok);

  if (failures.length === 0) {
    log.success('All checks passed — you are ready to run evals!');
    console.log();
    printNextSteps();
    return;
  }

  const fixable = failures.filter((s) => s.action);

  if (opts.interactive && fixable.length > 0) {
    console.log();
    log.info(`Found ${failures.length} issue(s). Attempting auto-fix...`);
    console.log();

    for (const step of fixable) {
      if (canAutoFix(step.action!)) {
        const fixed = tryAutoFix(step);
        if (fixed) {
          log.success(`Fixed: ${step.label}`);
          step.ok = true;
        } else {
          log.warn(`Could not auto-fix: ${step.label}`);
        }
      }
    }
  }

  // Phase 3: Manual steps
  const remaining = steps.filter((s) => !s.ok);

  if (remaining.length > 0) {
    console.log();
    log.header('Manual Steps Required');
    console.log();

    for (let i = 0; i < remaining.length; i++) {
      const step = remaining[i];
      log.info(`${i + 1}. ${step.label}: ${step.detail}`);
      if (step.action) {
        log.info(`   Run: ${step.action}`);
      }
    }

    console.log();
    log.info('After fixing these, run the setup again:');
    log.info('  npx cursor-plugin-evals setup');
  } else {
    console.log();
    log.success('All issues resolved — you are ready to run evals!');
    console.log();
    printNextSteps();
  }
}

function canAutoFix(action: string): boolean {
  return action === 'npm install' || action === 'cp .env.example .env';
}

function printNextSteps(): void {
  log.header('Next Steps');
  console.log();
  log.info('  1. Run static analysis (no infra needed):');
  log.info('     npx cursor-plugin-evals run --layer static');
  console.log();
  log.info('  2. Run unit tests (spawns MCP server):');
  log.info('     npx cursor-plugin-evals run --layer unit');
  console.log();
  log.info('  3. Run integration tests (needs Docker):');
  log.info('     npx cursor-plugin-evals run --layer integration');
  console.log();
  log.info('  4. Run LLM evals (needs OPENAI_API_KEY or AZURE_OPENAI_API_KEY):');
  log.info('     npx cursor-plugin-evals run --layer llm');
  console.log();
  log.info('  5. Run skill evaluation:');
  log.info('     npx cursor-plugin-evals skill-eval --skill-dir ./skills/my-skill');
  console.log();
  log.info('  6. Full quality score:');
  log.info('     npx cursor-plugin-evals score');
  console.log();
  log.info('  7. Compare models:');
  log.info('     npx cursor-plugin-evals compare --model gpt-5.2 --model claude-opus-4-6');
}
