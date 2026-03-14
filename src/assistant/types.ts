import type {
  Layer,
  RunResult,
  TestResult,
  SuiteResult,
  EvaluatorResult,
  PluginManifest,
  SkillComponent,
  McpToolDefinition,
} from '../core/types.js';

// --- Codebase Scanner ---

export type ProjectKind = 'cursor-plugin' | 'mcp-server' | 'skill-repository' | 'unknown';

export interface ToolCoverage {
  tool: string;
  layers: Layer[];
  evaluators: string[];
  testCount: number;
  difficulties: string[];
  hasNegativeTests: boolean;
  hasErrorTests: boolean;
}

export interface EvalFileInfo {
  path: string;
  layer?: Layer;
  testCount: number;
  tools: string[];
  evaluators: string[];
}

export interface ConfigQualityIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  file?: string;
  fix?: string;
}

export interface CodebaseProfile {
  projectKind: ProjectKind;
  rootDir: string;
  manifest: PluginManifest | null;
  skills: SkillComponent[];
  mcpTools: McpToolDefinition[];
  evalFiles: EvalFileInfo[];
  toolCoverage: Map<string, ToolCoverage>;
  layerCoverage: Record<Layer, number>;
  evaluatorsUsed: string[];
  evaluatorsAvailable: string[];
  configIssues: ConfigQualityIssue[];
  hasCI: boolean;
  hasCiThresholds: boolean;
  hasFixtures: boolean;
  hasFingerprints: boolean;
  scanTimestamp: string;
}

// --- Coverage Analyzer ---

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CoverageGap {
  id: string;
  severity: AuditSeverity;
  category: string;
  title: string;
  description: string;
  recommendation: string;
  autoFixable: boolean;
  affectedTools?: string[];
  affectedEvaluators?: string[];
}

export interface CoverageAuditReport {
  timestamp: string;
  overallScore: number;
  gaps: CoverageGap[];
  summary: {
    totalTools: number;
    coveredTools: number;
    layerCoverage: Record<string, number>;
    evaluatorCoverage: number;
    difficultyDistribution: Record<string, number>;
    securityCoverage: boolean;
    performanceCoverage: boolean;
    regressionBaseline: boolean;
  };
}

// --- Report Reader ---

export interface AnalysisReport {
  timestamp: string;
  runId: string;
  overallPassRate: number;
  failureClusters: FailureClusterSummary[];
  regressions: RegressionSummary[];
  flakyTests: string[];
  costOptimizations: CostOptimization[];
  thresholdAdequacy: ThresholdCheck[];
  coverageGaps: CoverageGap[];
  suggestedActions: SuggestedAction[];
}

export interface FailureClusterSummary {
  category: string;
  count: number;
  tests: string[];
  remediation: string;
}

export interface RegressionSummary {
  metric: string;
  baseline: number;
  current: number;
  pValue: number;
  verdict: 'FAIL' | 'PASS' | 'INCONCLUSIVE';
}

export interface CostOptimization {
  testName: string;
  currentModel: string;
  suggestedModel: string;
  currentCost: number;
  projectedCost: number;
  projectedScore: number;
}

export interface ThresholdCheck {
  metric: string;
  current: number;
  threshold: number;
  status: 'too_lenient' | 'too_strict' | 'adequate';
  suggestion?: string;
}

export interface SuggestedAction {
  priority: 'critical' | 'high' | 'medium' | 'low';
  action: string;
  category: string;
  autoFixable: boolean;
  estimatedImpact: string;
}

// --- Gap Detector ---

export type GapTarget = 'framework' | 'user';

export interface DetectedGap {
  id: string;
  target: GapTarget;
  severity: AuditSeverity;
  category: string;
  title: string;
  description: string;
  suggestedFix: string;
  autoFixable: boolean;
  filesToCreate?: string[];
  filesToModify?: string[];
}

// --- Fix Generator ---

export interface GeneratedFix {
  gapId: string;
  files: Array<{
    path: string;
    action: 'create' | 'modify' | 'append';
    content: string;
  }>;
  description: string;
  testCommand?: string;
}

// --- PR Creator ---

export interface PrRequest {
  repoDir: string;
  branchName: string;
  title: string;
  body: string;
  fixes: GeneratedFix[];
  labels?: string[];
  draft?: boolean;
}

export interface PrResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}

// --- Score History ---

export interface ScoreSnapshot {
  runId: string;
  timestamp: string;
  overallPassRate: number;
  qualityScore: number;
  grade: string;
  suiteScores: Record<string, number>;
  evaluatorMeans: Record<string, number>;
  totalTests: number;
  totalPassed: number;
}

export interface DriftAlert {
  metric: string;
  direction: 'degrading' | 'improving';
  recentTrend: number[];
  slope: number;
  severity: AuditSeverity;
  message: string;
}
