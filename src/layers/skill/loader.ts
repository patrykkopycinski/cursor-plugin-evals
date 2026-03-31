import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { parse as parseYaml } from 'yaml';
import type {
  EvaluationDataset,
  Example,
  EvalSetupConfig,
  EvalDefaultsConfig,
  EvalAdapterConfig,
  PhaseGate,
} from '../../core/types.js';

interface RawEvalYaml {
  name?: string;
  skill?: string;
  description?: string;
  tests?: Array<Record<string, unknown>>;
  examples?: Array<Record<string, unknown>>;
  adapters?: Array<string | Record<string, unknown>>;
  evaluators?: Array<string | Record<string, unknown>>;
  models?: string[];
  defaults?: Record<string, unknown>;
  setup?: Record<string, unknown>;
  serverless?: Record<string, unknown>;
  cluster_setup?: Record<string, unknown>;
  phase_gates?: Record<string, Record<string, unknown>>;
}

interface RawDefaultsYaml {
  adapters?: Array<string | Record<string, unknown>>;
  evaluators?: string[];
  models?: string[];
  defaults?: Record<string, unknown>;
  phase_gates?: Record<string, Record<string, unknown>>;
  cluster_setup?: Record<string, unknown>;
}

function loadYamlFile(path: string): unknown {
  const raw = readFileSync(path, 'utf-8');
  return parseYaml(raw);
}

function findDefaultsFile(skillDir: string): string | null {
  let dir = skillDir;
  const root = dirname(dir) === dir ? dir : '/';

  while (dir !== root) {
    for (const name of ['eval-defaults.yaml', 'eval-defaults.yml']) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function parseAdapters(
  raw: Array<string | Record<string, unknown>> | undefined,
): string[] | EvalAdapterConfig[] | undefined {
  if (!raw || raw.length === 0) return undefined;

  if (typeof raw[0] === 'string') {
    return raw as string[];
  }

  return (raw as Array<Record<string, unknown>>).map((a) => ({
    type: (a.type as string) ?? 'unknown',
    config: a.config as Record<string, unknown> | undefined,
  }));
}

function parseDefaults(raw: Record<string, unknown> | undefined): EvalDefaultsConfig | undefined {
  if (!raw) return undefined;
  return {
    maxTurns: raw.max_turns as number | undefined,
    timeout: raw.timeout as number | undefined,
    repetitions: raw.repetitions as number | undefined,
    judgeModel: (raw.judge_model ?? raw.judgeModel) as string | undefined,
    thresholds: raw.thresholds as Record<string, number | Record<string, unknown>> | undefined,
    requiredPass: (raw.required_pass ?? raw.requiredPass) as string[] | undefined,
  };
}

function parseSetup(raw: Record<string, unknown> | undefined): EvalSetupConfig | undefined {
  if (!raw) return undefined;
  return {
    notes: raw.notes as string[] | undefined,
    script: raw.script as string | undefined,
    feature_flags: raw.feature_flags as string[] | undefined,
    seed_data: raw.seed_data as boolean | undefined,
  };
}

function parsePhaseGates(
  raw: Record<string, Record<string, unknown>> | undefined,
): Record<string, PhaseGate> | undefined {
  if (!raw) return undefined;
  const gates: Record<string, PhaseGate> = {};
  for (const [name, gate] of Object.entries(raw)) {
    gates[name] = {
      first_try_pass_rate: gate.first_try_pass_rate as number | undefined,
      e2e_completion_rate: gate.e2e_completion_rate as number | undefined,
      description: (gate.description as string) ?? '',
    };
  }
  return gates;
}

function mergeDefaults(
  base: EvalDefaultsConfig | undefined,
  override: EvalDefaultsConfig | undefined,
): EvalDefaultsConfig | undefined {
  if (!base && !override) return undefined;
  if (!base) return override;
  if (!override) return base;

  return {
    maxTurns: override.maxTurns ?? base.maxTurns,
    timeout: override.timeout ?? base.timeout,
    repetitions: override.repetitions ?? base.repetitions,
    judgeModel: override.judgeModel ?? base.judgeModel,
    thresholds: override.thresholds
      ? { ...(base.thresholds ?? {}), ...override.thresholds }
      : base.thresholds,
    requiredPass: override.requiredPass ?? base.requiredPass,
  };
}

function parseExamples(
  raw: Array<Record<string, unknown>> | undefined,
  evalPath: string,
): Example[] {
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    throw new Error(`eval.yaml at ${evalPath} has no tests/examples`);
  }

  return raw.map((ex, i) => {
    const input =
      (ex.input as Record<string, unknown> | string | undefined) ??
      (ex.prompt as string | undefined);
    if (!input) {
      throw new Error(`Test ${i} in ${evalPath} is missing "input" or "prompt" field`);
    }

    const normalizedInput = typeof input === 'string' ? { prompt: input } : input;

    const expected = (ex.output ?? ex.expected ?? {}) as Record<string, unknown>;

    const metadata: Record<string, unknown> = {
      ...(ex.metadata as Record<string, unknown> | undefined),
    };
    if (ex.name) metadata.testName = ex.name;

    return {
      input: normalizedInput as Record<string, unknown>,
      output: expected,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  });
}

/**
 * Load an eval.yaml skill dataset with optional defaults merging.
 *
 * Searches upward from the skill directory for `eval-defaults.yaml` and
 * merges shared configuration (adapters, evaluators, thresholds, models,
 * phase gates) into the per-skill eval.yaml.
 */
export function loadSkillDataset(skillDir: string): EvaluationDataset {
  const evalPath = resolve(skillDir, 'eval.yaml');
  let raw: RawEvalYaml;

  try {
    raw = loadYamlFile(evalPath) as RawEvalYaml;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      throw new Error(`eval.yaml not found in ${skillDir}`);
    }
    throw new Error(`Invalid YAML in ${evalPath}: ${msg}`);
  }

  const name = raw.name ?? raw.skill;
  if (!name || typeof name !== 'string') {
    throw new Error(`eval.yaml in ${skillDir} is missing required "name" or "skill" field`);
  }

  let defaultsData: RawDefaultsYaml | undefined;
  const defaultsPath = findDefaultsFile(skillDir);
  if (defaultsPath) {
    try {
      defaultsData = loadYamlFile(defaultsPath) as RawDefaultsYaml;
    } catch {
      // defaults file exists but is invalid — proceed without it
    }
  }

  const tests = raw.tests ?? raw.examples;
  const examples = parseExamples(tests, evalPath);

  const baseDefaults = parseDefaults(defaultsData?.defaults);
  const skillDefaults = parseDefaults(raw.defaults);
  const mergedDefaults = mergeDefaults(baseDefaults, skillDefaults);

  const adapters = parseAdapters(raw.adapters) ?? parseAdapters(defaultsData?.adapters);
  const evaluators = raw.evaluators ?? defaultsData?.evaluators;
  const models = raw.models ?? defaultsData?.models;
  const phaseGates = parsePhaseGates(raw.phase_gates ?? defaultsData?.phase_gates);

  // Parse evaluator conditions from objects in evaluators list
  const evaluatorConditions = new Map<string, Record<string, unknown>>();
  if (evaluators && Array.isArray(evaluators)) {
    for (const entry of evaluators) {
      if (typeof entry === 'object' && entry !== null && 'name' in entry && 'when' in entry) {
        evaluatorConditions.set(entry.name as string, entry.when as Record<string, unknown>);
      }
    }
  }

  const dataset: EvaluationDataset = {
    name,
    description: raw.description ?? '',
    examples,
    defaults: mergedDefaults,
  };

  if (adapters) dataset.adapters = adapters;
  if (evaluators) {
    // Normalize evaluators to string names only (objects use name+when format)
    dataset.evaluators = evaluators.map((e) => (typeof e === 'string' ? e : (e.name as string)));
  }
  if (evaluatorConditions.size > 0) dataset.evaluatorConditions = evaluatorConditions;
  if (models) dataset.models = models;
  if (phaseGates) dataset.phaseGates = phaseGates;

  const setup = parseSetup(raw.setup);
  if (setup) dataset.setup = setup;

  if (raw.serverless) {
    dataset.serverless = {
      readiness: raw.serverless.readiness as string | undefined,
      limitations: raw.serverless.limitations as string[] | undefined,
    };
  }

  if (raw.cluster_setup ?? defaultsData?.cluster_setup) {
    const cs = (raw.cluster_setup ?? defaultsData?.cluster_setup) as Record<string, unknown>;
    dataset.clusterSetup = {
      seedScript: cs.seed_script as string | undefined,
      esUrl: cs.es_url as string | undefined,
      kibanaUrl: cs.kibana_url as string | undefined,
    };
  }

  return dataset;
}
