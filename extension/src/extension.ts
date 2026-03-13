import * as vscode from 'vscode';
import { EvalCodeLensProvider } from './codelens';
import { StatusBarController } from './statusbar';
import { EvalTreeDataProvider } from './treeview';
import { registerCommands } from './commands';

let statusBar: StatusBarController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return;
  }

  const resultsDir = vscode.Uri.joinPath(
    vscode.Uri.file(workspaceRoot),
    '.cursor-plugin-evals'
  ).fsPath;

  const codeLensProvider = new EvalCodeLensProvider(resultsDir);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { pattern: '**/plugin-eval.yaml' },
      codeLensProvider
    )
  );

  statusBar = new StatusBarController(resultsDir);
  context.subscriptions.push(statusBar);

  const treeProvider = new EvalTreeDataProvider(resultsDir);
  context.subscriptions.push(
    vscode.window.createTreeView('pluginEvals.results', {
      treeDataProvider: treeProvider,
    })
  );

  registerCommands(context, workspaceRoot, treeProvider);

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(resultsDir, '**/*.json')
  );
  watcher.onDidChange(() => {
    codeLensProvider.refresh();
    statusBar?.refresh();
    treeProvider.refresh();
  });
  watcher.onDidCreate(() => {
    codeLensProvider.refresh();
    statusBar?.refresh();
    treeProvider.refresh();
  });
  context.subscriptions.push(watcher);
}

export function deactivate(): void {
  statusBar?.dispose();
  statusBar = undefined;
}
