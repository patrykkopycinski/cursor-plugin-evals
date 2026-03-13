import type { Leaderboard, LeaderboardEntry } from './types.js';

const MEDAL_ICONS: Record<string, string> = {
  gold: '\u{1F947}',
  silver: '\u{1F948}',
  bronze: '\u{1F949}',
};

const BADGE_MD: Record<string, string> = {
  gold: ':1st_place_medal:',
  silver: ':2nd_place_medal:',
  bronze: ':3rd_place_medal:',
};

const BAR_CHARS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

function bar(value: number, max: number, width: number): string {
  if (max <= 0) return BAR_CHARS[0].repeat(width);
  const filled = Math.round((value / max) * width);
  return BAR_CHARS[7].repeat(filled) + BAR_CHARS[0].repeat(Math.max(0, width - filled));
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number | null): string {
  if (usd == null) return 'n/a';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function scoreColor(score: number): string {
  if (score >= 0.9) return '\x1b[32m';
  if (score >= 0.7) return '\x1b[33m';
  return '\x1b[31m';
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

export function formatLeaderboardTerminal(lb: Leaderboard): string {
  if (lb.entries.length === 0) return 'No leaderboard entries.';

  const lines: string[] = [];
  const maxScore = Math.max(...lb.entries.map((e) => e.avgScore), 0.01);
  const modelWidth = Math.max(10, ...lb.entries.map((e) => e.modelId.length));

  lines.push(`${BOLD}${lb.name}${RESET}`);
  lines.push(`${DIM}${lb.description}${RESET}`);
  lines.push('');

  const header = [
    padRight('#', 4),
    padRight('Model', modelWidth),
    '  ',
    padLeft('Score', 7),
    '  ',
    padLeft('Pass%', 7),
    '  ',
    padLeft('Avg Lat', 8),
    '  ',
    padLeft('P95 Lat', 8),
    '  ',
    padLeft('Cost', 8),
    '  ',
    padLeft('Runs', 4),
    '  ',
    'Bar',
  ].join('');

  lines.push(header);
  lines.push('\u2500'.repeat(header.length + 8));

  for (const entry of lb.entries) {
    const medal = entry.badge ? ` ${MEDAL_ICONS[entry.badge]}` : '   ';
    const sc = scoreColor(entry.avgScore);

    lines.push(
      [
        padRight(`${entry.rank}`, 4),
        padRight(entry.modelId, modelWidth),
        medal,
        sc + padLeft(entry.avgScore.toFixed(3), 7) + RESET,
        '  ',
        padLeft((entry.passRate * 100).toFixed(1) + '%', 7),
        '  ',
        padLeft(formatLatency(entry.avgLatencyMs), 8),
        '  ',
        padLeft(formatLatency(entry.p95LatencyMs), 8),
        '  ',
        padLeft(formatCost(entry.avgCostUsd), 8),
        '  ',
        padLeft(String(entry.totalRuns), 4),
        '  ',
        bar(entry.avgScore, maxScore, 12),
      ].join(''),
    );
  }

  lines.push('');
  lines.push(
    `${DIM}Tests: ${lb.metadata.totalTests} | Suites: ${lb.metadata.suites.length} | Evaluators: ${lb.metadata.evaluators.length} | Updated: ${lb.lastUpdated}${RESET}`,
  );

  return lines.join('\n');
}

export function formatLeaderboardMarkdown(lb: Leaderboard): string {
  if (lb.entries.length === 0) return 'No leaderboard entries.\n';

  const lines: string[] = [];

  lines.push(`# ${lb.name}`);
  lines.push('');
  lines.push(lb.description);
  lines.push('');
  lines.push(
    '| Rank | Model | Provider | Score | Pass Rate | Avg Latency | P95 Latency | Cost | Runs |',
  );
  lines.push(
    '|-----:|-------|----------|------:|----------:|------------:|------------:|-----:|-----:|',
  );

  for (const entry of lb.entries) {
    const badge = entry.badge ? ` ${BADGE_MD[entry.badge]}` : '';
    lines.push(
      `| ${entry.rank} | **${entry.modelId}**${badge} | ${entry.modelProvider} | ${entry.avgScore.toFixed(3)} | ${(entry.passRate * 100).toFixed(1)}% | ${formatLatency(entry.avgLatencyMs)} | ${formatLatency(entry.p95LatencyMs)} | ${formatCost(entry.avgCostUsd)} | ${entry.totalRuns} |`,
    );
  }

  lines.push('');

  if (lb.metadata.evaluators.length > 0) {
    lines.push('### Per-Evaluator Scores');
    lines.push('');

    const evalHeader = ['| Model', ...lb.metadata.evaluators.map((e) => ` ${e}`), '|'].join(
      ' | ',
    );
    const evalSep = [
      '|------',
      ...lb.metadata.evaluators.map(() => '------:'),
      '',
    ].join('|');

    lines.push(evalHeader);
    lines.push(evalSep);

    for (const entry of lb.entries) {
      const cells = lb.metadata.evaluators.map((e) => {
        const s = entry.scores[e];
        return s != null ? s.toFixed(3) : '-';
      });
      lines.push(`| ${entry.modelId} | ${cells.join(' | ')} |`);
    }

    lines.push('');
  }

  lines.push(
    `*${lb.metadata.totalTests} tests across ${lb.metadata.suites.length} suites · Last updated: ${lb.lastUpdated}*`,
  );
  lines.push('');

  return lines.join('\n');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtmlStyles(): string {
  return `<style>
  :root {
    --bg: #0f172a; --fg: #e2e8f0; --surface: #1e293b; --border: #334155;
    --accent: #818cf8; --gold: #fbbf24; --silver: #94a3b8; --bronze: #d97706;
    --pass: #22c55e; --fail: #ef4444; --warn: #eab308;
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --mono: 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
    --radius: 8px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 2rem; font-weight: 800; margin-bottom: 0.25rem; }
  .subtitle { font-size: 0.95rem; opacity: 0.6; margin-bottom: 2rem; }
  .stats-row { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .stat-card { background: var(--surface); border-radius: var(--radius); padding: 1rem 1.25rem; min-width: 120px; }
  .stat-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; }
  .stat-value { font-size: 1.4rem; font-weight: 700; font-family: var(--mono); }
  table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
  th { text-align: left; padding: 0.75rem 1rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid var(--border); cursor: pointer; user-select: none; white-space: nowrap; }
  th:hover { color: var(--accent); }
  th.sorted-asc::after { content: ' \\25B2'; font-size: 0.6rem; }
  th.sorted-desc::after { content: ' \\25BC'; font-size: 0.6rem; }
  td { padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.9rem; white-space: nowrap; }
  tr:hover { background: rgba(129, 140, 248, 0.05); }
  .rank { font-weight: 700; font-family: var(--mono); width: 2.5rem; text-align: center; }
  .badge { font-size: 1.1rem; margin-left: 0.25rem; }
  .model-name { font-weight: 600; }
  .provider { font-size: 0.8rem; opacity: 0.5; margin-left: 0.5rem; }
  .score { font-family: var(--mono); font-weight: 600; }
  .score-high { color: var(--pass); }
  .score-mid { color: var(--warn); }
  .score-low { color: var(--fail); }
  .bar-cell { width: 120px; }
  .bar-track { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .chart-section { margin-bottom: 2rem; }
  .chart-section h2 { font-size: 1.2rem; margin-bottom: 1rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; }
  .bar-chart { display: flex; align-items: flex-end; gap: 4px; height: 200px; padding: 0 1rem; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; min-width: 40px; }
  .bar-rect { width: 100%; border-radius: 4px 4px 0 0; transition: height 0.3s; position: relative; }
  .bar-rect:hover { opacity: 0.85; }
  .bar-label { font-size: 0.65rem; margin-top: 0.5rem; text-align: center; word-break: break-all; opacity: 0.7; }
  .bar-value { font-size: 0.65rem; font-family: var(--mono); margin-bottom: 0.25rem; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.75rem; opacity: 0.4; text-align: center; }
  .footer a { color: var(--accent); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }
</style>`;
}

function scoreClass(score: number): string {
  if (score >= 0.9) return 'score-high';
  if (score >= 0.7) return 'score-mid';
  return 'score-low';
}

function badgeHtml(badge: LeaderboardEntry['badge']): string {
  if (!badge) return '';
  const icons: Record<string, string> = { gold: '&#x1F947;', silver: '&#x1F948;', bronze: '&#x1F949;' };
  return `<span class="badge">${icons[badge]}</span>`;
}

function barColor(badge: LeaderboardEntry['badge'], score: number): string {
  if (badge === 'gold') return 'var(--gold)';
  if (badge === 'silver') return 'var(--silver)';
  if (badge === 'bronze') return 'var(--bronze)';
  if (score >= 0.9) return 'var(--pass)';
  if (score >= 0.7) return 'var(--accent)';
  return 'var(--fail)';
}

function buildHtmlScript(): string {
  return `<script>
(function() {
  var table = document.getElementById('lb-table');
  var headers = table.querySelectorAll('th[data-sort]');
  var tbody = table.querySelector('tbody');
  var currentSort = 'score';
  var currentDir = 'desc';

  headers.forEach(function(th) {
    th.addEventListener('click', function() {
      var key = th.getAttribute('data-sort');
      if (currentSort === key) {
        currentDir = currentDir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = key;
        currentDir = 'desc';
      }
      headers.forEach(function(h) { h.classList.remove('sorted-asc', 'sorted-desc'); });
      th.classList.add('sorted-' + currentDir);

      var rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort(function(a, b) {
        var av = parseFloat(a.getAttribute('data-' + key)) || 0;
        var bv = parseFloat(b.getAttribute('data-' + key)) || 0;
        return currentDir === 'asc' ? av - bv : bv - av;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
    });
  });

  var scoreHeader = table.querySelector('th[data-sort="score"]');
  if (scoreHeader) scoreHeader.classList.add('sorted-desc');
})();
</script>`;
}

export function formatLeaderboardHtml(lb: Leaderboard): string {
  if (lb.entries.length === 0) {
    return '<!DOCTYPE html><html><body><p>No leaderboard entries.</p></body></html>';
  }

  const maxScore = Math.max(...lb.entries.map((e) => e.avgScore), 0.01);

  const statsCards = [
    { label: 'Models', value: String(lb.entries.length) },
    { label: 'Tests', value: String(lb.metadata.totalTests) },
    { label: 'Suites', value: String(lb.metadata.suites.length) },
    { label: 'Evaluators', value: String(lb.metadata.evaluators.length) },
  ]
    .map(
      (s) =>
        `<div class="stat-card"><div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div></div>`,
    )
    .join('');

  const tableRows = lb.entries
    .map((entry) => {
      const pct = ((entry.avgScore / maxScore) * 100).toFixed(1);
      const color = barColor(entry.badge, entry.avgScore);
      return `<tr data-score="${entry.avgScore.toFixed(4)}" data-passrate="${entry.passRate.toFixed(4)}" data-latency="${entry.avgLatencyMs.toFixed(1)}" data-p95="${entry.p95LatencyMs.toFixed(1)}" data-cost="${entry.avgCostUsd ?? 0}" data-runs="${entry.totalRuns}">
        <td class="rank">${entry.rank}</td>
        <td><span class="model-name">${esc(entry.modelId)}</span>${badgeHtml(entry.badge)}<span class="provider">${esc(entry.modelProvider)}</span></td>
        <td class="score ${scoreClass(entry.avgScore)}">${entry.avgScore.toFixed(3)}</td>
        <td>${(entry.passRate * 100).toFixed(1)}%</td>
        <td>${esc(formatLatency(entry.avgLatencyMs))}</td>
        <td>${esc(formatLatency(entry.p95LatencyMs))}</td>
        <td>${esc(formatCost(entry.avgCostUsd))}</td>
        <td>${entry.totalRuns}</td>
        <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div></td>
      </tr>`;
    })
    .join('');

  const barChartItems = lb.entries
    .map((entry) => {
      const heightPct = maxScore > 0 ? (entry.avgScore / maxScore) * 100 : 0;
      const color = barColor(entry.badge, entry.avgScore);
      return `<div class="bar-col">
        <div class="bar-value">${entry.avgScore.toFixed(2)}</div>
        <div class="bar-rect" style="height:${heightPct.toFixed(1)}%;background:${color}"></div>
        <div class="bar-label">${esc(entry.modelId)}</div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(lb.name)}</title>
  ${buildHtmlStyles()}
</head>
<body>
  <h1>${esc(lb.name)}</h1>
  <div class="subtitle">${esc(lb.description)}</div>

  <div class="stats-row">${statsCards}</div>

  <table id="lb-table">
    <thead>
      <tr>
        <th data-sort="score">#</th>
        <th>Model</th>
        <th data-sort="score" class="sorted-desc">Score</th>
        <th data-sort="passrate">Pass Rate</th>
        <th data-sort="latency">Avg Latency</th>
        <th data-sort="p95">P95 Latency</th>
        <th data-sort="cost">Cost</th>
        <th data-sort="runs">Runs</th>
        <th></th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>

  <div class="chart-section">
    <h2>Score Comparison</h2>
    <div class="bar-chart">${barChartItems}</div>
  </div>

  <div class="footer">
    Generated by <a href="https://github.com/cursor/plugin-evals">cursor-plugin-evals</a> &middot; ${esc(lb.lastUpdated)}
  </div>
  ${buildHtmlScript()}
</body>
</html>`;
}
