import { Hono } from 'hono';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { streamSSE } from 'hono/streaming';
import { initDb, getRuns, getRun, getLatestRuns } from './db.js';
import { globalEmitter } from './events.js';
import type { EvalEvent } from './events.js';
import type { StoredRun, StoredSuiteResult } from './db.js';
import type Database from 'better-sqlite3';

export function createApp(dbPath: string): { app: Hono; db: Database.Database } {
  const db = initDb(dbPath);
  const app = new Hono();

  app.get('/', (c) => c.html(dashboardHtml()));

  app.get('/api/runs', (c) => {
    const limit = Number(c.req.query('limit')) || 50;
    const runs = getLatestRuns(db, limit);
    return c.json(runs.map(formatRunForApi));
  });

  app.get('/api/runs/:id', (c) => {
    const data = getRun(db, c.req.param('id'));
    if (!data) return c.json({ error: 'Run not found' }, 404);
    return c.json({
      ...formatRunForApi(data.run),
      suites: data.suites.map(formatSuiteForApi),
    });
  });

  app.get('/api/runs/:id/comparison', (c) => {
    const data = getRun(db, c.req.param('id'));
    if (!data) return c.json({ error: 'Run not found' }, 404);

    const models: Record<
      string,
      { passed: number; failed: number; totalScore: number; count: number; latencyMs: number }
    > = {};

    for (const suite of data.suites) {
      const details = JSON.parse(suite.results_json);
      for (const test of details.tests ?? []) {
        const model = test.model ?? 'default';
        if (!models[model]) {
          models[model] = { passed: 0, failed: 0, totalScore: 0, count: 0, latencyMs: 0 };
        }
        const entry = models[model];
        entry.count++;
        entry.latencyMs += test.latencyMs ?? 0;
        if (test.pass) {
          entry.passed++;
        } else {
          entry.failed++;
        }
        const avgScore = test.evaluatorResults?.length
          ? test.evaluatorResults.reduce((s: number, e: { score: number }) => s + e.score, 0) /
            test.evaluatorResults.length
          : test.pass
            ? 1
            : 0;
        entry.totalScore += avgScore;
      }
    }

    const comparison = Object.entries(models).map(([model, stats]) => ({
      model,
      passed: stats.passed,
      failed: stats.failed,
      total: stats.count,
      passRate: stats.count > 0 ? stats.passed / stats.count : 0,
      avgScore: stats.count > 0 ? stats.totalScore / stats.count : 0,
      avgLatencyMs: stats.count > 0 ? stats.latencyMs / stats.count : 0,
    }));

    return c.json({ comparison });
  });

  app.get('/api/trends', (c) => {
    const limit = Number(c.req.query('limit')) || 30;
    const runs = getLatestRuns(db, limit).reverse();

    const trends = runs.map((run) => {
      const overall = JSON.parse(run.overall_json);
      return {
        runId: run.id,
        timestamp: run.timestamp,
        passRate: overall.passRate ?? 0,
        composite: overall.qualityScore?.composite ?? null,
        grade: overall.qualityScore?.grade ?? null,
        total: overall.total ?? 0,
        duration: overall.duration ?? 0,
      };
    });

    return c.json({ trends });
  });

  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = globalEmitter.subscribe((event: EvalEvent) => {
        stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {});
      });

      stream.onAbort(() => {
        unsubscribe();
      });

      while (true) {
        await stream.writeSSE({ data: '', event: 'keepalive' });
        await stream.sleep(15_000);
      }
    });
  });

  app.get('/api/events/history', (c) => {
    const eventsPath = resolve(dbPath, '..', 'events.jsonl');
    if (!existsSync(eventsPath)) {
      return c.json({ events: [] });
    }
    const lines = readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean).slice(-100);
    const events = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return c.json({ events });
  });

  return { app, db };
}

function formatRunForApi(run: StoredRun) {
  const overall = JSON.parse(run.overall_json);
  return {
    id: run.id,
    timestamp: run.timestamp,
    config: run.config,
    total: overall.total,
    passed: overall.passed,
    failed: overall.failed,
    passRate: overall.passRate,
    duration: overall.duration,
    grade: overall.qualityScore?.grade,
    composite: overall.qualityScore?.composite,
  };
}

function formatSuiteForApi(suite: StoredSuiteResult) {
  const details = JSON.parse(suite.results_json);
  return {
    id: suite.id,
    name: suite.name,
    layer: suite.layer,
    passRate: suite.pass_rate,
    duration: suite.duration,
    tests: details.tests,
    evaluatorSummary: details.evaluatorSummary,
  };
}

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plugin Evals Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --text: #e6edf3; --text-muted: #8b949e; --accent: #58a6ff;
      --green: #3fb950; --red: #f85149; --yellow: #d29922; --orange: #db6d28;
    }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; }
    .container { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
    header h1 { font-size: 20px; font-weight: 600; }
    header .subtitle { color: var(--text-muted); font-size: 13px; }
    .tabs { display: flex; gap: 4px; margin-bottom: 24px; }
    .tab { padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); }
    .tab.active { background: var(--surface); color: var(--text); border-color: var(--accent); }
    .tab:hover { color: var(--text); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:hover td { background: var(--surface); }
    tr { cursor: pointer; }
    .pass-rate { font-weight: 600; }
    .pass-rate.high { color: var(--green); }
    .pass-rate.mid { color: var(--yellow); }
    .pass-rate.low { color: var(--red); }
    .grade { display: inline-block; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 6px; font-weight: 700; font-size: 13px; }
    .grade-A { background: #238636; color: #fff; }
    .grade-B { background: #2ea043; color: #fff; }
    .grade-C { background: #9e6a03; color: #fff; }
    .grade-D { background: #bd561d; color: #fff; }
    .grade-F { background: #da3633; color: #fff; }
    .mono { font-family: 'SF Mono', Consolas, monospace; font-size: 13px; }
    .duration { color: var(--text-muted); }
    #detail { display: none; margin-top: 24px; }
    .back { color: var(--accent); cursor: pointer; font-size: 14px; margin-bottom: 16px; display: inline-block; }
    .back:hover { text-decoration: underline; }
    .suite-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .suite-card h3 { font-size: 15px; margin-bottom: 8px; }
    .suite-card .layer-tag { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--border); color: var(--text-muted); margin-left: 8px; }
    .test-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
    .test-row:last-child { border-bottom: none; }
    .test-pass { color: var(--green); }
    .test-fail { color: var(--red); }
    .empty { text-align: center; padding: 48px; color: var(--text-muted); }
    .loading { text-align: center; padding: 32px; color: var(--text-muted); }
    #progress { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 24px; display: none; }
    #progress h3 { font-size: 14px; margin-bottom: 10px; color: var(--accent); }
    #progress-events { max-height: 200px; overflow-y: auto; font-size: 12px; font-family: 'SF Mono', Consolas, monospace; }
    .event-line { padding: 2px 0; border-bottom: 1px solid var(--border); }
    .event-pass { color: var(--green); }
    .event-fail { color: var(--red); }
    .event-info { color: var(--text-muted); }
    #trend-chart { margin-bottom: 24px; }
    #comparison { display: none; }
    .comp-table th, .comp-table td { text-align: center; }
    .comp-table th:first-child, .comp-table td:first-child { text-align: left; }
    @media (max-width: 640px) {
      th, td { padding: 8px 6px; font-size: 13px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Plugin Evals Dashboard</h1>
        <div class="subtitle">cursor-plugin-evals</div>
      </div>
    </header>
    <div id="progress">
      <h3>Live Progress</h3>
      <div id="progress-events"></div>
    </div>
    <div class="tabs">
      <div class="tab active" onclick="showTab('runs')">Runs</div>
      <div class="tab" onclick="showTab('trends')">Trends</div>
    </div>
    <div id="runs-tab">
      <div id="list">
        <div class="loading">Loading runs...</div>
      </div>
      <div id="detail"></div>
      <div id="comparison"></div>
    </div>
    <div id="trends-tab" style="display:none">
      <div id="trend-chart">
        <div class="loading">Loading trends...</div>
      </div>
    </div>
  </div>
  <script>
    const listEl = document.getElementById('list');
    const detailEl = document.getElementById('detail');
    const compEl = document.getElementById('comparison');
    const progressEl = document.getElementById('progress');
    const progressEventsEl = document.getElementById('progress-events');

    function fmtDuration(ms) {
      if (ms < 1000) return ms.toFixed(0) + 'ms';
      return (ms / 1000).toFixed(1) + 's';
    }

    function fmtTime(ts) {
      const d = new Date(ts);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function passRateClass(rate) {
      if (rate >= 0.9) return 'high';
      if (rate >= 0.6) return 'mid';
      return 'low';
    }

    function gradeClass(grade) {
      if (!grade) return '';
      return 'grade-' + grade.charAt(0);
    }

    function showTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('runs-tab').style.display = name === 'runs' ? 'block' : 'none';
      document.getElementById('trends-tab').style.display = name === 'trends' ? 'block' : 'none';
      if (name === 'trends') loadTrends();
    }

    // SSE real-time events
    function connectSSE() {
      const evtSource = new EventSource('/api/events');
      evtSource.onmessage = function(e) {
        if (!e.data) return;
        try {
          const evt = JSON.parse(e.data);
          progressEl.style.display = 'block';
          const line = document.createElement('div');
          line.className = 'event-line';
          if (evt.type === 'test-pass') {
            line.className += ' event-pass';
            line.textContent = '\\u2713 ' + evt.suite + ' / ' + evt.test + ' (score: ' + (evt.score * 100).toFixed(0) + '%)';
          } else if (evt.type === 'test-fail') {
            line.className += ' event-fail';
            line.textContent = '\\u2717 ' + evt.suite + ' / ' + evt.test + (evt.error ? ' — ' + evt.error : '');
          } else if (evt.type === 'test-start') {
            line.className += ' event-info';
            line.textContent = '\\u25B6 ' + evt.suite + ' / ' + evt.test;
          } else if (evt.type === 'suite-complete') {
            line.className += ' event-info';
            line.textContent = '\\u2014 Suite ' + evt.suite + ': ' + evt.passed + ' passed, ' + evt.failed + ' failed';
          } else if (evt.type === 'run-complete') {
            line.className += ' event-pass';
            line.textContent = '\\u2714 Run complete — ' + (evt.passRate * 100).toFixed(1) + '% pass rate';
            setTimeout(() => loadRuns(), 1000);
          }
          progressEventsEl.appendChild(line);
          progressEventsEl.scrollTop = progressEventsEl.scrollHeight;
        } catch {}
      };
      evtSource.onerror = function() {
        setTimeout(connectSSE, 5000);
        evtSource.close();
      };
    }

    async function loadRuns() {
      try {
        const res = await fetch('/api/runs');
        const runs = await res.json();
        if (runs.length === 0) {
          listEl.innerHTML = '<div class="empty">No runs yet. Run an evaluation to see results here.</div>';
          return;
        }
        listEl.innerHTML = '<table><thead><tr>' +
          '<th>Time</th><th>Config</th><th>Pass Rate</th><th>Grade</th><th>Tests</th><th>Duration</th>' +
          '</tr></thead><tbody>' +
          runs.map(r =>
            '<tr onclick="loadDetail(\\'' + r.id + '\\')">' +
            '<td class="mono">' + fmtTime(r.timestamp) + '</td>' +
            '<td>' + r.config + '</td>' +
            '<td class="pass-rate ' + passRateClass(r.passRate) + '">' + (r.passRate * 100).toFixed(1) + '%</td>' +
            '<td>' + (r.grade ? '<span class="grade ' + gradeClass(r.grade) + '">' + r.grade + '</span>' : '-') + '</td>' +
            '<td class="mono">' + r.passed + '/' + r.total + '</td>' +
            '<td class="duration">' + fmtDuration(r.duration) + '</td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>';
      } catch (e) {
        listEl.innerHTML = '<div class="empty">Failed to load runs: ' + e.message + '</div>';
      }
    }

    async function loadDetail(id) {
      listEl.style.display = 'none';
      detailEl.style.display = 'block';
      compEl.style.display = 'none';
      detailEl.innerHTML = '<div class="loading">Loading...</div>';

      try {
        const res = await fetch('/api/runs/' + id);
        const data = await res.json();
        let html = '<div class="back" onclick="showList()">\\u2190 Back to runs</div>';
        html += ' <span class="back" onclick="loadComparison(\\'' + id + '\\')">Model Comparison</span>';
        html += '<h2>' + data.config + ' <span class="duration">(' + fmtTime(data.timestamp) + ')</span></h2>';
        html += '<p style="margin: 8px 0 20px; color: var(--text-muted);">' +
          (data.passRate * 100).toFixed(1) + '% pass rate \\u00B7 ' + data.passed + '/' + data.total + ' tests \\u00B7 ' + fmtDuration(data.duration) +
          (data.grade ? ' \\u00B7 Grade ' + data.grade : '') + '</p>';

        for (const suite of data.suites) {
          html += '<div class="suite-card">';
          html += '<h3>' + suite.name + '<span class="layer-tag">' + suite.layer + '</span></h3>';
          html += '<div style="margin-bottom:8px;color:var(--text-muted);font-size:13px;">' +
            (suite.passRate * 100).toFixed(1) + '% \\u00B7 ' + fmtDuration(suite.duration) + '</div>';

          if (suite.tests && suite.tests.length) {
            for (const test of suite.tests) {
              const cls = test.pass ? 'test-pass' : 'test-fail';
              const icon = test.pass ? '\\u2713' : '\\u2717';
              html += '<div class="test-row">';
              html += '<span class="' + cls + '">' + icon + ' ' + test.name + '</span>';
              html += '<span class="duration">' + fmtDuration(test.latencyMs) + '</span>';
              html += '</div>';
            }
          }
          html += '</div>';
        }
        detailEl.innerHTML = html;
      } catch (e) {
        detailEl.innerHTML = '<div class="back" onclick="showList()">\\u2190 Back</div><div class="empty">Failed to load run detail.</div>';
      }
    }

    async function loadComparison(id) {
      compEl.style.display = 'block';
      detailEl.style.display = 'none';
      compEl.innerHTML = '<div class="loading">Loading comparison...</div>';

      try {
        const res = await fetch('/api/runs/' + id + '/comparison');
        const data = await res.json();
        if (!data.comparison || data.comparison.length === 0) {
          compEl.innerHTML = '<div class="back" onclick="loadDetail(\\'' + id + '\\')">\\u2190 Back to detail</div><div class="empty">No model comparison data available.</div>';
          return;
        }

        let html = '<div class="back" onclick="loadDetail(\\'' + id + '\\')">\\u2190 Back to detail</div>';
        html += '<h3 style="margin: 12px 0">Model Comparison</h3>';
        html += '<table class="comp-table"><thead><tr><th>Model</th><th>Pass Rate</th><th>Avg Score</th><th>Passed</th><th>Failed</th><th>Avg Latency</th></tr></thead><tbody>';
        for (const m of data.comparison) {
          html += '<tr>';
          html += '<td>' + m.model + '</td>';
          html += '<td class="pass-rate ' + passRateClass(m.passRate) + '">' + (m.passRate * 100).toFixed(1) + '%</td>';
          html += '<td class="mono">' + (m.avgScore * 100).toFixed(1) + '%</td>';
          html += '<td class="mono test-pass">' + m.passed + '</td>';
          html += '<td class="mono test-fail">' + m.failed + '</td>';
          html += '<td class="duration">' + fmtDuration(m.avgLatencyMs) + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table>';
        compEl.innerHTML = html;
      } catch (e) {
        compEl.innerHTML = '<div class="back" onclick="loadDetail(\\'' + id + '\\')">\\u2190 Back</div><div class="empty">Failed to load comparison.</div>';
      }
    }

    async function loadTrends() {
      const el = document.getElementById('trend-chart');
      try {
        const res = await fetch('/api/trends');
        const data = await res.json();
        if (!data.trends || data.trends.length === 0) {
          el.innerHTML = '<div class="empty">No trend data yet.</div>';
          return;
        }

        const trends = data.trends;
        const w = 800, h = 260, padL = 50, padR = 20, padT = 20, padB = 40;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;max-width:800px;height:auto">';

        // Grid lines
        for (let i = 0; i <= 4; i++) {
          const y = padT + (chartH / 4) * i;
          const val = (100 - 25 * i);
          svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="#30363d" stroke-dasharray="4,4"/>';
          svg += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" fill="#8b949e" font-size="11" text-anchor="end">' + val + '%</text>';
        }

        // Data line
        if (trends.length > 1) {
          const points = trends.map(function(t, i) {
            const x = padL + (i / (trends.length - 1)) * chartW;
            const y = padT + (1 - t.passRate) * chartH;
            return x + ',' + y;
          });
          svg += '<polyline points="' + points.join(' ') + '" fill="none" stroke="#58a6ff" stroke-width="2"/>';

          // Dots
          trends.forEach(function(t, i) {
            const x = padL + (i / (trends.length - 1)) * chartW;
            const y = padT + (1 - t.passRate) * chartH;
            const color = t.passRate >= 0.9 ? '#3fb950' : t.passRate >= 0.6 ? '#d29922' : '#f85149';
            svg += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + color + '"/>';
          });

          // X-axis labels (first, mid, last)
          [0, Math.floor(trends.length / 2), trends.length - 1].forEach(function(i) {
            if (i >= trends.length) return;
            const x = padL + (i / (trends.length - 1)) * chartW;
            const label = new Date(trends[i].timestamp).toLocaleDateString();
            svg += '<text x="' + x + '" y="' + (h - 8) + '" fill="#8b949e" font-size="10" text-anchor="middle">' + label + '</text>';
          });
        }

        svg += '</svg>';
        el.innerHTML = '<h3 style="margin-bottom:12px">Pass Rate Over Time</h3>' + svg;
      } catch (e) {
        el.innerHTML = '<div class="empty">Failed to load trends.</div>';
      }
    }

    function showList() {
      detailEl.style.display = 'none';
      compEl.style.display = 'none';
      listEl.style.display = 'block';
    }

    loadRuns();
    connectSSE();
  </script>
</body>
</html>`;
}
