export interface DashboardConfig {
  title?: string;
  indexPattern?: string;
  timeField?: string;
}

interface KibanaSavedObject {
  id: string;
  type: 'dashboard' | 'lens';
  attributes: Record<string, unknown>;
  references: Array<{ id: string; name: string; type: string }>;
  migrationVersion?: Record<string, string>;
  coreMigrationVersion?: string;
}

// Simple deterministic hash → UUID-shaped string (no crypto dep needed)
function deterministicId(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = h.toString(16).padStart(8, '0');
  // Pad to uuid-length with deterministic filler derived from seed length
  const extra = (seed.length * 0xdeadbeef >>> 0).toString(16).padStart(8, '0');
  return `${hex}-${extra.slice(0, 4)}-4${extra.slice(4, 7)}-8${hex.slice(1, 4)}-${hex}${extra}`.slice(0, 36);
}

// ---------------------------------------------------------------------------
// Lens panel builders
// ---------------------------------------------------------------------------

function passRateTrendPanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('pass-rate-trend');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Pass Rate Trend',
      visualizationType: 'lnsXY',
      state: {
        visualization: {
          type: 'lnsXY',
          preferredSeriesType: 'line',
          layers: [
            {
              layerId: deterministicId('pass-rate-trend-layer'),
              layerType: 'data',
              seriesType: 'line',
              xAccessor: 'col-timestamp',
              accessors: ['col-pass-rate'],
              splitAccessor: 'col-eval-config',
              colorMapping: {
                colorMode: { type: 'categorical' },
              },
            },
          ],
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('pass-rate-trend-layer')]: {
                columns: {
                  'col-timestamp': {
                    label: '@timestamp',
                    dataType: 'date',
                    operationType: 'date_histogram',
                    sourceField: '@timestamp',
                    params: { interval: 'auto' },
                    isBucketed: true,
                  },
                  'col-eval-config': {
                    label: 'eval.config',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'eval.config',
                    params: { size: 10, orderBy: { type: 'alphabetical' }, orderDirection: 'asc' },
                    isBucketed: true,
                  },
                  'col-pass-rate': {
                    label: 'Avg pass rate',
                    dataType: 'number',
                    operationType: 'average',
                    sourceField: 'eval.pass_rate',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-timestamp', 'col-eval-config', 'col-pass-rate'],
                filter: { query: 'name: "eval-run"', language: 'kuery' },
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function totalRunsPanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('total-runs');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Total Runs',
      visualizationType: 'lnsMetric',
      state: {
        visualization: {
          type: 'lnsMetric',
          metricAccessor: 'col-count',
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('total-runs-layer')]: {
                columns: {
                  'col-count': {
                    label: 'Total Runs',
                    dataType: 'number',
                    operationType: 'count',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-count'],
                filter: { query: 'name: "eval-run"', language: 'kuery' },
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function avgScorePanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('avg-score');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Avg Score',
      visualizationType: 'lnsMetric',
      state: {
        visualization: {
          type: 'lnsMetric',
          metricAccessor: 'col-avg-score',
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('avg-score-layer')]: {
                columns: {
                  'col-avg-score': {
                    label: 'Avg Score',
                    dataType: 'number',
                    operationType: 'average',
                    sourceField: 'gen_ai.evaluation.score.value',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-avg-score'],
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function failureRatePanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('failure-rate');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Failure Rate',
      visualizationType: 'lnsMetric',
      state: {
        visualization: {
          type: 'lnsMetric',
          metricAccessor: 'col-failure-rate',
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('failure-rate-layer')]: {
                columns: {
                  'col-total': {
                    label: 'Total tests',
                    dataType: 'number',
                    operationType: 'count',
                    isBucketed: false,
                  },
                  'col-failed': {
                    label: 'Failed tests',
                    dataType: 'number',
                    operationType: 'count',
                    filter: { query: 'eval.test.pass: false', language: 'kuery' },
                    isBucketed: false,
                  },
                  'col-failure-rate': {
                    label: 'Failure Rate',
                    dataType: 'number',
                    operationType: 'formula',
                    params: {
                      formula: "count(kql='eval.test.pass: false') / count()",
                      format: { id: 'percent', params: { decimals: 1 } },
                    },
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-total', 'col-failed', 'col-failure-rate'],
                filter: { query: 'name: "eval-test:*"', language: 'kuery' },
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function scoreByEvaluatorPanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('score-by-evaluator');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Score by Evaluator',
      visualizationType: 'lnsXY',
      state: {
        visualization: {
          type: 'lnsXY',
          preferredSeriesType: 'bar_horizontal',
          layers: [
            {
              layerId: deterministicId('score-by-evaluator-layer'),
              layerType: 'data',
              seriesType: 'bar_horizontal',
              xAccessor: 'col-evaluator-name',
              accessors: ['col-avg-score'],
            },
          ],
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('score-by-evaluator-layer')]: {
                columns: {
                  'col-evaluator-name': {
                    label: 'Evaluator',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'gen_ai.evaluation.name',
                    params: { size: 20, orderBy: { type: 'column', columnId: 'col-avg-score' }, orderDirection: 'desc' },
                    isBucketed: true,
                  },
                  'col-avg-score': {
                    label: 'Avg Score',
                    dataType: 'number',
                    operationType: 'average',
                    sourceField: 'gen_ai.evaluation.score.value',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-evaluator-name', 'col-avg-score'],
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function evaluatorPassFailPanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('evaluator-pass-fail');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Evaluator Pass/Fail',
      visualizationType: 'lnsXY',
      state: {
        visualization: {
          type: 'lnsXY',
          preferredSeriesType: 'bar_stacked',
          layers: [
            {
              layerId: deterministicId('evaluator-pass-fail-layer'),
              layerType: 'data',
              seriesType: 'bar_stacked',
              xAccessor: 'col-evaluator-name',
              accessors: ['col-count'],
              splitAccessor: 'col-label',
            },
          ],
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('evaluator-pass-fail-layer')]: {
                columns: {
                  'col-evaluator-name': {
                    label: 'Evaluator',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'gen_ai.evaluation.name',
                    params: { size: 20, orderBy: { type: 'alphabetical' }, orderDirection: 'asc' },
                    isBucketed: true,
                  },
                  'col-label': {
                    label: 'Label',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'gen_ai.evaluation.score.label',
                    params: { size: 10, orderBy: { type: 'alphabetical' }, orderDirection: 'asc' },
                    isBucketed: true,
                  },
                  'col-count': {
                    label: 'Count',
                    dataType: 'number',
                    operationType: 'count',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-evaluator-name', 'col-label', 'col-count'],
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function toolCallFrequencyPanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('tool-call-frequency');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Tool Call Frequency',
      visualizationType: 'lnsTreemap',
      state: {
        visualization: {
          type: 'lnsTreemap',
          groups: ['col-tool-name'],
          metrics: ['col-count'],
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('tool-call-frequency-layer')]: {
                columns: {
                  'col-tool-name': {
                    label: 'Tool',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'tool.name',
                    params: { size: 50, orderBy: { type: 'column', columnId: 'col-count' }, orderDirection: 'desc' },
                    isBucketed: true,
                  },
                  'col-count': {
                    label: 'Count',
                    dataType: 'number',
                    operationType: 'count',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-tool-name', 'col-count'],
                filter: { query: 'name: "tool:*"', language: 'kuery' },
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function toolLatencyDistributionPanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('tool-latency-distribution');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Tool Latency Distribution',
      visualizationType: 'lnsXY',
      state: {
        visualization: {
          type: 'lnsXY',
          preferredSeriesType: 'bar_stacked',
          layers: [
            {
              layerId: deterministicId('tool-latency-distribution-layer'),
              layerType: 'data',
              seriesType: 'bar_stacked',
              xAccessor: 'col-latency-bucket',
              accessors: ['col-count'],
              splitAccessor: 'col-tool-name',
            },
          ],
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('tool-latency-distribution-layer')]: {
                columns: {
                  'col-latency-bucket': {
                    label: 'Latency (ms)',
                    dataType: 'number',
                    operationType: 'histogram',
                    sourceField: 'tool.latency_ms',
                    params: { interval: 500, includeEmptyRows: false },
                    isBucketed: true,
                  },
                  'col-tool-name': {
                    label: 'Tool',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'tool.name',
                    params: { size: 5, orderBy: { type: 'column', columnId: 'col-count' }, orderDirection: 'desc' },
                    isBucketed: true,
                  },
                  'col-count': {
                    label: 'Count',
                    dataType: 'number',
                    operationType: 'count',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-latency-bucket', 'col-tool-name', 'col-count'],
                filter: { query: 'name: "tool:*"', language: 'kuery' },
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function failedTestsPanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('failed-tests');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Failed Tests',
      visualizationType: 'lnsDatatable',
      state: {
        visualization: {
          type: 'lnsDatatable',
          columns: [
            { columnId: 'col-test-name' },
            { columnId: 'col-test-suite' },
            { columnId: 'col-test-layer' },
            { columnId: 'col-test-latency' },
          ],
          sorting: { columnId: 'col-timestamp', direction: 'desc' },
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('failed-tests-layer')]: {
                columns: {
                  'col-timestamp': {
                    label: '@timestamp',
                    dataType: 'date',
                    operationType: 'date_histogram',
                    sourceField: '@timestamp',
                    params: { interval: 'auto' },
                    isBucketed: true,
                  },
                  'col-test-name': {
                    label: 'Test Name',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'eval.test.name',
                    params: { size: 100, orderBy: { type: 'alphabetical' }, orderDirection: 'asc' },
                    isBucketed: true,
                  },
                  'col-test-suite': {
                    label: 'Suite',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'eval.test.suite',
                    params: { size: 100, orderBy: { type: 'alphabetical' }, orderDirection: 'asc' },
                    isBucketed: true,
                  },
                  'col-test-layer': {
                    label: 'Layer',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'eval.test.layer',
                    params: { size: 100, orderBy: { type: 'alphabetical' }, orderDirection: 'asc' },
                    isBucketed: true,
                  },
                  'col-test-latency': {
                    label: 'Latency (ms)',
                    dataType: 'number',
                    operationType: 'average',
                    sourceField: 'eval.test.latency_ms',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-timestamp', 'col-test-name', 'col-test-suite', 'col-test-layer', 'col-test-latency'],
                filter: { query: 'eval.test.pass: false', language: 'kuery' },
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

function scoreTrendByModelPanel(indexPattern: string): KibanaSavedObject {
  const id = deterministicId('score-trend-by-model');
  return {
    id,
    type: 'lens',
    attributes: {
      title: 'Score Trend by Model',
      visualizationType: 'lnsXY',
      state: {
        visualization: {
          type: 'lnsXY',
          preferredSeriesType: 'line',
          layers: [
            {
              layerId: deterministicId('score-trend-by-model-layer'),
              layerType: 'data',
              seriesType: 'line',
              xAccessor: 'col-timestamp',
              accessors: ['col-avg-score'],
              splitAccessor: 'col-model',
            },
          ],
        },
        datasourceStates: {
          formBased: {
            layers: {
              [deterministicId('score-trend-by-model-layer')]: {
                columns: {
                  'col-timestamp': {
                    label: '@timestamp',
                    dataType: 'date',
                    operationType: 'date_histogram',
                    sourceField: '@timestamp',
                    params: { interval: 'auto' },
                    isBucketed: true,
                  },
                  'col-model': {
                    label: 'Model',
                    dataType: 'string',
                    operationType: 'terms',
                    sourceField: 'eval.test.model',
                    params: { size: 10, orderBy: { type: 'alphabetical' }, orderDirection: 'asc' },
                    isBucketed: true,
                  },
                  'col-avg-score': {
                    label: 'Avg Score',
                    dataType: 'number',
                    operationType: 'average',
                    sourceField: 'gen_ai.evaluation.score.value',
                    isBucketed: false,
                  },
                },
                columnOrder: ['col-timestamp', 'col-model', 'col-avg-score'],
              },
            },
          },
        },
        query: { query: '', language: 'kuery' },
        filters: [],
        index: indexPattern,
      },
    },
    references: [{ id: indexPattern, name: 'indexpattern-datasource-layer-0', type: 'index-pattern' }],
    coreMigrationVersion: '8.8.0',
  };
}

// ---------------------------------------------------------------------------
// Dashboard saved object builder
// ---------------------------------------------------------------------------

interface PanelEntry {
  panelIndex: string;
  gridData: { x: number; y: number; w: number; h: number; i: string };
  panelRefName: string;
  embeddableConfig: Record<string, unknown>;
}

function panelEntry(
  panel: KibanaSavedObject,
  gridData: { x: number; y: number; w: number; h: number },
): PanelEntry {
  const idx = panel.id.slice(0, 8);
  return {
    panelIndex: idx,
    gridData: { ...gridData, i: idx },
    panelRefName: `panel_${idx}`,
    embeddableConfig: {},
  };
}

export function buildDashboardSavedObject(config?: DashboardConfig): Record<string, unknown> {
  const title = config?.title ?? 'Plugin Eval Results';
  const indexPattern = config?.indexPattern ?? 'traces-*';
  const timeField = config?.timeField ?? '@timestamp';

  const lenses: KibanaSavedObject[] = [
    passRateTrendPanel(indexPattern),    // 0 — row 1
    totalRunsPanel(indexPattern),        // 1
    avgScorePanel(indexPattern),         // 2
    failureRatePanel(indexPattern),      // 3
    scoreByEvaluatorPanel(indexPattern), // 4 — row 2
    evaluatorPassFailPanel(indexPattern),// 5
    toolCallFrequencyPanel(indexPattern),// 6 — row 3
    toolLatencyDistributionPanel(indexPattern), // 7
    failedTestsPanel(indexPattern),      // 8 — row 4
    scoreTrendByModelPanel(indexPattern),// 9
  ];

  // Grid: 48 columns total, rows accumulate by height
  let yOffset = 0;
  const row1H = 8;
  const row2H = 12;
  const row3H = 12;
  const row4H = 12;

  const panels: PanelEntry[] = [
    // Row 1
    panelEntry(lenses[0], { x: 0, y: yOffset, w: 24, h: row1H }),
    panelEntry(lenses[1], { x: 24, y: yOffset, w: 8, h: row1H }),
    panelEntry(lenses[2], { x: 32, y: yOffset, w: 8, h: row1H }),
    panelEntry(lenses[3], { x: 40, y: yOffset, w: 8, h: row1H }),
  ];
  yOffset += row1H;

  panels.push(
    // Row 2
    panelEntry(lenses[4], { x: 0, y: yOffset, w: 24, h: row2H }),
    panelEntry(lenses[5], { x: 24, y: yOffset, w: 24, h: row2H }),
  );
  yOffset += row2H;

  panels.push(
    // Row 3
    panelEntry(lenses[6], { x: 0, y: yOffset, w: 24, h: row3H }),
    panelEntry(lenses[7], { x: 24, y: yOffset, w: 24, h: row3H }),
  );
  yOffset += row3H;

  panels.push(
    // Row 4
    panelEntry(lenses[8], { x: 0, y: yOffset, w: 24, h: row4H }),
    panelEntry(lenses[9], { x: 24, y: yOffset, w: 24, h: row4H }),
  );

  const dashboardId = deterministicId(`${title}-dashboard`);

  const references = panels.map((p, i) => ({
    id: lenses[i].id,
    name: p.panelRefName,
    type: 'lens',
  }));

  const dashboardObj: KibanaSavedObject = {
    id: dashboardId,
    type: 'dashboard',
    attributes: {
      title,
      description: 'Plugin eval results — auto-generated dashboard as code',
      timeRestore: false,
      timeField,
      kibanaSavedObjectMeta: {
        searchSourceJSON: JSON.stringify({ query: { query: '', language: 'kuery' }, filter: [] }),
      },
      panelsJSON: JSON.stringify(panels),
      optionsJSON: JSON.stringify({ darkTheme: false, useMargins: true, syncColors: false }),
      version: 1,
    },
    references,
    coreMigrationVersion: '8.8.0',
  };

  return dashboardObj as unknown as Record<string, unknown>;
}

/**
 * Generate a Kibana dashboard as NDJSON (saved objects export format).
 * This is "dashboard as code" — deterministic, version-controlled output.
 */
export function buildDashboardNdjson(config?: DashboardConfig): string {
  const indexPattern = config?.indexPattern ?? 'traces-*';

  const lenses: KibanaSavedObject[] = [
    passRateTrendPanel(indexPattern),
    totalRunsPanel(indexPattern),
    avgScorePanel(indexPattern),
    failureRatePanel(indexPattern),
    scoreByEvaluatorPanel(indexPattern),
    evaluatorPassFailPanel(indexPattern),
    toolCallFrequencyPanel(indexPattern),
    toolLatencyDistributionPanel(indexPattern),
    failedTestsPanel(indexPattern),
    scoreTrendByModelPanel(indexPattern),
  ];

  const dashboard = buildDashboardSavedObject(config);

  const objects: KibanaSavedObject[] = [
    ...lenses,
    dashboard as unknown as KibanaSavedObject,
  ];

  return objects.map((obj) => JSON.stringify(obj)).join('\n') + '\n';
}

/**
 * Return the deterministic dashboard ID for a given config title.
 * Useful for constructing the Kibana URL after import.
 */
export function getDashboardId(config?: DashboardConfig): string {
  const title = config?.title ?? 'Plugin Eval Results';
  return deterministicId(`${title}-dashboard`);
}
