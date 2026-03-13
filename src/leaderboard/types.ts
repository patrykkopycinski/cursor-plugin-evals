export interface LeaderboardEntry {
  modelId: string;
  modelProvider: string;
  avgScore: number;
  passRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgCostUsd: number | null;
  totalRuns: number;
  lastUpdated: string;
  scores: Record<string, number>;
  rank: number;
  badge: 'gold' | 'silver' | 'bronze' | null;
}

export interface Leaderboard {
  name: string;
  description: string;
  lastUpdated: string;
  entries: LeaderboardEntry[];
  metadata: {
    totalTests: number;
    evaluators: string[];
    suites: string[];
    dateRange: { from: string; to: string };
  };
}
