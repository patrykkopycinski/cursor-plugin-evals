import type { TraceViewData } from './trace-viewer.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function roleColor(role: string): string {
  switch (role) {
    case 'system':
      return 'var(--clr-system)';
    case 'user':
      return 'var(--clr-user)';
    case 'assistant':
      return 'var(--clr-assistant)';
    case 'tool':
      return 'var(--clr-tool)';
    default:
      return 'var(--clr-fg-muted)';
  }
}

function renderTurns(turns: TraceViewData['turns']): string {
  return turns
    .map((t, i) => {
      const toolCallsHtml = (t.toolCalls ?? [])
        .map(
          (tc) => `
        <details class="tool-call">
          <summary>
            <span class="tool-name">${escapeHtml(tc.tool)}</span>
            ${tc.latencyMs != null ? `<span class="latency">${tc.latencyMs.toFixed(0)}ms</span>` : ''}
          </summary>
          <div class="tool-detail">
            <div class="label">Arguments</div>
            <pre>${escapeHtml(JSON.stringify(tc.args, null, 2))}</pre>
            ${tc.result ? `<div class="label">Result</div><pre>${escapeHtml(tc.result)}</pre>` : ''}
          </div>
        </details>`,
        )
        .join('');

      return `
      <div class="turn" style="--role-color: ${roleColor(t.role)}">
        <div class="turn-header">
          <span class="role-badge">${escapeHtml(t.role)}</span>
          <span class="turn-idx">#${i + 1}</span>
        </div>
        <div class="turn-content">${escapeHtml(t.content)}</div>
        ${toolCallsHtml}
      </div>`;
    })
    .join('\n');
}

function renderEvaluators(results: TraceViewData['evaluatorResults']): string {
  if (results.length === 0) return '<p class="muted">No evaluator results</p>';

  return results
    .map(
      (r) => `
    <div class="eval-badge ${r.pass ? 'pass' : 'fail'}">
      <span class="eval-name">${escapeHtml(r.name)}</span>
      <span class="eval-score">${(r.score * 100).toFixed(0)}%</span>
      ${r.explanation ? `<span class="eval-explanation">${escapeHtml(r.explanation)}</span>` : ''}
    </div>`,
    )
    .join('\n');
}

function computeOverallScore(results: TraceViewData['evaluatorResults']): number {
  if (results.length === 0) return 1;
  return results.reduce((sum, r) => sum + r.score, 0) / results.length;
}

export function renderTraceHtml(data: TraceViewData): string {
  const overall = computeOverallScore(data.evaluatorResults);
  const overallPercent = (overall * 100).toFixed(0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trace: ${escapeHtml(data.testName)}</title>
<style>
:root {
  --clr-bg: #0f1117;
  --clr-surface: #1a1d27;
  --clr-surface-hover: #22263a;
  --clr-border: #2e3347;
  --clr-fg: #e4e6f0;
  --clr-fg-muted: #8b8fa3;
  --clr-system: #a78bfa;
  --clr-user: #60a5fa;
  --clr-assistant: #34d399;
  --clr-tool: #fbbf24;
  --clr-pass: #34d399;
  --clr-fail: #f87171;
  --radius: 8px;
}
@media (prefers-color-scheme: light) {
  :root {
    --clr-bg: #f8f9fc;
    --clr-surface: #ffffff;
    --clr-surface-hover: #f0f1f5;
    --clr-border: #dde0e9;
    --clr-fg: #1a1d27;
    --clr-fg-muted: #5f6380;
    --clr-system: #7c3aed;
    --clr-user: #2563eb;
    --clr-assistant: #059669;
    --clr-tool: #d97706;
    --clr-pass: #059669;
    --clr-fail: #dc2626;
  }
}
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--clr-bg);
  color: var(--clr-fg);
  line-height: 1.6;
}
.container { max-width: 860px; margin: 0 auto; }
header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--clr-border);
}
header h1 { margin: 0; font-size: 1.5rem; font-weight: 600; }
.meta { color: var(--clr-fg-muted); font-size: 0.85rem; }
.meta span + span::before { content: '·'; margin: 0 6px; }
.overall-score {
  margin-left: auto;
  font-size: 1.8rem;
  font-weight: 700;
  color: ${overall >= 0.7 ? 'var(--clr-pass)' : 'var(--clr-fail)'};
}
.section-title { font-size: 1.1rem; font-weight: 600; margin: 24px 0 12px; }
.turn {
  background: var(--clr-surface);
  border: 1px solid var(--clr-border);
  border-left: 3px solid var(--role-color);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 12px;
}
.turn-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.role-badge {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--role-color);
  background: color-mix(in srgb, var(--role-color) 12%, transparent);
}
.turn-idx { color: var(--clr-fg-muted); font-size: 0.8rem; }
.turn-content { white-space: pre-wrap; word-break: break-word; font-size: 0.92rem; }
.tool-call { margin-top: 10px; }
.tool-call summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  padding: 6px 10px;
  background: var(--clr-surface-hover);
  border-radius: 4px;
}
.tool-name { font-weight: 600; color: var(--clr-tool); }
.latency { color: var(--clr-fg-muted); font-size: 0.8rem; margin-left: auto; }
.tool-detail { padding: 10px 12px; }
.tool-detail .label { font-size: 0.75rem; text-transform: uppercase; color: var(--clr-fg-muted); margin: 8px 0 4px; }
.tool-detail pre {
  background: var(--clr-bg);
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.82rem;
  margin: 0;
}
.eval-badges { display: flex; flex-wrap: wrap; gap: 8px; }
.eval-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: var(--radius);
  font-size: 0.85rem;
  background: var(--clr-surface);
  border: 1px solid var(--clr-border);
}
.eval-badge.pass { border-color: var(--clr-pass); }
.eval-badge.fail { border-color: var(--clr-fail); }
.eval-name { font-weight: 600; }
.eval-score { font-weight: 700; }
.eval-badge.pass .eval-score { color: var(--clr-pass); }
.eval-badge.fail .eval-score { color: var(--clr-fail); }
.eval-explanation { color: var(--clr-fg-muted); font-size: 0.8rem; }
.token-summary {
  display: flex;
  gap: 24px;
  padding: 12px 16px;
  background: var(--clr-surface);
  border-radius: var(--radius);
  font-size: 0.85rem;
}
.token-summary .label { color: var(--clr-fg-muted); }
.muted { color: var(--clr-fg-muted); }
</style>
</head>
<body>
<div class="container">
  <header>
    <div>
      <h1>${escapeHtml(data.testName)}</h1>
      <div class="meta">
        <span>${escapeHtml(data.suiteName)}</span>
        ${data.model ? `<span>${escapeHtml(data.model)}</span>` : ''}
        <span>${data.totalLatencyMs.toFixed(0)}ms</span>
        <span>${escapeHtml(data.runId)}</span>
      </div>
    </div>
    <div class="overall-score">${overallPercent}%</div>
  </header>

  <div class="section-title">Timeline</div>
  ${renderTurns(data.turns)}

  <div class="section-title">Evaluators</div>
  <div class="eval-badges">
    ${renderEvaluators(data.evaluatorResults)}
  </div>

  ${
    data.tokenUsage
      ? `
  <div class="section-title">Token Usage</div>
  <div class="token-summary">
    <div><span class="label">Input:</span> ${data.tokenUsage.input.toLocaleString()}</div>
    <div><span class="label">Output:</span> ${data.tokenUsage.output.toLocaleString()}</div>
    <div><span class="label">Total:</span> ${(data.tokenUsage.input + data.tokenUsage.output).toLocaleString()}</div>
  </div>`
      : ''
  }
</div>
</body>
</html>`;
}
