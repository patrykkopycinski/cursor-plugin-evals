export const TOOL_DEFINITIONS = [
  {
    name: 'load_config',
    description: 'Parse and validate a plugin-eval.yaml configuration file',
    inputSchema: {
      type: 'object' as const,
      properties: {
        config_path: {
          type: 'string',
          description: 'Path to plugin-eval.yaml (default: ./plugin-eval.yaml)',
        },
      },
    },
  },
  {
    name: 'discover_plugin',
    description: 'Scan a directory for plugin components (skills, rules, commands, agents, MCP servers)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dir: { type: 'string', description: 'Directory to scan (default: .)' },
        plugin_root: {
          type: 'string',
          description: 'Path to plugin root relative to dir',
        },
      },
    },
  },
  {
    name: 'audit_coverage',
    description: 'Analyze test coverage and identify gaps for a plugin',
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_dir: { type: 'string', description: 'Plugin directory (default: .)' },
        config_path: {
          type: 'string',
          description: 'Path to plugin-eval.yaml (default: ./plugin-eval.yaml)',
        },
      },
    },
  },
  {
    name: 'detect_gaps',
    description: 'Scan a plugin codebase and find missing tests with severity ratings',
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_dir: { type: 'string', description: 'Plugin directory (default: .)' },
      },
    },
  },
  {
    name: 'generate_fixes',
    description: 'Auto-generate YAML test configurations and code to fill coverage gaps',
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_dir: { type: 'string', description: 'Plugin directory (default: .)' },
      },
    },
  },
  {
    name: 'list_runs',
    description: 'Browse evaluation run history',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max runs to return (default: 20)' },
      },
    },
  },
  {
    name: 'get_run_detail',
    description: 'Get full details for a specific evaluation run',
    inputSchema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string', description: 'Run ID to look up' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'run_evals',
    description:
      'Run evaluation suites against a plugin. Returns structured results with pass/fail, scores, and CI gate status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        config_path: {
          type: 'string',
          description: 'Path to plugin-eval.yaml (default: ./plugin-eval.yaml)',
        },
        suites: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific suite names',
        },
        layers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific layers (static, unit, integration, llm, performance)',
        },
        ci: {
          type: 'boolean',
          description: 'Enable CI mode — enforce thresholds',
        },
      },
    },
  },
  {
    name: 'doctor',
    description: 'Check environment prerequisites (Node, Docker, API keys, build tools)',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'analyze_collisions',
    description: 'Detect overlapping skills that may confuse routing',
    inputSchema: {
      type: 'object' as const,
      properties: {
        skills_dir: {
          type: 'string',
          description: 'Directory containing skill folders (default: .cursor-plugin/skills)',
        },
      },
    },
  },
  {
    name: 'security_audit',
    description: '3-pass security audit: static analysis, capability graph, dependency audit',
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_dir: { type: 'string', description: 'Plugin directory (default: .)' },
        config_path: { type: 'string', description: 'Path to plugin-eval.yaml' },
      },
    },
  },
  {
    name: 'regression_check',
    description: "Compare current eval run against a baseline fingerprint using Welch's t-test",
    inputSchema: {
      type: 'object' as const,
      properties: {
        baseline_run_id: { type: 'string', description: 'Baseline fingerprint run ID' },
        config_path: { type: 'string', description: 'Path to plugin-eval.yaml' },
        alpha: {
          type: 'number',
          description: 'Significance level for t-test (default: 0.05)',
        },
      },
      required: ['baseline_run_id'],
    },
  },
  {
    name: 'compare_models',
    description: 'Run evals across multiple models and produce a comparison matrix',
    inputSchema: {
      type: 'object' as const,
      properties: {
        config_path: { type: 'string', description: 'Path to plugin-eval.yaml' },
        models: {
          type: 'array',
          items: { type: 'string' },
          description: 'Model IDs to compare (at least 2)',
        },
        layers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific layers',
        },
        suites: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific suites',
        },
      },
      required: ['models'],
    },
  },
  {
    name: 'evaluate_trace',
    description:
      'Evaluate an OTel trace file without re-executing the agent. Scores recorded traces using configured evaluators — useful for iterating on evaluation criteria cheaply.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        trace_file: {
          type: 'string',
          description: 'Path to OTel trace JSON file (Jaeger or OTLP format)',
        },
        trace_id: {
          type: 'string',
          description: 'Specific trace ID to evaluate (if file contains multiple traces)',
        },
        evaluators: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Evaluator names to run (default: tool-selection, response-quality, security)',
        },
        expected_tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Expected tool names for tool-selection evaluator',
        },
        es_endpoint: {
          type: 'string',
          description:
            'Elasticsearch endpoint to read traces from (instead of file). Works with EDOT collector.',
        },
        es_api_key: {
          type: 'string',
          description: 'Elasticsearch API key for authentication',
        },
        es_index: {
          type: 'string',
          description:
            'Elasticsearch index pattern (default: traces-apm*,traces-generic.otel-*). Supports APM and OTLP native.',
        },
        es_doc_format: {
          type: 'string',
          enum: ['apm', 'otlp', 'auto'],
          description:
            'Document format hint: "apm" for ECS/APM traces, "otlp" for OTLP-native (EDOT direct), "auto" to detect per-document (default: auto)',
        },
      },
    },
  },
  {
    name: 'harvest_traces',
    description:
      'Harvest failed production traces from Elasticsearch and generate regression test cases. Queries ES for low-scoring or failed traces and converts them to plugin-eval.yaml test definitions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        endpoint: {
          type: 'string',
          description: 'Elasticsearch endpoint URL',
        },
        api_key: { type: 'string', description: 'Elasticsearch API key' },
        index: {
          type: 'string',
          description: 'Index pattern (default: traces-apm*,traces-generic.otel-*)',
        },
        time_from: { type: 'string', description: 'Start of time range (default: now-24h)' },
        time_to: { type: 'string', description: 'End of time range (default: now)' },
        score_threshold: {
          type: 'number',
          description: 'Score threshold for failures (default: 0.5)',
        },
        max_tests: { type: 'number', description: 'Max test cases to generate (default: 20)' },
      },
      required: ['endpoint'],
    },
  },
  {
    name: 'deploy_dashboard',
    description:
      'Deploy the eval results Kibana dashboard (dashboard-as-code). Creates visualizations for pass rate trends, evaluator scores, tool analysis, and failure tables.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        kibana_url: { type: 'string', description: 'Kibana URL (e.g., http://localhost:5601)' },
        space_id: { type: 'string', description: 'Kibana space ID (default: default)' },
        api_key: { type: 'string', description: 'Kibana API key' },
        title: { type: 'string', description: 'Dashboard title (default: Plugin Eval Results)' },
        export_only: {
          type: 'boolean',
          description: 'Return NDJSON export instead of deploying',
        },
      },
      required: ['kibana_url'],
    },
  },
  {
    name: 'cost_report',
    description: 'Analyze token usage and recommend cost optimizations across models',
    inputSchema: {
      type: 'object' as const,
      properties: {
        config_path: { type: 'string', description: 'Path to plugin-eval.yaml' },
        models: {
          type: 'array',
          items: { type: 'string' },
          description: 'Model IDs to compare (at least 2)',
        },
        threshold: {
          type: 'number',
          description: 'Minimum quality score threshold (default: 0.8)',
        },
      },
      required: ['models'],
    },
  },
];
