import { describe, it, expect } from 'vitest';

let html = '';

describe('dashboard SPA HTML', () => {
  it('dashboardHtml() returns valid HTML via createApp', async () => {
    const { createApp } = await import('./server.js');
    const { app } = createApp(':memory:');
    const res = await app.request('/');
    html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('contains all 12 navigation links', () => {
    const navLinks = [
      '#/',
      '#/runs',
      '#/suites',
      '#/trends',
      '#/comparison',
      '#/leaderboard',
      '#/security',
      '#/conformance',
      '#/collections',
      '#/live',
      '#/settings',
    ];
    for (const link of navLinks) {
      expect(html).toContain(`href="${link}"`);
    }
    expect(html).toContain('data-nav');
  });

  it('contains API fetch calls', () => {
    expect(html).toContain("'/api/stats'");
    expect(html).toContain("'/api/runs'");
    expect(html).toContain("'/api/trends'");
    expect(html).toContain("'/api/suites'");
    expect(html).toContain("'/api/leaderboard'");
    expect(html).toContain("'/api/events'");
    expect(html).toContain("'/api/events/history'");
    expect(html).toContain("'/api/runs/'+");
  });

  it('contains theme toggle', () => {
    expect(html).toContain('data-theme');
    expect(html).toContain('toggleTheme');
    expect(html).toContain('theme-toggle');
    expect(html).toContain("localStorage.setItem('theme'");
    expect(html).toContain("localStorage.getItem('theme')");
  });

  it('contains hash router', () => {
    expect(html).toContain('hashchange');
    expect(html).toContain('location.hash');
    expect(html).toContain('routes');
    expect(html).toContain('router()');
  });

  it('has dark mode as default', () => {
    expect(html).toContain('data-theme="dark"');
  });

  it('contains sidebar with 260px width', () => {
    expect(html).toContain('sidebar');
    expect(html).toContain('--sidebar-w: 260px');
  });

  it('contains responsive mobile support', () => {
    expect(html).toContain('mobile-toggle');
    expect(html).toContain('@media');
    expect(html).toContain('max-width: 768px');
  });

  it('contains grade badges', () => {
    expect(html).toContain('grade-A');
    expect(html).toContain('grade-B');
    expect(html).toContain('grade-C');
    expect(html).toContain('grade-D');
    expect(html).toContain('grade-F');
  });

  it('contains score bars with animated fill', () => {
    expect(html).toContain('score-bar');
    expect(html).toContain('score-bar-fill');
    expect(html).toContain('transition: width');
  });

  it('contains sparkline SVG generation', () => {
    expect(html).toContain('sparkline');
    expect(html).toContain('sparkGrad');
  });

  it('contains skeleton loading states', () => {
    expect(html).toContain('skeleton');
    expect(html).toContain('shimmer');
  });

  it('contains keyboard shortcut for Escape', () => {
    expect(html).toContain("e.key==='Escape'");
  });

  it('contains SSE EventSource connection', () => {
    expect(html).toContain('EventSource');
    expect(html).toContain('/api/events');
  });
});

describe('dashboard API endpoints', () => {
  it('/api/stats returns correct shape', async () => {
    const { createApp } = await import('./server.js');
    const { app } = createApp(':memory:');
    const res = await app.request('/api/stats');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('totalRuns');
    expect(data).toHaveProperty('avgPassRate');
    expect(data).toHaveProperty('latestGrade');
    expect(data).toHaveProperty('totalTests');
  });

  it('/api/suites returns correct shape', async () => {
    const { createApp } = await import('./server.js');
    const { app } = createApp(':memory:');
    const res = await app.request('/api/suites');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('suites');
    expect(Array.isArray(data.suites)).toBe(true);
  });

  it('/api/leaderboard returns correct shape', async () => {
    const { createApp } = await import('./server.js');
    const { app } = createApp(':memory:');
    const res = await app.request('/api/leaderboard');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('leaderboard');
    expect(Array.isArray(data.leaderboard)).toBe(true);
  });
});
