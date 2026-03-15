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

  app.get('/api/stats', (c) => {
    const runs = getLatestRuns(db, 1000);
    const totalRuns = runs.length;
    if (totalRuns === 0) {
      return c.json({ totalRuns: 0, avgPassRate: 0, latestGrade: null, totalTests: 0 });
    }
    let totalTests = 0;
    let passRateSum = 0;
    for (const run of runs) {
      const overall = JSON.parse(run.overall_json);
      totalTests += overall.total ?? 0;
      passRateSum += overall.passRate ?? 0;
    }
    const latestOverall = JSON.parse(runs[0].overall_json);
    return c.json({
      totalRuns,
      avgPassRate: passRateSum / totalRuns,
      latestGrade: latestOverall.qualityScore?.grade ?? null,
      totalTests,
    });
  });

  app.get('/api/suites', (c) => {
    const runs = getLatestRuns(db, 200);
    const suiteMap: Record<string, { name: string; runs: number; avgPassRate: number; totalPassRate: number; latestPassRate: number; layer: string }> = {};
    for (const run of runs) {
      const data = getRun(db, run.id);
      if (!data) continue;
      for (const suite of data.suites) {
        if (!suiteMap[suite.name]) {
          suiteMap[suite.name] = { name: suite.name, runs: 0, avgPassRate: 0, totalPassRate: 0, latestPassRate: suite.pass_rate, layer: suite.layer };
        }
        suiteMap[suite.name].runs++;
        suiteMap[suite.name].totalPassRate += suite.pass_rate;
      }
    }
    const suites = Object.values(suiteMap).map((s) => ({
      name: s.name,
      layer: s.layer,
      runs: s.runs,
      avgPassRate: s.runs > 0 ? s.totalPassRate / s.runs : 0,
      latestPassRate: s.latestPassRate,
    }));
    return c.json({ suites });
  });

  app.get('/api/leaderboard', (c) => {
    const runs = getLatestRuns(db, 200);
    const models: Record<string, { model: string; totalPassed: number; totalFailed: number; totalTests: number; totalScore: number; totalLatency: number; runsAppeared: number }> = {};
    for (const run of runs) {
      const data = getRun(db, run.id);
      if (!data) continue;
      for (const suite of data.suites) {
        const details = JSON.parse(suite.results_json);
        for (const test of details.tests ?? []) {
          const model = test.model ?? 'default';
          if (!models[model]) {
            models[model] = { model, totalPassed: 0, totalFailed: 0, totalTests: 0, totalScore: 0, totalLatency: 0, runsAppeared: 0 };
          }
          const entry = models[model];
          entry.totalTests++;
          entry.totalLatency += test.latencyMs ?? 0;
          if (test.pass) entry.totalPassed++;
          else entry.totalFailed++;
          const avgScore = test.evaluatorResults?.length
            ? test.evaluatorResults.reduce((s: number, e: { score: number }) => s + e.score, 0) / test.evaluatorResults.length
            : test.pass ? 1 : 0;
          entry.totalScore += avgScore;
        }
      }
    }
    const leaderboard = Object.values(models)
      .map((m) => ({
        model: m.model,
        totalTests: m.totalTests,
        passed: m.totalPassed,
        failed: m.totalFailed,
        passRate: m.totalTests > 0 ? m.totalPassed / m.totalTests : 0,
        avgScore: m.totalTests > 0 ? m.totalScore / m.totalTests : 0,
        avgLatencyMs: m.totalTests > 0 ? m.totalLatency / m.totalTests : 0,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
    return c.json({ leaderboard });
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

  app.get('/api/coverage', async (c) => {
    try {
      const { analyzeCoverage } = await import('../coverage/analyzer.js');
      const configPath = resolve(process.cwd(), 'plugin-eval.yaml');
      const pluginDir = process.cwd();
      if (!existsSync(configPath)) {
        return c.json({ error: 'plugin-eval.yaml not found' }, 404);
      }
      const report = analyzeCoverage(pluginDir, configPath);
      return c.json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.get('/api/coverage/badge', async (c) => {
    try {
      const { analyzeCoverage } = await import('../coverage/analyzer.js');
      const { generateCoverageBadge } = await import('../coverage/formatter.js');
      const configPath = resolve(process.cwd(), 'plugin-eval.yaml');
      const pluginDir = process.cwd();
      if (!existsSync(configPath)) {
        return c.text('config not found', 404);
      }
      const report = analyzeCoverage(pluginDir, configPath);
      const svg = generateCoverageBadge(report);
      return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.text(message, 500);
    }
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
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plugin Evals Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root, [data-theme="dark"] {
      --bg-deep: #0a0a0f; --bg: #12121a; --bg-surface: #1a1a26;
      --border: #2a2a3a; --border-hover: #3a3a4f;
      --text: #e8eaf0; --text-muted: #7a7f8e; --text-dim: #4a4f5e;
      --accent: #4f8eff; --accent-secondary: #8b5cf6;
      --green: #34d399; --red: #f87171; --yellow: #fbbf24; --orange: #fb923c;
      --sidebar-w: 260px;
    }
    [data-theme="light"] {
      --bg-deep: #f8f9fc; --bg: #ffffff; --bg-surface: #f0f1f5;
      --border: #dce0e8; --border-hover: #c0c4d0;
      --text: #1a1c24; --text-muted: #5a5e6e; --text-dim: #9a9eae;
      --accent: #3b7bef; --accent-secondary: #7c4ddb;
      --green: #16a34a; --red: #dc2626; --yellow: #ca8a04; --orange: #ea580c;
    }
    body { background: var(--bg-deep); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.6; display: flex; min-height: 100vh; }
    .sidebar { width: var(--sidebar-w); background: var(--bg); border-right: 1px solid var(--border); padding: 24px 0; position: fixed; top: 0; left: 0; bottom: 0; overflow-y: auto; z-index: 100; transition: transform 0.3s ease; }
    .sidebar .logo { padding: 0 20px 24px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .sidebar .logo h1 { font-size: 16px; font-weight: 700; background: linear-gradient(135deg, var(--accent), var(--accent-secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .sidebar .logo .subtitle { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
    .sidebar nav a { display: flex; align-items: center; gap: 10px; padding: 9px 20px; color: var(--text-muted); text-decoration: none; font-size: 13px; font-weight: 500; transition: all 0.15s; border-left: 3px solid transparent; }
    .sidebar nav a:hover { color: var(--text); background: var(--bg-surface); }
    .sidebar nav a.active { color: var(--accent); background: var(--bg-surface); border-left-color: var(--accent); }
    .sidebar nav a .icon { width: 18px; text-align: center; font-size: 15px; }
    .sidebar nav .section { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding: 16px 20px 6px; font-weight: 600; }
    .main { margin-left: var(--sidebar-w); flex: 1; min-height: 100vh; }
    .page { padding: 32px; max-width: 1200px; animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .page-title { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    .page-subtitle { color: var(--text-muted); font-size: 13px; margin-bottom: 28px; }
    .breadcrumb { font-size: 12px; color: var(--text-muted); margin-bottom: 20px; }
    .breadcrumb a { color: var(--accent); text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .stat-card { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 20px; transition: border-color 0.2s, transform 0.2s; }
    .stat-card:hover { border-color: var(--border-hover); transform: translateY(-2px); }
    .stat-card .label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
    .stat-card .value { font-size: 28px; font-weight: 700; margin-top: 6px; }
    .stat-card .trend { font-size: 12px; margin-top: 4px; }
    .sparkline-container { margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    th { color: var(--text-dim); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; position: sticky; top: 0; background: var(--bg-deep); z-index: 1; }
    tbody tr { cursor: pointer; transition: background 0.15s; }
    tbody tr:hover td { background: var(--bg-surface); }
    .pass-rate { font-weight: 600; }
    .pass-rate.high { color: var(--green); }
    .pass-rate.mid { color: var(--yellow); }
    .pass-rate.low { color: var(--red); }
    .grade { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; font-weight: 700; font-size: 13px; }
    .grade-A { background: linear-gradient(135deg, #059669, #34d399); color: #fff; }
    .grade-B { background: linear-gradient(135deg, #16a34a, #4ade80); color: #fff; }
    .grade-C { background: linear-gradient(135deg, #ca8a04, #fbbf24); color: #fff; }
    .grade-D { background: linear-gradient(135deg, #ea580c, #fb923c); color: #fff; }
    .grade-F { background: linear-gradient(135deg, #dc2626, #f87171); color: #fff; }
    .mono { font-family: 'SF Mono', Consolas, 'Liberation Mono', monospace; font-size: 13px; }
    .duration { color: var(--text-muted); }
    .card { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px; transition: border-color 0.2s; }
    .card:hover { border-color: var(--border-hover); }
    .card h3 { font-size: 15px; margin-bottom: 10px; }
    .layer-tag { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--bg-surface); color: var(--text-muted); margin-left: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .test-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
    .test-row:last-child { border-bottom: none; }
    .test-pass { color: var(--green); }
    .test-fail { color: var(--red); }
    .empty { text-align: center; padding: 60px 20px; color: var(--text-muted); }
    .empty .empty-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.4; }
    .loading { text-align: center; padding: 40px; color: var(--text-muted); }
    .score-bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; margin-top: 4px; }
    .score-bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--accent), var(--accent-secondary)); transition: width 0.8s ease; }
    .event-feed { max-height: 500px; overflow-y: auto; }
    .event-line { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; font-family: 'SF Mono', Consolas, monospace; display: flex; gap: 8px; align-items: baseline; }
    .event-line .etime { color: var(--text-dim); min-width: 70px; }
    .event-pass { color: var(--green); }
    .event-fail { color: var(--red); }
    .event-info { color: var(--text-muted); }
    .comp-table th, .comp-table td { text-align: center; }
    .comp-table th:first-child, .comp-table td:first-child { text-align: left; }
    .skeleton { background: linear-gradient(90deg, var(--bg-surface) 25%, var(--border) 50%, var(--bg-surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 6px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .skeleton-line { height: 14px; margin-bottom: 10px; }
    .skeleton-card { height: 100px; margin-bottom: 16px; }
    .mobile-toggle { display: none; position: fixed; top: 12px; left: 12px; z-index: 200; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; color: var(--text); cursor: pointer; font-size: 18px; }
    .settings-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--border); }
    .settings-row:last-child { border-bottom: none; }
    .settings-label { font-size: 14px; font-weight: 500; }
    .settings-desc { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    .toggle-switch { position: relative; width: 44px; height: 24px; background: var(--border); border-radius: 12px; cursor: pointer; transition: background 0.3s; }
    .toggle-switch.on { background: var(--accent); }
    .toggle-switch .knob { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: #fff; border-radius: 50%; transition: transform 0.3s; }
    .toggle-switch.on .knob { transform: translateX(20px); }
    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); }
      .sidebar.open { transform: translateX(0); }
      .mobile-toggle { display: block; }
      .main { margin-left: 0; }
      .stat-cards { grid-template-columns: 1fr; }
      th, td { padding: 8px 8px; font-size: 12px; }
    }
  </style>
</head>
<body>
  <button class="mobile-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')">\\u2630</button>
  <aside class="sidebar">
    <div class="logo">
      <h1>Plugin Evals</h1>
      <div class="subtitle">cursor-plugin-evals</div>
    </div>
    <nav>
      <div class="section">Overview</div>
      <a href="#/" data-nav><span class="icon">\\u2302</span> Dashboard</a>
      <a href="#/runs" data-nav><span class="icon">\\u25B6</span> Runs</a>
      <a href="#/suites" data-nav><span class="icon">\\u2630</span> Suites</a>
      <div class="section">Analytics</div>
      <a href="#/trends" data-nav><span class="icon">\\u2197</span> Trends</a>
      <a href="#/comparison" data-nav><span class="icon">\\u2194</span> Comparison</a>
      <a href="#/leaderboard" data-nav><span class="icon">\\u2605</span> Leaderboard</a>
      <div class="section">Quality</div>
      <a href="#/security" data-nav><span class="icon">\\u26A0</span> Security</a>
      <a href="#/conformance" data-nav><span class="icon">\\u2713</span> Conformance</a>
      <a href="#/coverage" data-nav><span class="icon">\\u25A3</span> Coverage</a>
      <div class="section">Resources</div>
      <a href="#/collections" data-nav><span class="icon">\\u2750</span> Collections</a>
      <a href="#/live" data-nav><span class="icon">\\u26A1</span> Live Feed</a>
      <div class="section">System</div>
      <a href="#/settings" data-nav><span class="icon">\\u2699</span> Settings</a>
    </nav>
  </aside>
  <div class="main">
    <div id="app"></div>
  </div>
  <script>
    const $ = s => document.querySelector(s);
    const app = $('#app');
    let sseSource = null;
    const cache = {};

    function fmtD(ms) { return ms < 1000 ? ms.toFixed(0)+'ms' : (ms/1000).toFixed(1)+'s'; }
    function fmtT(ts) { const d=new Date(ts); return d.toLocaleDateString()+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
    function prc(r) { return r>=0.9?'high':r>=0.6?'mid':'low'; }
    function gc(g) { return g?'grade-'+g.charAt(0):''; }
    function gradeBadge(g) { return g?'<span class="grade '+gc(g)+'">'+g+'</span>':'-'; }
    function scoreBar(val) { return '<div class="score-bar"><div class="score-bar-fill" style="width:'+(val*100).toFixed(1)+'%"></div></div>'; }
    function sparkline(data,w,h) {
      if(!data||data.length<2) return '';
      const min=Math.min(...data),max=Math.max(...data)||1,range=max-min||1;
      const pts=data.map((v,i)=>(i/(data.length-1)*w).toFixed(1)+','+(h-(v-min)/range*h).toFixed(1));
      return '<svg viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" style="vertical-align:middle"><polyline points="'+pts.join(' ')+'" fill="none" stroke="url(#sparkGrad)" stroke-width="1.5"/><defs><linearGradient id="sparkGrad"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-secondary)"/></linearGradient></defs></svg>';
    }
    function skeleton(n) { let h=''; for(let i=0;i<n;i++) h+='<div class="skeleton skeleton-line" style="width:'+(60+Math.random()*40)+'%"></div>'; return h; }

    async function api(path) {
      if(cache[path]&&Date.now()-cache[path].t<5000) return cache[path].d;
      const r=await fetch(path); const d=await r.json(); cache[path]={d,t:Date.now()}; return d;
    }

    function updateNav(hash) {
      document.querySelectorAll('.sidebar nav a').forEach(a=>{
        const h=a.getAttribute('href');
        a.classList.toggle('active', hash===h||(h==='#/'&&(hash===''||hash==='#'||hash==='#/')));
      });
    }

    const routes = [
      [/^#\\/$|^#$|^$/, pageOverview],
      [/^#\\/runs$/, pageRuns],
      [/^#\\/runs\\/(.+)$/, pageRunDetail],
      [/^#\\/suites$/, pageSuites],
      [/^#\\/trends$/, pageTrends],
      [/^#\\/comparison$/, pageComparison],
      [/^#\\/security$/, pageSecurity],
      [/^#\\/conformance$/, pageConformance],
      [/^#\\/coverage$/, pageCoverage],
      [/^#\\/collections$/, pageCollections],
      [/^#\\/live$/, pageLive],
      [/^#\\/leaderboard$/, pageLeaderboard],
      [/^#\\/settings$/, pageSettings],
    ];

    function router() {
      const hash = location.hash || '#/';
      updateNav(hash);
      for (const [re, fn] of routes) {
        const m = hash.match(re);
        if (m) { fn(m); return; }
      }
      app.innerHTML = '<div class="page"><div class="empty"><div class="empty-icon">404</div>Page not found</div></div>';
    }

    window.addEventListener('hashchange', router);
    document.addEventListener('keydown', e => { if(e.key==='Escape') location.hash='#/'; });

    async function pageOverview() {
      app.innerHTML = '<div class="page"><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Overview of evaluation results</p><div class="stat-cards">'+skeleton(4).replace(/skeleton-line/g,'skeleton-card')+'</div></div>';
      try {
        const [stats, trends] = await Promise.all([api('/api/stats'), api('/api/trends')]);
        const passRates = (trends.trends||[]).map(t=>t.passRate);
        app.innerHTML = '<div class="page"><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Overview of evaluation results</p>'+
          '<div class="stat-cards">'+
          '<div class="stat-card"><div class="label">Total Runs</div><div class="value">'+stats.totalRuns+'</div><div class="sparkline-container">'+sparkline(passRates,100,24)+'</div></div>'+
          '<div class="stat-card"><div class="label">Avg Pass Rate</div><div class="value pass-rate '+prc(stats.avgPassRate)+'">'+(stats.avgPassRate*100).toFixed(1)+'%</div>'+scoreBar(stats.avgPassRate)+'</div>'+
          '<div class="stat-card"><div class="label">Latest Grade</div><div class="value">'+gradeBadge(stats.latestGrade)+'</div></div>'+
          '<div class="stat-card"><div class="label">Total Tests</div><div class="value">'+stats.totalTests+'</div></div>'+
          '</div>'+
          '<div class="card"><h3>Recent Trend</h3>'+buildChart(trends.trends||[])+'</div></div>';
      } catch(e) { app.innerHTML='<div class="page"><div class="empty">Failed to load stats: '+e.message+'</div></div>'; }
    }

    async function pageRuns() {
      app.innerHTML = '<div class="page"><h1 class="page-title">Run History</h1><p class="page-subtitle">All evaluation runs</p>'+skeleton(6)+'</div>';
      try {
        const runs = await api('/api/runs');
        if(!runs.length) { app.innerHTML='<div class="page"><h1 class="page-title">Run History</h1><div class="empty"><div class="empty-icon">\\u25B6</div>No runs yet. Run an evaluation to see results.</div></div>'; return; }
        let html='<div class="page"><h1 class="page-title">Run History</h1><p class="page-subtitle">'+runs.length+' runs recorded</p><table><thead><tr><th>Time</th><th>Config</th><th>Pass Rate</th><th>Grade</th><th>Tests</th><th>Duration</th></tr></thead><tbody>';
        for(const r of runs) {
          html+='<tr onclick="location.hash=\\'#/runs/'+r.id+'\\'"><td class="mono">'+fmtT(r.timestamp)+'</td><td>'+r.config+'</td><td class="pass-rate '+prc(r.passRate)+'">'+(r.passRate*100).toFixed(1)+'%</td><td>'+gradeBadge(r.grade)+'</td><td class="mono">'+r.passed+'/'+r.total+'</td><td class="duration">'+fmtD(r.duration)+'</td></tr>';
        }
        html+='</tbody></table></div>';
        app.innerHTML=html;
      } catch(e) { app.innerHTML='<div class="page"><div class="empty">Failed to load runs: '+e.message+'</div></div>'; }
    }

    async function pageRunDetail(m) {
      const id=m[1];
      app.innerHTML='<div class="page"><div class="breadcrumb"><a href="#/runs">Runs</a> / Detail</div>'+skeleton(8)+'</div>';
      try {
        const data = await api('/api/runs/'+id);
        let html='<div class="page"><div class="breadcrumb"><a href="#/runs">Runs</a> / '+data.config+'</div>';
        html+='<h1 class="page-title">'+data.config+'</h1>';
        html+='<p class="page-subtitle">'+(data.passRate*100).toFixed(1)+'% pass rate \\u00B7 '+data.passed+'/'+data.total+' tests \\u00B7 '+fmtD(data.duration)+(data.grade?' \\u00B7 Grade '+data.grade:'')+'</p>';
        html+='<div class="stat-cards">';
        html+='<div class="stat-card"><div class="label">Pass Rate</div><div class="value pass-rate '+prc(data.passRate)+'">'+(data.passRate*100).toFixed(1)+'%</div>'+scoreBar(data.passRate)+'</div>';
        html+='<div class="stat-card"><div class="label">Duration</div><div class="value">'+fmtD(data.duration)+'</div></div>';
        html+='<div class="stat-card"><div class="label">Grade</div><div class="value">'+gradeBadge(data.grade)+'</div></div>';
        html+='</div>';
        for(const s of data.suites||[]) {
          html+='<div class="card"><h3>'+s.name+'<span class="layer-tag">'+s.layer+'</span></h3>';
          html+='<div style="margin-bottom:8px;color:var(--text-muted);font-size:13px">'+(s.passRate*100).toFixed(1)+'% \\u00B7 '+fmtD(s.duration)+'</div>';
          html+=scoreBar(s.passRate);
          if(s.tests&&s.tests.length) { for(const t of s.tests) { html+='<div class="test-row"><span class="'+(t.pass?'test-pass':'test-fail')+'">'+(t.pass?'\\u2713':'\\u2717')+' '+t.name+'</span><span class="duration">'+fmtD(t.latencyMs)+'</span></div>'; } }
          html+='</div>';
        }
        html+='</div>';
        app.innerHTML=html;
      } catch(e) { app.innerHTML='<div class="page"><div class="breadcrumb"><a href="#/runs">Runs</a> / Error</div><div class="empty">Failed to load run detail.</div></div>'; }
    }

    async function pageSuites() {
      app.innerHTML='<div class="page"><h1 class="page-title">Suites</h1><p class="page-subtitle">Suite performance across runs</p>'+skeleton(5)+'</div>';
      try {
        const data=await api('/api/suites');
        const suites=data.suites||[];
        if(!suites.length){app.innerHTML='<div class="page"><h1 class="page-title">Suites</h1><div class="empty">No suite data.</div></div>';return;}
        let html='<div class="page"><h1 class="page-title">Suites</h1><p class="page-subtitle">'+suites.length+' suites tracked</p><table><thead><tr><th>Suite</th><th>Layer</th><th>Runs</th><th>Avg Pass Rate</th><th>Latest</th></tr></thead><tbody>';
        for(const s of suites){html+='<tr><td>'+s.name+'</td><td><span class="layer-tag">'+s.layer+'</span></td><td class="mono">'+s.runs+'</td><td class="pass-rate '+prc(s.avgPassRate)+'">'+(s.avgPassRate*100).toFixed(1)+'%</td><td>'+scoreBar(s.latestPassRate)+'</td></tr>';}
        html+='</tbody></table></div>';
        app.innerHTML=html;
      } catch(e){app.innerHTML='<div class="page"><div class="empty">Failed: '+e.message+'</div></div>';}
    }

    function buildChart(trends) {
      if(!trends||trends.length<2) return '<div class="empty">Not enough data for chart.</div>';
      const w=800,h=280,pL=50,pR=20,pT=30,pB=40,cW=w-pL-pR,cH=h-pT-pB;
      let svg='<svg viewBox="0 0 '+w+' '+h+'" style="width:100%;max-width:100%;height:auto">';
      for(let i=0;i<=4;i++){const y=pT+(cH/4)*i;svg+='<line x1="'+pL+'" y1="'+y+'" x2="'+(w-pR)+'" y2="'+y+'" stroke="var(--border)" stroke-dasharray="4,4" opacity="0.5"/><text x="'+(pL-8)+'" y="'+(y+4)+'" fill="var(--text-dim)" font-size="11" text-anchor="end">'+(100-25*i)+'%</text>';}
      const pts=trends.map((t,i)=>{const x=pL+(i/(trends.length-1))*cW;const y=pT+(1-t.passRate)*cH;return{x,y,t};});
      const area=pts.map(p=>p.x+','+p.y).join(' ');
      svg+='<defs><linearGradient id="lineGrad" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-secondary)"/></linearGradient><linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity="0.15"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>';
      svg+='<polygon points="'+pL+','+(pT+cH)+' '+area+' '+(pL+(trends.length-1)/(trends.length-1)*cW)+','+(pT+cH)+'" fill="url(#areaGrad)"/>';
      svg+='<polyline points="'+area+'" fill="none" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
      for(const p of pts){const c=p.t.passRate>=0.9?'var(--green)':p.t.passRate>=0.6?'var(--yellow)':'var(--red)';svg+='<circle cx="'+p.x+'" cy="'+p.y+'" r="4" fill="'+c+'" stroke="var(--bg-deep)" stroke-width="2"><title>'+(p.t.passRate*100).toFixed(1)+'% - '+fmtT(p.t.timestamp)+'</title></circle>';}
      [0,Math.floor(trends.length/2),trends.length-1].forEach(i=>{if(i>=trends.length)return;const x=pL+(i/(trends.length-1))*cW;svg+='<text x="'+x+'" y="'+(h-8)+'" fill="var(--text-dim)" font-size="10" text-anchor="middle">'+new Date(trends[i].timestamp).toLocaleDateString()+'</text>';});
      svg+='</svg>';
      return svg;
    }

    async function pageTrends() {
      app.innerHTML='<div class="page"><h1 class="page-title">Trends</h1><p class="page-subtitle">Pass rate and quality score over time</p>'+skeleton(3)+'</div>';
      try {
        const data=await api('/api/trends');
        const trends=data.trends||[];
        let html='<div class="page"><h1 class="page-title">Trends</h1><p class="page-subtitle">Pass rate and quality score over time</p>';
        html+='<div class="card"><h3>Pass Rate Over Time</h3>'+buildChart(trends)+'</div>';
        if(trends.some(t=>t.composite!=null)){
          const w=800,h=200,pL=50,pR=20,pT=30,pB=40,cW=w-pL-pR,cH=h-pT-pB;
          let svg2='<svg viewBox="0 0 '+w+' '+h+'" style="width:100%;max-width:100%;height:auto">';
          for(let i=0;i<=4;i++){const y=pT+(cH/4)*i;svg2+='<line x1="'+pL+'" y1="'+y+'" x2="'+(w-pR)+'" y2="'+y+'" stroke="var(--border)" stroke-dasharray="4,4" opacity="0.5"/><text x="'+(pL-8)+'" y="'+(y+4)+'" fill="var(--text-dim)" font-size="11" text-anchor="end">'+(100-25*i)+'</text>';}
          const pts2=trends.filter(t=>t.composite!=null).map((t,i,a)=>{const x=pL+(i/(Math.max(a.length-1,1)))*cW;const y=pT+(1-t.composite/100)*cH;return x+','+y;});
          if(pts2.length>1){svg2+='<polyline points="'+pts2.join(' ')+'" fill="none" stroke="var(--accent-secondary)" stroke-width="2.5" stroke-linecap="round"/>';}
          svg2+='</svg>';
          html+='<div class="card"><h3>Quality Score Over Time</h3>'+svg2+'</div>';
        }
        html+='</div>';
        app.innerHTML=html;
      } catch(e){app.innerHTML='<div class="page"><div class="empty">Failed: '+e.message+'</div></div>';}
    }

    async function pageComparison() {
      app.innerHTML='<div class="page"><h1 class="page-title">Model Comparison</h1><p class="page-subtitle">Compare models from the latest run</p>'+skeleton(4)+'</div>';
      try {
        const runs=await api('/api/runs');
        if(!runs.length){app.innerHTML='<div class="page"><h1 class="page-title">Model Comparison</h1><div class="empty">No runs available.</div></div>';return;}
        const res=await fetch('/api/runs/'+runs[0].id+'/comparison');
        const data=await res.json();
        if(!data.comparison||!data.comparison.length){app.innerHTML='<div class="page"><h1 class="page-title">Model Comparison</h1><div class="empty">No model comparison data.</div></div>';return;}
        let html='<div class="page"><h1 class="page-title">Model Comparison</h1><p class="page-subtitle">Comparing models from: '+runs[0].config+'</p>';
        html+='<table class="comp-table"><thead><tr><th>Model</th><th>Pass Rate</th><th>Avg Score</th><th>Passed</th><th>Failed</th><th>Avg Latency</th></tr></thead><tbody>';
        for(const m of data.comparison){html+='<tr><td>'+m.model+'</td><td class="pass-rate '+prc(m.passRate)+'">'+(m.passRate*100).toFixed(1)+'%</td><td class="mono">'+(m.avgScore*100).toFixed(1)+'%</td><td class="mono test-pass">'+m.passed+'</td><td class="mono test-fail">'+m.failed+'</td><td class="duration">'+fmtD(m.avgLatencyMs)+'</td></tr>';}
        html+='</tbody></table></div>';
        app.innerHTML=html;
      } catch(e){app.innerHTML='<div class="page"><div class="empty">Failed: '+e.message+'</div></div>';}
    }

    async function pageSecurity() {
      app.innerHTML='<div class="page"><h1 class="page-title">Security</h1><p class="page-subtitle">Security findings summary</p>'+skeleton(4)+'</div>';
      try {
        const runs=await api('/api/runs');
        if(!runs.length){app.innerHTML='<div class="page"><h1 class="page-title">Security</h1><div class="empty">No data.</div></div>';return;}
        const data=await api('/api/runs/'+runs[0].id);
        const secSuites=(data.suites||[]).filter(s=>s.layer==='security'||s.name.includes('security'));
        let html='<div class="page"><h1 class="page-title">Security</h1><p class="page-subtitle">Security findings from latest run</p>';
        if(!secSuites.length){html+='<div class="card"><div class="empty">No security suites found in latest run.</div></div>';}
        else { for(const s of secSuites){html+='<div class="card"><h3>'+s.name+'<span class="layer-tag">'+s.layer+'</span></h3>'+scoreBar(s.passRate)+'<div style="margin:8px 0;font-size:13px;color:var(--text-muted)">'+(s.passRate*100).toFixed(1)+'% pass rate</div>';if(s.tests){for(const t of s.tests){html+='<div class="test-row"><span class="'+(t.pass?'test-pass':'test-fail')+'">'+(t.pass?'\\u2713':'\\u2717')+' '+t.name+'</span></div>';}}html+='</div>';} }
        html+='</div>';app.innerHTML=html;
      } catch(e){app.innerHTML='<div class="page"><div class="empty">Failed: '+e.message+'</div></div>';}
    }

    async function pageConformance() {
      app.innerHTML='<div class="page"><h1 class="page-title">Conformance</h1><p class="page-subtitle">Conformance tier and results</p>'+skeleton(4)+'</div>';
      try {
        const runs=await api('/api/runs');
        if(!runs.length){app.innerHTML='<div class="page"><h1 class="page-title">Conformance</h1><div class="empty">No data.</div></div>';return;}
        const data=await api('/api/runs/'+runs[0].id);
        const confSuites=(data.suites||[]).filter(s=>s.layer==='conformance'||s.name.includes('conformance'));
        let html='<div class="page"><h1 class="page-title">Conformance</h1><p class="page-subtitle">Conformance tier badge and results</p>';
        html+='<div class="stat-cards"><div class="stat-card"><div class="label">Grade</div><div class="value">'+gradeBadge(data.grade)+'</div></div><div class="stat-card"><div class="label">Composite Score</div><div class="value">'+(data.composite!=null?data.composite.toFixed(1):'N/A')+'</div></div></div>';
        if(!confSuites.length){html+='<div class="card"><div class="empty">No conformance suites found. Showing all suites.</div></div>';}
        const showSuites=confSuites.length?confSuites:data.suites||[];
        for(const s of showSuites){html+='<div class="card"><h3>'+s.name+'<span class="layer-tag">'+s.layer+'</span></h3>'+scoreBar(s.passRate)+'<div style="margin:8px 0;font-size:13px;color:var(--text-muted)">'+(s.passRate*100).toFixed(1)+'%</div>';if(s.tests){for(const t of s.tests){html+='<div class="test-row"><span class="'+(t.pass?'test-pass':'test-fail')+'">'+(t.pass?'\\u2713':'\\u2717')+' '+t.name+'</span></div>';}}html+='</div>';}
        html+='</div>';app.innerHTML=html;
      } catch(e){app.innerHTML='<div class="page"><div class="empty">Failed: '+e.message+'</div></div>';}
    }

    async function pageCollections() {
      app.innerHTML='<div class="page"><h1 class="page-title">Collections</h1><p class="page-subtitle">Available test collections</p>'+skeleton(4)+'</div>';
      try {
        const suites=await api('/api/suites');
        const list=suites.suites||[];
        const layers={};
        for(const s of list){if(!layers[s.layer])layers[s.layer]=[];layers[s.layer].push(s);}
        let html='<div class="page"><h1 class="page-title">Collections</h1><p class="page-subtitle">'+list.length+' suites across '+Object.keys(layers).length+' layers</p>';
        for(const [layer,items] of Object.entries(layers)){
          html+='<div class="card"><h3><span class="layer-tag">'+layer+'</span> '+items.length+' suites</h3>';
          for(const s of items){html+='<div class="test-row"><span>'+s.name+'</span><span class="pass-rate '+prc(s.avgPassRate)+'">'+(s.avgPassRate*100).toFixed(1)+'%</span></div>';}
          html+='</div>';
        }
        html+='</div>';app.innerHTML=html;
      } catch(e){app.innerHTML='<div class="page"><div class="empty">Failed: '+e.message+'</div></div>';}
    }

    async function pageCoverage() {
      app.innerHTML='<div class="page"><h1 class="page-title">Coverage</h1><p class="page-subtitle">Test coverage matrix across all components</p>'+skeleton(6)+'</div>';
      try {
        const data=await api('/api/coverage');
        if(data.error){app.innerHTML='<div class="page"><h1 class="page-title">Coverage</h1><div class="empty"><div class="empty-icon">\\u25A3</div>'+data.error+'</div></div>';return;}
        let html='<div class="page"><h1 class="page-title">Coverage</h1><p class="page-subtitle">Test coverage for '+data.pluginName+'</p>';
        html+='<div class="stat-cards">';
        const dp=data.depthPercent||0;
        html+='<div class="stat-card"><div class="label">Depth Coverage</div><div class="value pass-rate '+prc(dp/100)+'">'+dp+'%</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">'+(data.slotsFilled||0)+'/'+(data.slotsTotal||0)+' test slots</div>'+scoreBar(dp/100)+'</div>';
        html+='<div class="stat-card"><div class="label">Components</div><div class="value pass-rate '+prc(data.coveragePercent/100)+'">'+data.coveragePercent+'%</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">'+data.coveredComponents+'/'+data.totalComponents+' covered</div>'+scoreBar(data.coveragePercent/100)+'</div>';
        const bt=data.byType||{};
        for(const [type,d] of Object.entries(bt)){if(d.total>0){html+='<div class="stat-card"><div class="label">'+type.charAt(0).toUpperCase()+type.slice(1)+'</div><div class="value">'+d.covered+'/'+d.total+'</div>'+scoreBar(d.percent/100)+'</div>';}}
        html+='</div>';

        const layers=['unit','integration','llm','performance','security','static'];
        const layerH=['unit','integ','llm','perf','sec','static'];
        html+='<div class="card"><h3>Coverage Matrix</h3><div style="overflow-x:auto"><table><thead><tr><th>Component</th><th>Type</th>';
        for(const lh of layerH) html+='<th style="text-align:center">'+lh+'</th>';
        html+='</tr></thead><tbody>';
        const comps=data.components||[];
        for(const c of comps){
          html+='<tr><td>'+c.name+'</td><td><span class="layer-tag">'+c.type+'</span></td>';
          for(const l of layers){
            const notApplicable=c.type!=='tool'&&(l==='unit'||l==='integration'||l==='performance');
            const val=c.layers[l];
            html+='<td style="text-align:center">'+(notApplicable?'<span style="color:var(--text-dim)">\\u2014</span>':val?'<span style="color:var(--green)">\\u2713</span>':'<span style="color:var(--red)">\\u00B7</span>')+'</td>';
          }
          html+='</tr>';
        }
        html+='</tbody></table></div></div>';

        const gaps=data.gaps||[];
        if(gaps.length>0){
          html+='<div class="card"><h3>Gaps ('+gaps.length+')</h3>';
          for(const g of gaps.slice(0,50)){
            const sev=g.severity;
            const col=sev==='critical'?'var(--red)':sev==='high'?'var(--orange)':sev==='medium'?'var(--yellow)':'var(--text-dim)';
            html+='<div class="test-row"><span style="color:'+col+';font-weight:600">'+sev.toUpperCase()+'</span><span>'+g.message+'</span></div>';
          }
          if(gaps.length>50) html+='<div style="color:var(--text-muted);padding:8px 0;font-size:13px">...and '+(gaps.length-50)+' more</div>';
          html+='</div>';
        }

        html+='</div>';
        app.innerHTML=html;
      } catch(e){app.innerHTML='<div class="page"><div class="empty">Failed to load coverage: '+e.message+'</div></div>';}
    }

    function pageLive() {
      app.innerHTML='<div class="page"><h1 class="page-title">Live Feed</h1><p class="page-subtitle">Real-time evaluation events via SSE</p><div class="card"><div id="live-feed" class="event-feed"><div class="event-line event-info"><span>Connecting...</span></div></div></div></div>';
      if(sseSource){sseSource.close();}
      sseSource=new EventSource('/api/events');
      const feed=document.getElementById('live-feed');
      fetch('/api/events/history').then(r=>r.json()).then(data=>{
        if(data.events&&data.events.length){
          feed.innerHTML='';
          for(const evt of data.events){appendEvent(feed,evt);}
          feed.scrollTop=feed.scrollHeight;
        }
      }).catch(()=>{});
      sseSource.onmessage=function(e){
        if(!e.data)return;
        try{const evt=JSON.parse(e.data);appendEvent(feed,evt);feed.scrollTop=feed.scrollHeight;}catch{}
      };
      sseSource.onerror=function(){
        const line=document.createElement('div');line.className='event-line event-fail';line.innerHTML='<span>Connection lost. Reconnecting...</span>';
        if(feed)feed.appendChild(line);
      };
    }

    function appendEvent(feed,evt) {
      const line=document.createElement('div');line.className='event-line';
      const time=evt.timestamp?new Date(evt.timestamp).toLocaleTimeString():'';
      if(evt.type==='test-pass'){line.className+=' event-pass';line.innerHTML='<span class="etime">'+time+'</span><span>\\u2713 '+evt.suite+' / '+evt.test+' ('+(evt.score*100).toFixed(0)+'%)</span>';}
      else if(evt.type==='test-fail'){line.className+=' event-fail';line.innerHTML='<span class="etime">'+time+'</span><span>\\u2717 '+evt.suite+' / '+evt.test+(evt.error?' \\u2014 '+evt.error:'')+'</span>';}
      else if(evt.type==='test-start'){line.className+=' event-info';line.innerHTML='<span class="etime">'+time+'</span><span>\\u25B6 '+evt.suite+' / '+evt.test+'</span>';}
      else if(evt.type==='suite-complete'){line.innerHTML='<span class="etime">'+time+'</span><span>\\u2014 Suite '+evt.suite+': '+evt.passed+' passed, '+evt.failed+' failed</span>';}
      else if(evt.type==='run-complete'){line.className+=' event-pass';line.innerHTML='<span class="etime">'+time+'</span><span>\\u2714 Run complete \\u2014 '+(evt.passRate*100).toFixed(1)+'% pass rate</span>';}
      else{line.className+=' event-info';line.innerHTML='<span class="etime">'+time+'</span><span>'+JSON.stringify(evt)+'</span>';}
      feed.appendChild(line);
    }

    async function pageLeaderboard() {
      app.innerHTML='<div class="page"><h1 class="page-title">Leaderboard</h1><p class="page-subtitle">Model rankings across all runs</p>'+skeleton(5)+'</div>';
      try {
        const data=await api('/api/leaderboard');
        const lb=data.leaderboard||[];
        if(!lb.length){app.innerHTML='<div class="page"><h1 class="page-title">Leaderboard</h1><div class="empty">No model data available.</div></div>';return;}
        let html='<div class="page"><h1 class="page-title">Leaderboard</h1><p class="page-subtitle">Model rankings by average score</p><table class="comp-table"><thead><tr><th>#</th><th>Model</th><th>Avg Score</th><th>Pass Rate</th><th>Tests</th><th>Avg Latency</th></tr></thead><tbody>';
        lb.forEach((m,i)=>{html+='<tr><td class="mono">'+(i+1)+'</td><td>'+m.model+'</td><td class="mono">'+(m.avgScore*100).toFixed(1)+'%</td><td class="pass-rate '+prc(m.passRate)+'">'+(m.passRate*100).toFixed(1)+'%</td><td class="mono">'+m.totalTests+'</td><td class="duration">'+fmtD(m.avgLatencyMs)+'</td></tr>';});
        html+='</tbody></table></div>';
        app.innerHTML=html;
      } catch(e){app.innerHTML='<div class="page"><div class="empty">Failed: '+e.message+'</div></div>';}
    }

    function pageSettings() {
      const isDark=document.documentElement.getAttribute('data-theme')!=='light';
      app.innerHTML='<div class="page"><h1 class="page-title">Settings</h1><p class="page-subtitle">Dashboard configuration</p>'+
        '<div class="card"><div class="settings-row"><div><div class="settings-label">Dark Mode</div><div class="settings-desc">Toggle between dark and light theme</div></div><div class="toggle-switch '+(isDark?'on':'')+'" id="theme-toggle" onclick="toggleTheme()"><div class="knob"></div></div></div>'+
        '<div class="settings-row"><div><div class="settings-label">Clear Cache</div><div class="settings-desc">Clear cached API responses</div></div><button style="background:var(--bg-surface);border:1px solid var(--border);color:var(--text);padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px" onclick="clearCacheAction()">Clear</button></div>'+
        '</div></div>';
    }

    window.toggleTheme=function(){
      const html=document.documentElement;
      const isLight=html.getAttribute('data-theme')==='light';
      html.setAttribute('data-theme',isLight?'dark':'light');
      localStorage.setItem('theme',isLight?'dark':'light');
      const tog=document.getElementById('theme-toggle');
      if(tog)tog.classList.toggle('on',isLight);
    };

    window.clearCacheAction=function(){
      Object.keys(cache).forEach(k=>delete cache[k]);
      const btn=event.target;btn.textContent='Cleared!';setTimeout(()=>{btn.textContent='Clear';},1500);
    };

    (function init(){
      const saved=localStorage.getItem('theme');
      if(saved)document.documentElement.setAttribute('data-theme',saved);
      router();
    })();
  </script>
</body>
</html>`;
}
