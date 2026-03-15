export { computeDimensions, getDifficultyWeight } from './dimensions.js';
export type { DimensionScores, Difficulty } from './dimensions.js';
export { computeQualityScore, DEFAULT_WEIGHTS } from './composite.js';
export type { QualityScore } from './composite.js';
export { generateBadgeSvg } from './badge.js';
export {
  computeConfidenceInterval,
  aggregateConfidence,
  confidenceGatingPass,
} from './confidence.js';
export type { AggregatedConfidence, ScoreEntry } from './confidence.js';
export { evaluateDerivedMetrics } from './derived.js';
