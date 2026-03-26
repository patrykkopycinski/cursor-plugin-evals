export type {
  Layer,
  ToolCallRecord,
  ToolResult,
  TokenUsage,
  EvaluatorResult,
  TestResult,
  SuiteResult,
  RunResult,
  McpToolDefinition,
  McpResource,
  JsonSchema,
  OpenAIFunctionDefinition,
  Evaluator,
  EvaluatorContext,
  ExpectedOutput,
  ClusterStateAssertion,
  ClusterCheckType,
  AssertionConfig,
  AssertionOp,
  UnitTestConfig,
  StaticTestConfig,
  StaticCheck,
  IntegrationTestConfig,
  LlmTestConfig,
  WorkflowStep,
  TestConfig,
  SuiteConfig,
  PluginConfig,
  InfrastructureConfig,
  TracingConfig,
  DefaultsConfig,
  EvalConfig,
  PluginEntry,
  PluginsConfig,
  PluginManifest,
  SkillComponent,
  RuleComponent,
  AgentComponent,
  CommandComponent,
  HookComponent,
  HookHandler,
  McpServerComponent,
  EvaluatorKind,
  Model,
  Example,
  TaskOutput,
  TaskAdapter,
  EvaluationDataset,
  EvalSetupConfig,
  EvalDefaultsConfig,
  EvalAdapterConfig,
  PhaseGate,
  SkillTestConfig,
  SkillSuiteConfig,
  AdapterConfig,
  CiThresholds,
  CiViolation,
  CiResult,
  ModelAggregate,
  ModelComparisonMatrix,
  ComparisonResult,
  SkillInfo,
  CollisionPair,
  CollisionReport,
  ConversationTurn,
  GuardrailRuleConfig,
} from './core/types.js';

export { loadConfig } from './core/config.js';
export { parseEntry, resolveDotPath, mergeDefaults, formatDuration } from './core/utils.js';
export { McpPluginClient } from './mcp/client.js';
export { convertTools, convertToolsToArray } from './mcp/schema-converter.js';
export { discoverTools, discoverResources } from './mcp/tool-discovery.js';
export { discoverPlugin } from './plugin/discovery.js';
export {
  parseFrontmatter,
  parseSkillFile,
  parseRuleFile,
  parseAgentFile,
  parseCommandFile,
} from './plugin/frontmatter.js';
export { runStaticSuite } from './layers/static/index.js';
export { runEvaluation } from './core/runner.js';
export { createEvaluator, EVALUATOR_NAMES } from './evaluators/index.js';
export { McpFixtureRecorder } from './fixtures/recorder.js';
export { McpFixtureResponder } from './fixtures/responder.js';
export { createTracer } from './tracing/spans.js';
export { printTerminalReport } from './reporting/terminal.js';
export { generateMarkdownReport } from './reporting/markdown.js';
export { generateJsonReport } from './reporting/json.js';
export { generateTapReport } from './reporting/tap.js';
export { exportToEsDatastream } from './reporting/es-export.js';
export { checkDockerHealth } from './docker/health.js';
export { setupTestCluster } from './docker/setup.js';
export { evaluateAssertions } from './layers/integration/assertions.js';
export {
  field,
  tools,
  toolSequence,
  toolArgs,
  responseContains,
  responseNotContains,
  run,
  maxIterations,
  noErrors,
  latencyUnder,
} from './expect/expect.js';
export { FieldAssertion } from './expect/assertions.js';
export { RunAssertion, evaluateRunChecks } from './expect/run-assertions.js';
export type { RunCheck, RunCheckContext, RunCheckResult } from './expect/run-assertions.js';
export { defineSuite } from './expect/suite-builder.js';
export { loadTypeScriptSuites } from './expect/loader.js';
export { buildSystemPrompt } from './layers/llm/system-prompt.js';
export {
  withRunSpan,
  withSuiteSpan,
  withTestSpan,
  withToolCallSpan,
  withLlmCallSpan,
  withEvaluatorSpan,
} from './tracing/spans.js';
export { exportToOtlp, exportToElasticsearch } from './tracing/exporters.js';
export {
  resolveCollectionPath,
  loadCollectionSuite,
  listCollections,
  getCollectionsDir,
} from './core/collections.js';
export { generateMockServer } from './fixtures/mock-gen.js';
export { McpFixtureProxy } from './fixtures/proxy.js';
export type {
  ProxyMode,
  ProxyConfig,
  ProxyResponse,
  ResponseComparison,
  ProxyStats,
} from './fixtures/proxy.js';
export { loadPlugins } from './plugins/loader.js';
export type { LoadedPlugins } from './plugins/loader.js';

export { createAdapter } from './adapters/index.js';
export type { AdapterName } from './adapters/index.js';
export { createCursorCliAdapter } from './adapters/cursor-cli.js';
export { resolveSkillWithDeps, discoverSkillMetas } from './adapters/cursor-cli-skills.js';
export type { SkillMeta } from './adapters/cursor-cli-skills.js';
export {
  createIsolatedWorkspace,
  findSkillsRoot,
  copyDirFiltered,
  EVAL_INFRA_BLOCKLIST,
} from './adapters/cursor-cli-workspace.js';
export type { IsolatedWorkspace, CreateWorkspaceOptions } from './adapters/cursor-cli-workspace.js';
export {
  normalizeToolCall,
  extractToolNameFromShellCommand,
  parseShellCommandArgs,
  buildToolCatalogSection,
} from './utils/shell-command.js';
export type { ScriptToolMapping, NormalizeToolCallOptions } from './utils/shell-command.js';
export { lintToolMappings, formatLintToolsReport } from './utils/lint-tools.js';
export type { LintToolsResult, LintToolsOptions } from './utils/lint-tools.js';
export { computeFirstTryPassRate } from './utils/first-try-pass-rate.js';
export type { FirstTryStats } from './utils/first-try-pass-rate.js';
export {
  CliFixtureRecorder,
  CliFixtureResponder,
  hashToolArgs,
  buildMockOutput,
} from './fixtures/cli-recorder.js';
export type {
  CliFixtureEntry,
  CliFixtureMetadata,
  CliFixtureResponderOptions,
} from './fixtures/cli-recorder.js';
export {
  scoreClaimsWeighted,
  LABEL_FLOORS,
} from './evaluators/correctness.js';
export type {
  ClaimVerdict,
  LabelAwareScoringConfig,
} from './evaluators/correctness.js';
export { calculateCost, getPricingCatalog } from './pricing/index.js';
export { evaluateCi, convertFlatThresholds } from './ci/index.js';
export type { EvaluateCiOptions } from './ci/index.js';
export { analyzeCollisions, scanSkills } from './analyzers/skill-collision.js';
export {
  runSkillSecurityChecks,
  runAllSkillSecurityChecks,
  formatSecurityReport,
} from './analyzers/security-lint.js';
export type { SecurityCheckResult, SkillSecurityReport } from './analyzers/security-lint.js';
export {
  inferCapabilities,
  buildCapabilityGraph,
  formatCapabilityReport,
} from './analyzers/capability-graph.js';
export type {
  ToolDefinition,
  ToolCapability,
  CapabilityEdge,
  CapabilityFinding,
  CapabilityGraph,
} from './analyzers/capability-graph.js';
export {
  auditPluginDependencies,
  formatDependencyAuditReport,
} from './analyzers/dependency-audit.js';
export type {
  DependencyNode,
  DependencyRiskIndicator,
  DependencyAuditResult,
} from './analyzers/dependency-audit.js';
export { runSecurityAudit, formatSecurityAuditReport } from './analyzers/security-audit.js';
export type { SecurityAuditResult } from './analyzers/security-audit.js';
export { buildComparisonFromRuns, formatComparisonTable } from './comparison/index.js';
export {
  computeFairAggregates,
  formatFairBenchmarkTable,
  DEFAULT_FAIR_CONFIG,
} from './comparison/fair-benchmark.js';
export type {
  FairBenchmarkConfig,
  FairBenchmarkResult,
  FairTaskResult,
  FairAggregate,
} from './comparison/fair-benchmark.js';
export { runSkillSuite } from './layers/skill/index.js';
export { loadSkillDataset } from './layers/skill/loader.js';
export { LlmCache } from './cache/index.js';
export type { CacheConfig, CacheStats } from './cache/index.js';
export { loadFromGenerator } from './dataset/index.js';
export type { GeneratorConfig, GeneratedExample } from './dataset/index.js';
export { clusterFailures } from './reporting/failure-clustering.js';
export type {
  FailureCategory,
  FailureCluster,
  TestResultForClustering,
} from './reporting/failure-clustering.js';
export { saveRecording, loadRecording, listRecordings } from './recordings/index.js';
export type { RecordedRun, RecordedExample } from './recordings/index.js';
export {
  RAG_METRIC_PATTERNS,
  isKSpecificRagEvaluator,
  matchesEvaluatorPattern,
  expandPatternsToEvaluators,
} from './evaluators/patterns.js';
export {
  ConversationCoherenceEvaluator,
  CriteriaEvaluator,
  RagEvaluator,
  PlanQualityEvaluator,
  TaskCompletionEvaluator,
  VisualRegressionEvaluator,
} from './evaluators/index.js';

export { runConversationTest } from './layers/llm/conversation.js';

export {
  buildFingerprint,
  saveFingerprint,
  loadFingerprint,
  listFingerprints,
} from './regression/fingerprint.js';
export { detectRegressions, welchTTest } from './regression/detector.js';
export { formatRegressionReport } from './regression/report.js';
export type { Fingerprint } from './regression/fingerprint.js';
export type { Verdict, RegressionResult } from './regression/detector.js';

export { checkGuardrails, DEFAULT_GUARDRAILS } from './guardrails/index.js';
export type { GuardrailRule, GuardrailViolation } from './guardrails/index.js';

export { generateTestsFromSchema } from './gen-tests/schema-walker.js';
export { formatAsYaml } from './gen-tests/formatter.js';
export type { GeneratedTest } from './gen-tests/schema-walker.js';

export { parseOtelTrace } from './trace-import/parser.js';
export { generateTestsFromTrace } from './trace-import/generator.js';
export type { ParsedTrace, ParsedSpan } from './trace-import/parser.js';

export { generateVariants } from './prompt-sensitivity/variants.js';
export { analyzeSensitivity } from './prompt-sensitivity/analyzer.js';
export { formatSensitivityReport } from './prompt-sensitivity/report.js';
export type { SensitivityResult } from './prompt-sensitivity/analyzer.js';

export { fetchRegistry, pullSuite, packageSuite } from './registry/index.js';
export type { RegistryEntry } from './registry/index.js';

export { EvalEventEmitter, globalEmitter } from './dashboard/events.js';
export type { EvalEvent } from './dashboard/events.js';

export { runOAuthPkceFlow, refreshAccessToken } from './auth/oauth2-flow.js';
export { cacheTokens, loadCachedTokens, isTokenExpired } from './auth/token-cache.js';
export type { OAuthFlowConfig, OAuthTokens } from './auth/oauth2-flow.js';

export { optimizePrompt, generatePromptVariants } from './prompt-optimization/optimizer.js';
export { formatOptimizationReport } from './prompt-optimization/report.js';
export type { OptimizationConfig, OptimizationResult } from './prompt-optimization/optimizer.js';

export { simulateConversation } from './conversation-sim/simulator.js';
export { resolvePersona, BUILT_IN_PERSONAS } from './conversation-sim/personas.js';
export { formatAsConversationYaml } from './conversation-sim/formatter.js';
export type {
  SimulationConfig,
  SimulatedConversation,
  SimulatedTurn,
} from './conversation-sim/simulator.js';
export type { UserPersona } from './conversation-sim/personas.js';

export { runRedTeam, formatRedTeamReport, ALL_ATTACK_MODULES } from './red-team/index.js';
export type {
  AttackCategory,
  Severity,
  AttackResult,
  RedTeamReport,
  AttackModule,
  RedTeamConfig,
} from './red-team/index.js';

export { generateSmartTests, formatSmartTestsAsYaml } from './gen-tests/smart-gen.js';
export type { SmartGenConfig, GeneratedTestCase } from './gen-tests/smart-gen.js';

export { analyzeCosts, formatCostReport } from './cost-advisor/index.js';
export type { CostRecommendation, CostReport } from './cost-advisor/index.js';

export {
  createNotifiers,
  sendNotifications,
  SlackNotifier,
  GitHubNotifier,
  WebhookNotifier,
} from './notifications/index.js';
export type { NotificationConfig, NotificationPayload, Notifier } from './notifications/index.js';

export {
  createDataset,
  listDatasets,
  addExample,
  versionDataset,
  exportToYaml,
  annotateExample,
} from './dataset/manager.js';
export type {
  DatasetFile,
  DatasetExample,
  DatasetVersion,
  DatasetMeta,
} from './dataset/manager.js';

export { parseOtelJsonLine, consumeStdin } from './monitoring/consumer.js';
export { scoreTrace } from './monitoring/scorer.js';
export { createAnomalyDetector } from './monitoring/anomaly.js';
export type { TraceEvent } from './monitoring/consumer.js';
export type { ScoredTrace } from './monitoring/scorer.js';
export type { AnomalyDetector } from './monitoring/anomaly.js';

export { extractTraceViewData } from './dashboard/trace-viewer.js';
export { renderTraceHtml } from './dashboard/trace-page.js';
export type { TraceViewData } from './dashboard/trace-viewer.js';

export { captureScreenshot } from './multimodal/screenshot.js';
export { compareImages } from './multimodal/pixel-diff.js';
export { saveBaseline, loadBaseline } from './multimodal/baselines.js';
export type { ScreenshotOptions } from './multimodal/screenshot.js';
export type { DiffResult } from './multimodal/pixel-diff.js';

export {
  aggregateByMajorityVote,
  aggregateByBordaCount,
  aggregateByWeightedAverage,
  aggregateByMedian,
  computeAgreement,
  runMultiJudgeEvaluation,
  DEFAULT_MULTI_JUDGE_CONFIG,
} from './evaluators/multi-judge.js';
export type {
  AggregationMethod,
  JudgeConfig,
  JudgeVerdict,
  MultiJudgeResult,
  MultiJudgeConfig,
} from './evaluators/multi-judge.js';

export { runConformanceChecks } from './layers/conformance/index.js';
export { formatConformanceReport } from './layers/conformance/report.js';
export type {
  ConformanceCategory,
  ConformanceCheck,
  ConformanceResult,
  ConformanceReport,
} from './layers/conformance/types.js';

export {
  checkPlatformCompatibility,
  formatCompatibilityReport,
} from './analyzers/platform-compat.js';
export type {
  Platform,
  PlatformRequirement,
  CompatibilityResult,
  PlatformCheckResult,
  CompatibilityReport,
} from './analyzers/platform-compat.js';

export { buildLeaderboard } from './leaderboard/builder.js';
export {
  formatLeaderboardTerminal,
  formatLeaderboardMarkdown,
  formatLeaderboardHtml,
} from './leaderboard/formatter.js';
export type { Leaderboard, LeaderboardEntry } from './leaderboard/types.js';

export { ChaosEngine, applyFault, formatChaosReport } from './chaos/index.js';
export type { FaultKind, FaultRule, ChaosConfig, ChaosEvent, ChaosReport } from './chaos/index.js';

export { generateProbes, generateValidValue, generateWrongType } from './schema-drift/index.js';
export { analyzeDrift, formatDriftReport } from './schema-drift/index.js';
export type {
  DriftKind,
  DriftFinding,
  ProbeInput,
  ProbeResult,
  SchemaDriftReport,
} from './schema-drift/index.js';

export {
  SAFE_MCP_TECHNIQUES,
  buildComplianceReport,
  formatComplianceReport,
} from './safe-mcp/index.js';
export type {
  SafeMcpTechnique,
  SafeMcpTactic,
  ComplianceMapping,
  ComplianceReport,
} from './safe-mcp/index.js';

export {
  CROSS_SERVER_SCENARIOS,
  analyzeResults,
  formatCrossServerReport,
} from './multi-server/index.js';
export type {
  AttackVector,
  MaliciousToolDef,
  CrossServerTestCase,
  CrossServerResult,
  CrossServerReport,
} from './multi-server/index.js';

export {
  extractTrajectory,
  computeLCS,
  scoreTrajectory,
  TrajectoryEvaluator,
} from './evaluators/trajectory.js';
export type { TrajectoryStep, TrajectoryMetrics } from './evaluators/trajectory.js';

export { generateFuzzInputs, analyzeFuzzResults, formatFuzzReport } from './fuzz/index.js';
export type { FuzzInput, FuzzResult, FuzzReport } from './fuzz/index.js';

export {
  generateBadgeSvg,
  generateScoreBadge,
  generatePassRateBadge,
  generateConformanceBadge,
  generateSecurityBadge,
  generateResilienceBadge,
  gradeColor,
} from './badges/index.js';
export type { BadgeConfig, BadgeStyle } from './badges/index.js';

export {
  scanCodebase,
  formatCodebaseReport,
} from './assistant/codebase-scanner.js';
export {
  auditCoverage,
  formatAuditReport,
} from './assistant/coverage-analyzer.js';
export {
  findLatestRunResult,
  loadRunResult,
  analyzeRunResult,
  formatAnalysisReport,
} from './assistant/report-reader.js';
export {
  detectGaps,
  formatGapReport,
} from './assistant/gap-detector.js';
export {
  generateFix,
  generateFixes,
} from './assistant/fix-generator.js';
export {
  applyFixes,
  createPr,
} from './assistant/pr-creator.js';
export {
  ensureDbDir,
  recordSnapshot,
  getHistory,
  detectDrift,
  formatHistoryReport,
} from './assistant/score-history.js';
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
} from './assistant/types.js';

export {
  externalInitCommand,
  applyFixesCommand,
  generatePrFindings,
  loadWorkspaceMeta,
} from './cli/external.js';
export type {
  ExternalInitOptions,
  ApplyFixesOptions,
  PrFindingsOptions,
} from './cli/external.js';

export {
  analyzeCoverage,
  formatCoverageTerminal,
  formatCoverageMarkdown,
  formatCoverageJson,
  generateCoverageBadge,
} from './coverage/index.js';
export type { CoverageReport, ComponentCoverage } from './coverage/analyzer.js';

export { createEvalServer, startStdioServer } from './mcp/server.js';

// --- Ablation Testing ---
export { computeAblation } from './ablation/runner.js';
export type { AblationResult } from './ablation/runner.js';

// --- Zero-Config Skill Eval ---
export {
  analyzeSkill,
  generateEval,
  selectEvaluators,
  selectThresholds,
  serializeEvalYaml,
  computeDeterministicRecommendations,
  computeLlmRecommendations,
  applyPatches,
} from './skill-init/index.js';
export type {
  SkillProfile,
  GeneratedEval,
  GeneratedTest as SkillGeneratedTest,
  Recommendation,
  EvalYamlPatch,
} from './skill-init/index.js';

// --- LLM Cost Optimization ---
export { resolveJudgeModel, EVALUATOR_MODEL_TIERS } from './evaluators/evaluator-models.js';
export { DedupJudge } from './evaluators/judge-dedup.js';
export { JudgeFixtureStore } from './evaluators/judge-fixtures.js';
export { getJudgeCache } from './evaluators/llm-judge.js';
export {
  MULTI_JUDGE_TIERS,
  resolveMultiJudgeConfig,
} from './evaluators/multi-judge.js';
export type { MultiJudgeTier } from './evaluators/multi-judge.js';

// --- Cost Estimation ---
export { estimateRunCost } from './cost-advisor/estimator.js';
export type { CostEstimate, CostBreakdown } from './cost-advisor/estimator.js';

// --- OTEL Observability ---
export { buildOtelSpans, exportToElastic } from './otel/exporter.js';
export type { OtelSpan, OtelSpanEvent } from './otel/exporter.js';

// --- Snapshot Testing ---
export { SnapshotStore, defaultSanitizers } from './snapshot/store.js';
export type { Sanitizer, MatchResult } from './snapshot/store.js';

// --- Deep Trajectory Tracing ---
export { TraceCollector } from './tracing/observe.js';
export type { TraceEntry, TraceSummary } from './tracing/observe.js';

// --- Cost-Efficiency Scoring ---
export { computeCostEfficiency } from './scoring/cost-efficiency.js';
export type { CostEfficiencyScore } from './scoring/cost-efficiency.js';

// --- Natural Language Scorer ---
export { NlScorerEvaluator } from './evaluators/nl-scorer.js';

// --- Skill Testing Excellence ---
export { SkillRoutingEvaluator } from './evaluators/skill-routing.js';
export { SkillDescriptionEvaluator } from './evaluators/skill-description.js';
export { SkillComposabilityEvaluator } from './evaluators/skill-composability.js';
export { analyzeContextBudget } from './analyzers/context-budget.js';
export type { ContextBudgetReport, SkillBudgetEntry } from './analyzers/context-budget.js';
export { computeReadability } from './analyzers/readability.js';
export type { ReadabilityScore } from './analyzers/readability.js';
export { validateToolDependencies } from './analyzers/tool-deps.js';
export type { ToolDepResult } from './analyzers/tool-deps.js';
export { compareSkillVariants } from './skill-init/variant-compare.js';
export type { VariantResult } from './skill-init/variant-compare.js';
export { generateNegativeTests } from './skill-init/generator.js';
export { buildMultiTurnPrompt, extractLastUserPrompt, turnCountByRole } from './layers/skill/multi-turn.js';
export type { SkillTurn } from './layers/skill/multi-turn.js';
