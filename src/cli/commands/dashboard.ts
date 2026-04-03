import { resolve } from 'node:path';
import type { Command } from 'commander';
import { DATA_DIR } from '../../core/constants.js';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { EXIT_FAIL, parsePositiveInt } from './helpers.js';

export function registerDashboardCommands(program: Command): void {
  program
    .command('dashboard')
    .description('Start the web dashboard to browse evaluation results')
    .option('-p, --port <port>', 'server port', parsePositiveInt, 6280)
    .option('--no-open', 'skip opening browser')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(async (opts: { port: number; open: boolean; verbose?: boolean; noColor?: boolean }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      const { resolve } = await import('path');
      const dbPath = resolve(process.cwd(), DATA_DIR, 'dashboard.db');
      const { createApp } = await import('../../dashboard/server.js');
      const { serve } = await import('@hono/node-server');

      const { app } = createApp(dbPath);
      const url = `http://localhost:${opts.port}`;

      log.header('Dashboard');
      log.info(`  Starting on ${url}`);

      serve({ fetch: app.fetch, port: opts.port }, async () => {
        log.success(`Dashboard running at ${url}`);

        if (opts.open) {
          try {
            const openModule = await import('open');
            await openModule.default(url);
          } catch (_e) {
            log.debug('Could not auto-open browser');
          }
        }
      });
    });

  program
    .command('dashboard-deploy')
    .description('Deploy eval results dashboard to Kibana (dashboard-as-code)')
    .requiredOption('--kibana-url <url>', 'Kibana URL (e.g., http://localhost:5601)')
    .option('--space <id>', 'Kibana space ID', 'default')
    .option('--username <user>', 'Kibana username')
    .option('--password <pass>', 'Kibana password')
    .option('--api-key <key>', 'Kibana API key')
    .option('--title <title>', 'Dashboard title', 'Plugin Eval Results')
    .option('--index-pattern <pattern>', 'Index pattern', 'traces-*')
    .option('--export-only', 'Export NDJSON to stdout instead of deploying')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        kibanaUrl: string;
        space: string;
        username?: string;
        password?: string;
        apiKey?: string;
        title: string;
        indexPattern: string;
        exportOnly?: boolean;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        const dashboardConfig = { title: opts.title, indexPattern: opts.indexPattern };

        if (opts.exportOnly) {
          const { buildDashboardNdjson } = await import('../../kibana/dashboard.js');
          console.log(buildDashboardNdjson(dashboardConfig));
          return;
        }

        log.header('Deploy Kibana Dashboard');

        try {
          const { deployDashboard } = await import('../../kibana/deploy.js');
          const result = await deployDashboard(
            {
              kibanaUrl: opts.kibanaUrl,
              spaceId: opts.space,
              username: opts.username,
              password: opts.password,
              apiKey: opts.apiKey,
            },
            dashboardConfig,
          );

          if (result.success) {
            log.success(`Dashboard deployed: ${result.url}`);
          } else {
            log.error('Dashboard deployment failed');
            process.exitCode = EXIT_FAIL;
          }
        } catch (err) {
          log.error('Dashboard deployment failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );
}
