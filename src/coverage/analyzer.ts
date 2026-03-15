import { readFileSync } from 'fs';
import { resolve, isAbsolute, basename } from 'path';
import { parse as parseYaml } from 'yaml';
import { discoverPlugin } from '../plugin/discovery.js';
import type {
  PluginManifest,
  EvalConfig,
  SuiteConfig,
  UnitTestConfig,
  IntegrationTestConfig,
  LlmTestConfig,
  PerformanceTestConfig,
  StaticTestConfig,
} from '../core/types.js';

export interface ComponentCoverage {
  name: string;
  type: 'tool' | 'skill' | 'rule' | 'agent' | 'command';
  layers: {
    unit: boolean;
    integration: boolean;
    llm: boolean;
    performance: boolean;
    security: boolean;
    static: boolean;
  };
  evaluators: string[];
  testCount: number;
  gaps: string[];
}

export interface CoverageReport {
  timestamp: string;
  pluginName: string;
  totalComponents: number;
  coveredComponents: number;
  /** Component-level: % of components with at least one test */
  coveragePercent: number;
  /** Depth: % of applicable test slots filled (tools × 6 layers, skills × 2, etc.) */
  depthPercent: number;
  /** Raw slot counts for depth calculation */
  slotsFilled: number;
  slotsTotal: number;
  byType: {
    tools: { total: number; covered: number; percent: number };
    skills: { total: number; covered: number; percent: number };
    rules: { total: number; covered: number; percent: number };
    agents: { total: number; covered: number; percent: number };
    commands: { total: number; covered: number; percent: number };
  };
  components: ComponentCoverage[];
  gaps: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    component?: string;
  }>;
  layerCoverage: Record<string, { tested: number; total: number; percent: number }>;
}

const SECURITY_EVALUATORS = [
  'safety',
  'prompt-injection',
  'tool-poisoning',
  'privilege-escalation',
  'skill-confusion',
  'rule-bypass',
  'data-exfiltration',
];

const LAYER_NAMES = ['unit', 'integration', 'llm', 'performance', 'security', 'static'] as const;

function loadConfigLoose(configPath: string): EvalConfig {
  const absPath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  const raw = readFileSync(absPath, 'utf-8');
  const parsed = parseYaml(raw) as Record<string, unknown>;

  const plugin = (parsed.plugin ?? {}) as Record<string, unknown>;
  const suites = (parsed.suites ?? []) as Array<Record<string, unknown>>;

  const camelSuites: SuiteConfig[] = suites
    .filter((s) => typeof s === 'object' && s !== null && 'name' in s && 'layer' in s)
    .map((s) => snakeToCamelSuite(s));

  return {
    plugin: {
      name: String(plugin.name ?? ''),
      dir: String(plugin.dir ?? '.'),
      entry: plugin.entry != null ? String(plugin.entry) : undefined,
      pluginRoot: plugin.plugin_root != null ? String(plugin.plugin_root) : undefined,
      buildCommand: plugin.build_command != null ? String(plugin.build_command) : undefined,
      env: (plugin.env ?? undefined) as Record<string, string> | undefined,
    },
    suites: camelSuites,
  };
}

function snakeToCamelSuite(raw: Record<string, unknown>): SuiteConfig {
  const tests = ((raw.tests as unknown[]) ?? []).map((t) => {
    if (typeof t !== 'object' || t === null) return t;
    const obj = t as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camel] = v;
    }
    return result;
  });

  return {
    name: String(raw.name ?? ''),
    layer: String(raw.layer ?? 'unit') as SuiteConfig['layer'],
    tests: tests as SuiteConfig['tests'],
    requireEnv: raw.require_env as string[] | undefined,
  };
}

function getToolsFromUnit(test: UnitTestConfig): string[] {
  const tools: string[] = [];
  if (test.expectedTools) tools.push(...test.expectedTools);
  if (test.tool) tools.push(test.tool);
  return tools;
}

function getToolFromIntegration(test: IntegrationTestConfig): string {
  return test.tool;
}

function getToolsFromLlm(test: LlmTestConfig): string[] {
  return test.expected?.tools ?? [];
}

function getToolFromPerformance(test: PerformanceTestConfig): string {
  return test.tool;
}

function isSecurityEvaluator(evaluator: string): boolean {
  return SECURITY_EVALUATORS.some(
    (sec) => evaluator.toLowerCase().includes(sec) || evaluator.toLowerCase().includes('security'),
  );
}

interface ToolTestTracker {
  unit: boolean;
  integration: boolean;
  llm: boolean;
  performance: boolean;
  security: boolean;
  static: boolean;
  evaluators: Set<string>;
  testCount: number;
}

function createTracker(): ToolTestTracker {
  return {
    unit: false,
    integration: false,
    llm: false,
    performance: false,
    security: false,
    static: false,
    evaluators: new Set(),
    testCount: 0,
  };
}

function computeToolCoverage(
  toolNames: string[],
  suites: SuiteConfig[],
): Map<string, ToolTestTracker> {
  const map = new Map<string, ToolTestTracker>();
  for (const name of toolNames) map.set(name, createTracker());

  for (const suite of suites) {
    for (const test of suite.tests) {

      if (suite.layer === 'unit') {
        const ut = test as UnitTestConfig;
        for (const tool of getToolsFromUnit(ut)) {
          const tracker = map.get(tool);
          if (tracker) {
            tracker.unit = true;
            tracker.testCount++;
          }
        }
      }

      if (suite.layer === 'integration') {
        const it = test as IntegrationTestConfig;
        const tool = getToolFromIntegration(it);
        const tracker = map.get(tool);
        if (tracker) {
          tracker.integration = true;
          tracker.testCount++;
        }
        if (it.workflow) {
          for (const step of it.workflow) {
            const st = map.get(step.tool);
            if (st) {
              st.integration = true;
              st.testCount++;
            }
          }
        }
      }

      if (suite.layer === 'llm') {
        const lt = test as LlmTestConfig;
        const tools = getToolsFromLlm(lt);
        const evaluators = lt.evaluators ?? [];
        const hasSecurity = evaluators.some(isSecurityEvaluator);
        for (const tool of tools) {
          const tracker = map.get(tool);
          if (tracker) {
            tracker.llm = true;
            tracker.testCount++;
            for (const ev of evaluators) tracker.evaluators.add(ev);
            if (hasSecurity) tracker.security = true;
          }
        }
      }

      if (suite.layer === 'performance') {
        const pt = test as PerformanceTestConfig;
        const tool = getToolFromPerformance(pt);
        const tracker = map.get(tool);
        if (tracker) {
          tracker.performance = true;
          tracker.testCount++;
        }
      }

      if (suite.layer === 'static') {
        const st = test as StaticTestConfig;
        if (st.check === 'mcp_config' || st.check === 'naming_conventions') {
          for (const tracker of map.values()) {
            tracker.static = true;
            tracker.testCount++;
          }
        }
        if (
          st.check === 'component_references' ||
          st.check === 'cross_component_coherence'
        ) {
          for (const tracker of map.values()) {
            tracker.static = true;
          }
        }
      }
    }
  }

  return map;
}

interface ComponentTestTracker {
  static: boolean;
  llm: boolean;
  activationTest: boolean;
  negativeTest: boolean;
  behaviorTest: boolean;
  executionTest: boolean;
  testCount: number;
  evaluators: Set<string>;
}

function createComponentTracker(): ComponentTestTracker {
  return {
    static: false,
    llm: false,
    activationTest: false,
    negativeTest: false,
    behaviorTest: false,
    executionTest: false,
    testCount: 0,
    evaluators: new Set(),
  };
}

function computeComponentCoverage(
  componentType: 'skill' | 'rule' | 'agent' | 'command',
  names: string[],
  suites: SuiteConfig[],
): Map<string, ComponentTestTracker> {
  const map = new Map<string, ComponentTestTracker>();
  for (const name of names) map.set(name, createComponentTracker());

  const frontmatterCheck =
    componentType === 'skill'
      ? 'skill_frontmatter'
      : componentType === 'rule'
        ? 'rule_frontmatter'
        : componentType === 'agent'
          ? 'agent_frontmatter'
          : 'command_frontmatter';

  const contentCheck =
    componentType === 'skill' ? 'skill_content_quality' : null;

  for (const suite of suites) {
    if (suite.layer === 'static') {
      for (const test of suite.tests) {
        const st = test as StaticTestConfig;
        if (st.check === frontmatterCheck || st.check === contentCheck) {
          if (st.components && st.components.length > 0) {
            for (const comp of st.components) {
              const tracker = map.get(comp);
              if (tracker) {
                tracker.static = true;
                tracker.testCount++;
              }
            }
          } else {
            for (const tracker of map.values()) {
              tracker.static = true;
              tracker.testCount++;
            }
          }
        }
      }
    }

    if (suite.layer === 'llm') {
      for (const test of suite.tests) {
        const lt = test as LlmTestConfig;
        const testName = lt.name.toLowerCase();
        const prompt = lt.prompt.toLowerCase();

        for (const [compName, tracker] of map.entries()) {
          const nameLower = compName.toLowerCase();
          if (testName.includes(nameLower) || prompt.includes(nameLower)) {
            tracker.llm = true;
            tracker.testCount++;
            for (const ev of lt.evaluators ?? []) tracker.evaluators.add(ev);

            if (
              testName.includes('activation') ||
              testName.includes('trigger') ||
              testName.includes('positive')
            ) {
              tracker.activationTest = true;
            }
            if (
              testName.includes('negative') ||
              testName.includes('should not') ||
              testName.includes('off-topic')
            ) {
              tracker.negativeTest = true;
            }
            if (testName.includes('behavior') || testName.includes('behaviour')) {
              tracker.behaviorTest = true;
            }
            if (testName.includes('execut') || testName.includes('invoke')) {
              tracker.executionTest = true;
            }
          }
        }
      }
    }
  }

  return map;
}

function buildToolGaps(name: string, tracker: ToolTestTracker): string[] {
  const gaps: string[] = [];
  if (!tracker.unit) gaps.push(`Missing unit test for tool "${name}"`);
  if (!tracker.integration) gaps.push(`Missing integration test for tool "${name}"`);
  if (!tracker.llm) gaps.push(`Missing LLM test for tool "${name}"`);
  if (!tracker.performance) gaps.push(`Missing performance test for tool "${name}"`);
  if (!tracker.security) gaps.push(`Missing security test for tool "${name}"`);
  return gaps;
}

function buildSkillGaps(name: string, tracker: ComponentTestTracker): string[] {
  const gaps: string[] = [];
  if (!tracker.static) gaps.push(`Missing frontmatter test for skill "${name}"`);
  if (!tracker.activationTest) gaps.push(`Missing activation test for skill "${name}"`);
  if (!tracker.negativeTest) gaps.push(`Missing negative activation test for skill "${name}"`);
  return gaps;
}

function buildRuleGaps(name: string, tracker: ComponentTestTracker): string[] {
  const gaps: string[] = [];
  if (!tracker.static) gaps.push(`Missing frontmatter test for rule "${name}"`);
  return gaps;
}

function buildAgentGaps(name: string, tracker: ComponentTestTracker): string[] {
  const gaps: string[] = [];
  if (!tracker.static) gaps.push(`Missing frontmatter test for agent "${name}"`);
  if (!tracker.behaviorTest) gaps.push(`Missing behavior test for agent "${name}"`);
  return gaps;
}

function buildCommandGaps(name: string, tracker: ComponentTestTracker): string[] {
  const gaps: string[] = [];
  if (!tracker.static) gaps.push(`Missing frontmatter test for command "${name}"`);
  if (!tracker.executionTest) gaps.push(`Missing execution test for command "${name}"`);
  return gaps;
}

function isComponentCovered(type: string, tracker: ToolTestTracker | ComponentTestTracker): boolean {
  if ('unit' in tracker) {
    return tracker.unit || tracker.integration || tracker.llm || tracker.performance;
  }
  return (tracker as ComponentTestTracker).static || (tracker as ComponentTestTracker).llm;
}

function gapSeverity(
  type: string,
  gapMsg: string,
): 'critical' | 'high' | 'medium' | 'low' {
  if (gapMsg.includes('security')) return 'critical';
  if (type === 'tool' && gapMsg.includes('integration')) return 'high';
  if (type === 'tool' && gapMsg.includes('LLM')) return 'high';
  if (type === 'tool' && gapMsg.includes('unit')) return 'medium';
  if (gapMsg.includes('frontmatter')) return 'medium';
  if (gapMsg.includes('activation')) return 'medium';
  if (gapMsg.includes('behavior')) return 'medium';
  if (gapMsg.includes('execution')) return 'medium';
  return 'low';
}

export function analyzeCoverage(pluginDir: string, configPath: string): CoverageReport {
  const absPluginDir = isAbsolute(pluginDir) ? pluginDir : resolve(process.cwd(), pluginDir);
  const config = loadConfigLoose(configPath);
  const pluginRoot = config.plugin.pluginRoot;

  let manifest: PluginManifest;
  try {
    manifest = discoverPlugin(absPluginDir, pluginRoot);
  } catch {
    manifest = {
      name: config.plugin.name || basename(absPluginDir),
      dir: absPluginDir,
      skills: [],
      rules: [],
      agents: [],
      commands: [],
      hooks: [],
      mcpServers: [],
    };
  }

  const toolNames = collectToolNames(config.suites, manifest);
  const skillNames = manifest.skills.map((s) => s.name || basename(s.path));
  const ruleNames = manifest.rules.map((r) => basename(r.path, '.mdc') || basename(r.path));
  const agentNames = manifest.agents.map((a) => a.name || basename(a.path));
  const commandNames = manifest.commands.map((c) => c.name || basename(c.path));

  const toolTracker = computeToolCoverage(toolNames, config.suites);
  const skillTracker = computeComponentCoverage('skill', skillNames, config.suites);
  const ruleTracker = computeComponentCoverage('rule', ruleNames, config.suites);
  const agentTracker = computeComponentCoverage('agent', agentNames, config.suites);
  const commandTracker = computeComponentCoverage('command', commandNames, config.suites);

  const components: ComponentCoverage[] = [];
  const allGaps: CoverageReport['gaps'] = [];

  for (const [name, tracker] of toolTracker) {
    const gaps = buildToolGaps(name, tracker);
    components.push({
      name,
      type: 'tool',
      layers: {
        unit: tracker.unit,
        integration: tracker.integration,
        llm: tracker.llm,
        performance: tracker.performance,
        security: tracker.security,
        static: tracker.static,
      },
      evaluators: [...tracker.evaluators],
      testCount: tracker.testCount,
      gaps,
    });
    for (const g of gaps) {
      allGaps.push({ severity: gapSeverity('tool', g), message: g, component: name });
    }
  }

  for (const [name, tracker] of skillTracker) {
    const gaps = buildSkillGaps(name, tracker);
    components.push({
      name,
      type: 'skill',
      layers: {
        unit: false,
        integration: false,
        llm: tracker.llm,
        performance: false,
        security: false,
        static: tracker.static,
      },
      evaluators: [...tracker.evaluators],
      testCount: tracker.testCount,
      gaps,
    });
    for (const g of gaps) {
      allGaps.push({ severity: gapSeverity('skill', g), message: g, component: name });
    }
  }

  for (const [name, tracker] of ruleTracker) {
    const gaps = buildRuleGaps(name, tracker);
    components.push({
      name,
      type: 'rule',
      layers: {
        unit: false,
        integration: false,
        llm: false,
        performance: false,
        security: false,
        static: tracker.static,
      },
      evaluators: [...tracker.evaluators],
      testCount: tracker.testCount,
      gaps,
    });
    for (const g of gaps) {
      allGaps.push({ severity: gapSeverity('rule', g), message: g, component: name });
    }
  }

  for (const [name, tracker] of agentTracker) {
    const gaps = buildAgentGaps(name, tracker);
    components.push({
      name,
      type: 'agent',
      layers: {
        unit: false,
        integration: false,
        llm: tracker.llm,
        performance: false,
        security: false,
        static: tracker.static,
      },
      evaluators: [...tracker.evaluators],
      testCount: tracker.testCount,
      gaps,
    });
    for (const g of gaps) {
      allGaps.push({ severity: gapSeverity('agent', g), message: g, component: name });
    }
  }

  for (const [name, tracker] of commandTracker) {
    const gaps = buildCommandGaps(name, tracker);
    components.push({
      name,
      type: 'command',
      layers: {
        unit: false,
        integration: false,
        llm: tracker.llm,
        performance: false,
        security: false,
        static: tracker.static,
      },
      evaluators: [...tracker.evaluators],
      testCount: tracker.testCount,
      gaps,
    });
    for (const g of gaps) {
      allGaps.push({ severity: gapSeverity('command', g), message: g, component: name });
    }
  }

  allGaps.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.severity] - order[b.severity];
  });

  const toolsCovered = [...toolTracker.values()].filter((t) => isComponentCovered('tool', t)).length;
  const skillsCovered = [...skillTracker.values()].filter((t) =>
    isComponentCovered('skill', t),
  ).length;
  const rulesCovered = [...ruleTracker.values()].filter((t) =>
    isComponentCovered('rule', t),
  ).length;
  const agentsCovered = [...agentTracker.values()].filter((t) =>
    isComponentCovered('agent', t),
  ).length;
  const commandsCovered = [...commandTracker.values()].filter((t) =>
    isComponentCovered('command', t),
  ).length;

  const totalComponents = components.length;
  const coveredComponents = toolsCovered + skillsCovered + rulesCovered + agentsCovered + commandsCovered;
  const coveragePercent = totalComponents > 0 ? Math.round((coveredComponents / totalComponents) * 100) : 100;

  const applicableLayers: Record<string, readonly string[]> = {
    tool: ['unit', 'integration', 'llm', 'performance', 'security', 'static'],
    skill: ['static', 'llm', 'security'],
    rule: ['static'],
    agent: ['static', 'llm'],
    command: ['static', 'llm'],
  };

  let slotsFilled = 0;
  let slotsTotal = 0;
  for (const comp of components) {
    const applicable = applicableLayers[comp.type] ?? LAYER_NAMES;
    slotsTotal += applicable.length;
    for (const layer of applicable) {
      if (comp.layers[layer as keyof typeof comp.layers]) slotsFilled++;
    }
  }
  const depthPercent = slotsTotal > 0 ? Math.round((slotsFilled / slotsTotal) * 100) : 100;

  const pct = (covered: number, total: number) =>
    total > 0 ? Math.round((covered / total) * 100) : 100;

  const layerNames = ['unit', 'integration', 'llm', 'performance', 'security', 'static'] as const;
  const layerCoverage: Record<string, { tested: number; total: number; percent: number }> = {};
  for (const layer of layerNames) {
    const applicable = components.filter((c) => (applicableLayers[c.type] ?? LAYER_NAMES).includes(layer));
    const tested = applicable.filter((c) => c.layers[layer]).length;
    layerCoverage[layer] = { tested, total: applicable.length, percent: pct(tested, applicable.length) };
  }

  return {
    timestamp: new Date().toISOString(),
    pluginName: manifest.name,
    totalComponents,
    coveredComponents,
    coveragePercent,
    depthPercent,
    slotsFilled,
    slotsTotal,
    byType: {
      tools: { total: toolNames.length, covered: toolsCovered, percent: pct(toolsCovered, toolNames.length) },
      skills: { total: skillNames.length, covered: skillsCovered, percent: pct(skillsCovered, skillNames.length) },
      rules: { total: ruleNames.length, covered: rulesCovered, percent: pct(rulesCovered, ruleNames.length) },
      agents: { total: agentNames.length, covered: agentsCovered, percent: pct(agentsCovered, agentNames.length) },
      commands: { total: commandNames.length, covered: commandsCovered, percent: pct(commandsCovered, commandNames.length) },
    },
    components,
    gaps: allGaps,
    layerCoverage,
  };
}

function collectToolNames(suites: SuiteConfig[], manifest: PluginManifest): string[] {
  const tools = new Set<string>();

  for (const suite of suites) {
    for (const test of suite.tests) {

      if (suite.layer === 'unit') {
        const ut = test as UnitTestConfig;
        if (ut.expectedTools) ut.expectedTools.forEach((t) => tools.add(t));
        if (ut.tool) tools.add(ut.tool);
      }
      if (suite.layer === 'integration') {
        const it = test as IntegrationTestConfig;
        if (it.tool) tools.add(it.tool);
        if (it.workflow) it.workflow.forEach((s) => tools.add(s.tool));
      }
      if (suite.layer === 'llm') {
        const lt = test as LlmTestConfig;
        if (lt.expected?.tools) lt.expected.tools.forEach((t) => tools.add(t));
      }
      if (suite.layer === 'performance') {
        const pt = test as PerformanceTestConfig;
        if (pt.tool) tools.add(pt.tool);
      }
    }
  }

  return [...tools];
}
