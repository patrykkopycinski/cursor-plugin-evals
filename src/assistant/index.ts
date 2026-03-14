export { scanCodebase, formatCodebaseReport } from './codebase-scanner.js';
export { auditCoverage, formatAuditReport } from './coverage-analyzer.js';
export {
  findLatestRunResult,
  loadRunResult,
  analyzeRunResult,
  formatAnalysisReport,
} from './report-reader.js';
export { detectGaps, formatGapReport } from './gap-detector.js';
export { generateFix, generateFixes } from './fix-generator.js';
export { applyFixes, createPr } from './pr-creator.js';
export {
  ensureDbDir,
  recordSnapshot,
  getHistory,
  detectDrift,
  formatHistoryReport,
} from './score-history.js';

export type {
  ProjectKind,
  ToolCoverage,
  EvalFileInfo,
  ConfigQualityIssue,
  CodebaseProfile,
  AuditSeverity,
  CoverageGap,
  CoverageAuditReport,
  AnalysisReport,
  FailureClusterSummary,
  RegressionSummary,
  CostOptimization,
  ThresholdCheck,
  SuggestedAction,
  GapTarget,
  DetectedGap,
  GeneratedFix,
  PrRequest,
  PrResult,
  ScoreSnapshot,
  DriftAlert,
} from './types.js';
