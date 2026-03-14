import type { DetectedGap, GeneratedFix } from './types.js';

export function generateFix(gap: DetectedGap): GeneratedFix | null {
  if (!gap.autoFixable) return null;

  switch (gap.category) {
    case 'tool-coverage':
      return generateToolCoverageFix(gap);
    case 'layer-coverage':
      return generateLayerFix(gap);
    case 'security':
      return generateSecurityFix(gap);
    case 'evaluator-coverage':
      return generateEvaluatorFix(gap);
    case 'infrastructure':
      return generateInfraFix(gap);
    case 'test-quality':
      return generateTestQualityFix(gap);
    case 'config':
      return generateConfigFix(gap);
    default:
      return null;
  }
}

function generateToolCoverageFix(gap: DetectedGap): GeneratedFix {
  return {
    gapId: gap.id,
    description: 'Generate tests for uncovered tools using schema-walker and smart-gen',
    files: [],
    testCommand: 'npx cursor-plugin-evals gen-tests --output generated-tests.yaml',
  };
}

function generateLayerFix(gap: DetectedGap): GeneratedFix {
  let layer: string;
  if (gap.id.includes('missing-layer-')) {
    layer = gap.id.replace(/^(user-)?missing-layer-/, '');
  } else if (gap.id.includes('perf')) {
    layer = 'performance';
  } else {
    layer = gap.id.replace(/^(user-)?/, '').replace(/-/g, '_');
  }

  const template = getLayerTemplate(layer);

  return {
    gapId: gap.id,
    description: `Add ${layer} layer test suite`,
    files: template ? [{
      path: `plugin-eval.yaml`,
      action: 'append' as const,
      content: template,
    }] : [],
    testCommand: `npx cursor-plugin-evals run --layer ${layer}`,
  };
}

function generateSecurityFix(gap: DetectedGap): GeneratedFix {
  return {
    gapId: gap.id,
    description: 'Add security evaluator to existing LLM tests',
    files: [],
    testCommand: 'npx cursor-plugin-evals security-lint',
  };
}

function generateEvaluatorFix(gap: DetectedGap): GeneratedFix {
  return {
    gapId: gap.id,
    description: 'Add recommended evaluators to test configuration',
    files: [],
    testCommand: 'npx cursor-plugin-evals run',
  };
}

function generateInfraFix(gap: DetectedGap): GeneratedFix {
  if (gap.id.includes('ci')) {
    return {
      gapId: gap.id,
      description: 'Scaffold CI configuration',
      files: [],
      testCommand: 'npx cursor-plugin-evals ci-init',
    };
  }
  return {
    gapId: gap.id,
    description: gap.suggestedFix,
    files: [],
  };
}

function generateTestQualityFix(gap: DetectedGap): GeneratedFix {
  return {
    gapId: gap.id,
    description: 'Generate diverse difficulty test cases',
    files: [],
    testCommand: 'npx cursor-plugin-evals gen-tests --personas adversarial,expert --output advanced-tests.yaml',
  };
}

function generateConfigFix(gap: DetectedGap): GeneratedFix {
  return {
    gapId: gap.id,
    description: gap.suggestedFix,
    files: [],
    testCommand: 'npx cursor-plugin-evals doctor',
  };
}

function getLayerTemplate(layer: string): string {
  switch (layer) {
    case 'static':
      return `
  - name: static-checks
    layer: static
    tests:
      - name: manifest-valid
        check: manifest
      - name: skill-frontmatter-valid
        check: skill_frontmatter
      - name: naming-conventions
        check: naming_conventions
`;
    case 'unit':
      return `
  - name: unit-tests
    layer: unit
    tests:
      - name: tool-registration
        check: registration
      - name: schema-validation
        check: schema
`;
    case 'integration':
      return `
  - name: integration-tests
    layer: integration
    tests:
      - name: placeholder
        tool: TOOL_NAME
        args: {}
        assert:
          - field: content[0].text
            op: exists
`;
    case 'llm':
      return `
  - name: llm-eval
    layer: llm
    defaults:
      evaluators:
        - correctness
        - tool-selection
        - tool-args
    tests:
      - name: placeholder
        prompt: "Describe what this plugin does"
        expected:
          responseContains: []
`;
    case 'performance':
      return `
  - name: performance-benchmarks
    layer: performance
    tests:
      - name: placeholder
        tool: TOOL_NAME
        args: {}
        iterations: 10
        thresholds:
          p95: 5000
`;
    default:
      return '';
  }
}

export function generateFixes(gaps: DetectedGap[]): GeneratedFix[] {
  return gaps.filter((g) => g.autoFixable).map(generateFix).filter((f): f is GeneratedFix => f !== null);
}
