import type { RunResult, SuiteResult, TestResult, Difficulty, PerformanceMetrics } from '../core/types.js';
import { formatDuration } from '../core/utils.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gradeColor(grade: string): string {
  const map: Record<string, string> = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' };
  return map[grade] ?? '#6b7280';
}

function passColor(pass: boolean): string {
  return pass ? '#22c55e' : '#ef4444';
}

function buildQualityScoreSection(result: RunResult): string {
  const qs = result.qualityScore;
  if (!qs) return '';
  const color = gradeColor(qs.grade);
  const dimEntries = Object.entries(qs.dimensions)
    .map(([dim, score]) => `
      <div class="dim-item">
        <span class="dim-label">${esc(dim)}</span>
        <div class="dim-bar-track"><div class="dim-bar-fill" style="width:${(score * 100).toFixed(1)}%;background:${color}"></div></div>
        <span class="dim-val">${(score * 100).toFixed(0)}%</span>
      </div>`)
    .join('');

  return `
    <div class="quality-section">
      <div class="grade-badge" style="background:${color}">${esc(qs.grade)}</div>
      <div class="composite-score">${qs.composite.toFixed(0)}%</div>
      <div class="dim-list">${dimEntries}</div>
    </div>`;
}

function buildSummaryCards(result: RunResult): string {
  const layerCounts = new Map<string, { total: number; passed: number }>();
  for (const suite of result.suites) {
    const entry = layerCounts.get(suite.layer) ?? { total: 0, passed: 0 };
    for (const t of suite.tests) {
      entry.total++;
      if (t.pass) entry.passed++;
    }
    layerCounts.set(suite.layer, entry);
  }

  const layerCards = Array.from(layerCounts.entries())
    .map(([layer, { total, passed }]) => `
      <div class="stat-card">
        <div class="stat-label">${esc(layer)}</div>
        <div class="stat-value">${passed}/${total}</div>
      </div>`)
    .join('');

  return `
    <div class="summary-grid">
      <div class="stat-card stat-total">
        <div class="stat-label">Total</div>
        <div class="stat-value">${result.overall.total}</div>
      </div>
      <div class="stat-card stat-pass">
        <div class="stat-label">Passed</div>
        <div class="stat-value">${result.overall.passed}</div>
      </div>
      <div class="stat-card stat-fail">
        <div class="stat-label">Failed</div>
        <div class="stat-value">${result.overall.failed}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Duration</div>
        <div class="stat-value">${esc(formatDuration(result.overall.duration))}</div>
      </div>
      ${layerCards}
    </div>`;
}

function buildTestRow(test: TestResult): string {
  const evalRows = test.evaluatorResults
    .map(
      (e) => `
      <tr>
        <td>${esc(e.evaluator)}</td>
        <td style="color:${passColor(e.pass)}">${e.score.toFixed(2)}</td>
        <td>${esc(e.explanation ?? '')}</td>
      </tr>`,
    )
    .join('');

  const toolCallRows = test.toolCalls
    .map(
      (tc) => `
      <tr>
        <td>${esc(tc.tool)}</td>
        <td>${esc(formatDuration(tc.latencyMs))}</td>
        <td>${tc.result.isError ? '<span class="tag-fail">error</span>' : '<span class="tag-pass">ok</span>'}</td>
      </tr>`,
    )
    .join('');

  const hasEvals = test.evaluatorResults.length > 0;
  const hasToolCalls = test.toolCalls.length > 0;

  return `
    <div class="test-row">
      <div class="test-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="test-status" style="color:${passColor(test.pass)}">${test.pass ? '✓' : '✗'}</span>
        <span class="test-name">${esc(test.name)}</span>
        <span class="test-meta">${esc(formatDuration(test.latencyMs))}${test.model ? ` · ${esc(test.model)}` : ''}</span>
        <span class="expand-icon">▸</span>
      </div>
      <div class="test-details">
        ${test.error ? `<div class="test-error"><pre>${esc(test.error)}</pre></div>` : ''}
        ${hasEvals ? `
        <h4>Evaluators</h4>
        <table class="detail-table">
          <thead><tr><th>Evaluator</th><th>Score</th><th>Explanation</th></tr></thead>
          <tbody>${evalRows}</tbody>
        </table>` : ''}
        ${hasToolCalls ? `
        <h4>Tool Calls</h4>
        <table class="detail-table">
          <thead><tr><th>Tool</th><th>Latency</th><th>Status</th></tr></thead>
          <tbody>${toolCallRows}</tbody>
        </table>` : ''}
      </div>
    </div>`;
}

function buildSuiteCards(result: RunResult): string {
  return result.suites
    .map((suite) => {
      const passRate = (suite.passRate * 100).toFixed(1);
      const testRows = suite.tests.map(buildTestRow).join('');
      return `
      <div class="suite-card">
        <div class="suite-header" onclick="this.parentElement.classList.toggle('open')">
          <h3>${esc(suite.name)}</h3>
          <div class="suite-meta">
            <span class="tag tag-layer">${esc(suite.layer)}</span>
            <span class="suite-stats">${passRate}% · ${suite.tests.length} tests · ${esc(formatDuration(suite.duration))}</span>
            <span class="expand-icon">▸</span>
          </div>
        </div>
        <div class="suite-body">${testRows}</div>
      </div>`;
    })
    .join('');
}

function buildPerfBarChart(label: string, value: number, max: number): string {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return `
    <div class="perf-bar-row">
      <span class="perf-bar-label">${esc(label)}</span>
      <svg class="perf-bar-svg" viewBox="0 0 200 20" preserveAspectRatio="none">
        <rect x="0" y="0" width="200" height="20" fill="var(--surface)" rx="3"/>
        <rect x="0" y="0" width="${pct * 2}" height="20" fill="var(--accent)" rx="3"/>
      </svg>
      <span class="perf-bar-val">${esc(formatDuration(value))}</span>
    </div>`;
}

function buildPerformanceSection(result: RunResult): string {
  const perfTests = result.suites
    .flatMap((s) => s.tests)
    .filter((t): t is TestResult & { performanceMetrics: PerformanceMetrics } => !!t.performanceMetrics);

  if (perfTests.length === 0) return '';

  const maxLatency = Math.max(...perfTests.map((t) => t.performanceMetrics.p99));

  const charts = perfTests
    .map((t) => {
      const m = t.performanceMetrics;
      return `
      <div class="perf-card">
        <h4>${esc(t.name)}</h4>
        ${buildPerfBarChart('P50', m.p50, maxLatency)}
        ${buildPerfBarChart('P95', m.p95, maxLatency)}
        ${buildPerfBarChart('P99', m.p99, maxLatency)}
        <div class="perf-extras">throughput: ${m.throughput.toFixed(1)} ops/s · samples: ${m.samples}</div>
      </div>`;
    })
    .join('');

  return `
    <section class="section" id="performance">
      <h2>Performance</h2>
      <div class="perf-grid">${charts}</div>
    </section>`;
}

function buildDifficultySection(result: RunResult): string {
  const groups = new Map<string, { total: number; passed: number; tests: TestResult[] }>();
  for (const suite of result.suites) {
    for (const test of suite.tests) {
      const diff = (test as TestResult & { difficulty?: Difficulty }).difficulty ?? 'untagged';
      const entry = groups.get(diff) ?? { total: 0, passed: 0, tests: [] };
      entry.total++;
      if (test.pass) entry.passed++;
      entry.tests.push(test);
      groups.set(diff, entry);
    }
  }

  if (groups.size <= 1 && groups.has('untagged')) return '';

  const cards = Array.from(groups.entries())
    .map(([diff, { total, passed }]) => {
      const pct = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
      return `
      <div class="diff-card">
        <div class="diff-label">${esc(diff)}</div>
        <div class="diff-stats">${passed}/${total} (${pct}%)</div>
        <div class="diff-bar-track"><div class="diff-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join('');

  return `
    <section class="section" id="difficulty">
      <h2>Difficulty Breakdown</h2>
      <div class="diff-grid">${cards}</div>
    </section>`;
}

function buildStyles(): string {
  return `
    <style>
      :root {
        --bg: #ffffff; --fg: #1a1a2e; --surface: #f3f4f6; --border: #e5e7eb;
        --accent: #6366f1; --pass: #22c55e; --fail: #ef4444;
        --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --mono: 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
        --radius: 8px;
      }
      @media (prefers-color-scheme: dark) {
        :root:not(.light) {
          --bg: #0f172a; --fg: #e2e8f0; --surface: #1e293b; --border: #334155;
          --accent: #818cf8;
        }
      }
      :root.dark {
        --bg: #0f172a; --fg: #e2e8f0; --surface: #1e293b; --border: #334155;
        --accent: #818cf8;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: var(--font); background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem; max-width: 1200px; margin: 0 auto; }
      h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
      h2 { font-size: 1.35rem; margin-bottom: 1rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; }
      h3 { font-size: 1.1rem; }
      h4 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0.75rem 0 0.5rem; color: var(--accent); }
      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; }
      .header-meta { font-size: 0.85rem; opacity: 0.7; }
      .theme-toggle { background: var(--surface); border: 1px solid var(--border); color: var(--fg); border-radius: var(--radius); padding: 0.4rem 0.8rem; cursor: pointer; font-size: 0.85rem; }

      .quality-section { display: flex; align-items: center; gap: 1.5rem; padding: 1.5rem; background: var(--surface); border-radius: var(--radius); margin-bottom: 2rem; flex-wrap: wrap; }
      .grade-badge { font-size: 2rem; font-weight: 800; width: 3.5rem; height: 3.5rem; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; }
      .composite-score { font-size: 2rem; font-weight: 700; }
      .dim-list { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 0.3rem; }
      .dim-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; }
      .dim-label { width: 120px; text-align: right; }
      .dim-bar-track { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
      .dim-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
      .dim-val { width: 40px; font-family: var(--mono); }

      .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
      .stat-card { background: var(--surface); border-radius: var(--radius); padding: 1rem; text-align: center; }
      .stat-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; }
      .stat-value { font-size: 1.5rem; font-weight: 700; font-family: var(--mono); }
      .stat-pass .stat-value { color: var(--pass); }
      .stat-fail .stat-value { color: var(--fail); }

      .section { margin-bottom: 2rem; }

      .suite-card { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 1rem; overflow: hidden; }
      .suite-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem; cursor: pointer; background: var(--surface); user-select: none; flex-wrap: wrap; gap: 0.5rem; }
      .suite-header:hover { opacity: 0.9; }
      .suite-meta { display: flex; align-items: center; gap: 0.75rem; font-size: 0.85rem; }
      .suite-body { display: none; padding: 0.5rem 1rem; }
      .suite-card.open .suite-body { display: block; }
      .suite-card.open .expand-icon { transform: rotate(90deg); }
      .expand-icon { transition: transform 0.2s; font-size: 0.8rem; }
      .tag { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
      .tag-layer { background: var(--accent); color: #fff; }
      .tag-pass { color: var(--pass); }
      .tag-fail { color: var(--fail); }
      .suite-stats { font-family: var(--mono); font-size: 0.8rem; }

      .test-row { border-top: 1px solid var(--border); }
      .test-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0; cursor: pointer; user-select: none; }
      .test-header:hover { opacity: 0.8; }
      .test-status { font-weight: 700; font-size: 1rem; width: 1.5rem; text-align: center; }
      .test-name { flex: 1; font-weight: 500; }
      .test-meta { font-family: var(--mono); font-size: 0.8rem; opacity: 0.7; }
      .test-details { display: none; padding: 0.5rem 0 0.75rem 2.25rem; }
      .test-row.open .test-details { display: block; }
      .test-row.open .expand-icon { transform: rotate(90deg); }
      .test-error { background: #fef2f2; color: #991b1b; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.5rem; overflow-x: auto; }
      :root.dark .test-error, @media (prefers-color-scheme: dark) { :root:not(.light) .test-error { background: #450a0a; color: #fca5a5; } }
      .test-error pre { font-family: var(--mono); font-size: 0.8rem; white-space: pre-wrap; }

      .detail-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 0.5rem; }
      .detail-table th { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--border); font-weight: 600; }
      .detail-table td { padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--border); }

      .perf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
      .perf-card { background: var(--surface); border-radius: var(--radius); padding: 1rem; }
      .perf-bar-row { display: flex; align-items: center; gap: 0.5rem; margin: 0.3rem 0; }
      .perf-bar-label { width: 30px; font-family: var(--mono); font-size: 0.75rem; }
      .perf-bar-svg { flex: 1; height: 20px; }
      .perf-bar-val { width: 60px; font-family: var(--mono); font-size: 0.75rem; text-align: right; }
      .perf-extras { font-size: 0.75rem; opacity: 0.7; margin-top: 0.5rem; }

      .diff-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
      .diff-card { background: var(--surface); border-radius: var(--radius); padding: 1rem; }
      .diff-label { font-weight: 600; text-transform: capitalize; margin-bottom: 0.25rem; }
      .diff-stats { font-family: var(--mono); font-size: 0.85rem; margin-bottom: 0.5rem; }
      .diff-bar-track { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
      .diff-bar-fill { height: 100%; background: var(--accent); border-radius: 3px; }

      .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.75rem; opacity: 0.5; text-align: center; }
    </style>`;
}

function buildScript(): string {
  return `
    <script>
      (function() {
        var root = document.documentElement;
        var btn = document.getElementById('theme-toggle');
        var stored = localStorage.getItem('theme');
        if (stored === 'dark') root.classList.add('dark');
        else if (stored === 'light') root.classList.add('light');

        btn.addEventListener('click', function() {
          if (root.classList.contains('dark')) {
            root.classList.remove('dark');
            root.classList.add('light');
            localStorage.setItem('theme', 'light');
            btn.textContent = '☀ Light';
          } else if (root.classList.contains('light')) {
            root.classList.remove('light');
            localStorage.setItem('theme', 'auto');
            btn.textContent = '⚙ Auto';
          } else {
            root.classList.add('dark');
            localStorage.setItem('theme', 'dark');
            btn.textContent = '🌙 Dark';
          }
        });

        if (root.classList.contains('dark')) btn.textContent = '🌙 Dark';
        else if (root.classList.contains('light')) btn.textContent = '☀ Light';
        else btn.textContent = '⚙ Auto';
      })();
    </script>`;
}

export function generateHtmlReport(result: RunResult): string {
  const title = `Eval Report: ${esc(result.runId)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${buildStyles()}
</head>
<body>
  <div class="header">
    <div>
      <h1>${title}</h1>
      <div class="header-meta">${esc(result.timestamp)} · config: ${esc(result.config)}</div>
    </div>
    <button class="theme-toggle" id="theme-toggle">⚙ Auto</button>
  </div>

  ${buildQualityScoreSection(result)}
  ${buildSummaryCards(result)}

  <section class="section" id="suites">
    <h2>Suites</h2>
    ${buildSuiteCards(result)}
  </section>

  ${buildPerformanceSection(result)}
  ${buildDifficultySection(result)}

  <div class="footer">Generated by cursor-plugin-evals at ${esc(result.timestamp)}</div>
  ${buildScript()}
</body>
</html>`;
}
