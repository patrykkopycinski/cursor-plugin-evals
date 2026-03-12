import { Hono } from 'hono';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { initDb, getRuns, getRun, getLatestRuns } from './db.js';
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

  app.get('/api/events', (c) => {
    const eventsPath = resolve(dbPath, '..', 'events.jsonl');
    if (!existsSync(eventsPath)) {
      return c.json({ events: [] });
    }
    const lines = readFileSync(eventsPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-100);
    const events = lines.map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);
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
    <div id="list">
      <div class="loading">Loading runs...</div>
    </div>
    <div id="detail"></div>
  </div>
  <script>
    const listEl = document.getElementById('list');
    const detailEl = document.getElementById('detail');

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
      detailEl.innerHTML = '<div class="loading">Loading...</div>';

      try {
        const res = await fetch('/api/runs/' + id);
        const data = await res.json();
        let html = '<div class="back" onclick="showList()">← Back to runs</div>';
        html += '<h2>' + data.config + ' <span class="duration">(' + fmtTime(data.timestamp) + ')</span></h2>';
        html += '<p style="margin: 8px 0 20px; color: var(--text-muted);">' +
          (data.passRate * 100).toFixed(1) + '% pass rate · ' + data.passed + '/' + data.total + ' tests · ' + fmtDuration(data.duration) +
          (data.grade ? ' · Grade ' + data.grade : '') + '</p>';

        for (const suite of data.suites) {
          html += '<div class="suite-card">';
          html += '<h3>' + suite.name + '<span class="layer-tag">' + suite.layer + '</span></h3>';
          html += '<div style="margin-bottom:8px;color:var(--text-muted);font-size:13px;">' +
            (suite.passRate * 100).toFixed(1) + '% · ' + fmtDuration(suite.duration) + '</div>';

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
        detailEl.innerHTML = '<div class="back" onclick="showList()">← Back</div><div class="empty">Failed to load run detail.</div>';
      }
    }

    function showList() {
      detailEl.style.display = 'none';
      listEl.style.display = 'block';
    }

    loadRuns();
  </script>
</body>
</html>`;
}
