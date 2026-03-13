import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EvalTreeDataProvider } from './treeview';

interface SuiteEntry {
  name: string;
}

interface RunResults {
  suites?: SuiteEntry[];
}

export function registerCommands(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  treeProvider: EvalTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cursorPluginEvals.runAll',
      () => runAll(workspaceRoot, treeProvider)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cursorPluginEvals.runSuite',
      (suiteName?: string) =>
        runSuite(workspaceRoot, treeProvider, suiteName)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cursorPluginEvals.showDashboard',
      () => showDashboard(workspaceRoot)
    )
  );
}

function runAll(
  workspaceRoot: string,
  treeProvider: EvalTreeDataProvider
): void {
  const terminal = vscode.window.createTerminal({
    name: 'Plugin Eval: All',
    cwd: workspaceRoot,
  });
  terminal.show();
  terminal.sendText('npx cursor-plugin-evals run');

  const watcher = vscode.window.onDidCloseTerminal((closed) => {
    if (closed === terminal) {
      treeProvider.refresh();
      watcher.dispose();
    }
  });
}

async function runSuite(
  workspaceRoot: string,
  treeProvider: EvalTreeDataProvider,
  suiteName?: string
): Promise<void> {
  let selected = suiteName;

  if (!selected) {
    const suites = loadSuiteNames(workspaceRoot);
    if (suites.length === 0) {
      vscode.window.showWarningMessage(
        'No eval suites found. Run all evals first.'
      );
      return;
    }

    selected = await vscode.window.showQuickPick(suites, {
      placeHolder: 'Select a suite to run',
    });
  }

  if (!selected) return;

  const terminal = vscode.window.createTerminal({
    name: `Plugin Eval: ${selected}`,
    cwd: workspaceRoot,
  });
  terminal.show();
  terminal.sendText(`npx cursor-plugin-evals run --suite "${selected}"`);

  const watcher = vscode.window.onDidCloseTerminal((closed) => {
    if (closed === terminal) {
      treeProvider.refresh();
      watcher.dispose();
    }
  });
}

function showDashboard(workspaceRoot: string): void {
  const reportPath = path.join(
    workspaceRoot,
    '.cursor-plugin-evals',
    'report.html'
  );

  if (fs.existsSync(reportPath)) {
    const uri = vscode.Uri.file(reportPath);
    vscode.env.openExternal(uri);
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: 'Plugin Eval: Dashboard',
    cwd: workspaceRoot,
  });
  terminal.show();
  terminal.sendText('npx cursor-plugin-evals dashboard');
}

function loadSuiteNames(workspaceRoot: string): string[] {
  const filePath = path.join(
    workspaceRoot,
    '.cursor-plugin-evals',
    'latest-run.json'
  );
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const results = JSON.parse(raw) as RunResults;
    return results.suites?.map((s) => s.name) ?? [];
  } catch {
    return [];
  }
}
