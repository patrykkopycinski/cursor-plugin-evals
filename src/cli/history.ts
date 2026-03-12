import { log } from './logger.js';

interface HistoryBucket {
  key: string;
  skill: { buckets: Array<{ key: string }> };
  model: { buckets: Array<{ key: string }> };
  avg_score: { value: number | null };
  cost: { value: number | null };
}

export async function historyCommand(opts: {
  skill?: string;
  model?: string;
  limit?: number;
  esUrl?: string;
}): Promise<void> {
  const esUrl = opts.esUrl || process.env.EVALUATIONS_ES_URL || 'http://localhost:9200';
  const limit = opts.limit ?? 20;

  const filters: Array<Record<string, unknown>> = [];
  if (opts.skill) {
    filters.push({ term: { skill: opts.skill } });
  }
  if (opts.model) {
    filters.push({ term: { model: opts.model } });
  }

  const query = {
    size: 0,
    query: filters.length > 0 ? { bool: { filter: filters } } : { match_all: {} },
    aggs: {
      runs: {
        terms: {
          field: 'run_id',
          size: limit,
          order: { latest: 'desc' },
        },
        aggs: {
          latest: { max: { field: '@timestamp' } },
          skill: { terms: { field: 'skill', size: 1 } },
          model: { terms: { field: 'model', size: 1 } },
          avg_score: { avg: { field: 'evaluator.score' } },
          cost: { sum: { field: 'cost_usd' } },
        },
      },
    },
  };

  let body: {
    aggregations?: {
      runs: { buckets: HistoryBucket[] };
    };
  };

  try {
    const res = await fetch(`${esUrl}/kibana-evaluations/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });

    if (!res.ok) {
      const text = await res.text();
      log.error(`Elasticsearch returned ${res.status}: ${text}`);
      return;
    }

    body = (await res.json()) as typeof body;
  } catch (err) {
    log.error(
      'Could not connect to Elasticsearch. Check that EVALUATIONS_ES_URL is correct and the cluster is reachable.',
      err,
    );
    return;
  }

  const buckets = body.aggregations?.runs?.buckets ?? [];
  if (buckets.length === 0) {
    log.info('No eval runs found.');
    return;
  }

  log.header('Eval Run History');

  const rows: string[][] = [['Run ID', 'Skill', 'Model', 'Avg Score', 'Cost', 'Timestamp']];

  for (const bucket of buckets) {
    const runId = bucket.key.slice(0, 8);
    const skill = bucket.skill.buckets[0]?.key ?? '—';
    const model = bucket.model.buckets[0]?.key ?? '—';
    const avgScore =
      bucket.avg_score.value != null ? bucket.avg_score.value.toFixed(3) : '—';
    const cost =
      bucket.cost.value != null ? `$${bucket.cost.value.toFixed(4)}` : '—';

    const latestAgg = (bucket as unknown as Record<string, { value_as_string?: string; value?: number }>)['latest'];
    const timestamp = latestAgg?.value_as_string ?? '—';

    rows.push([runId, skill, model, avgScore, cost, timestamp]);
  }

  log.table(rows);
}
