import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorPluginEvals.runSuite', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const terminal = vscode.window.createTerminal('Cursor Evals');
      terminal.sendText(`npx cursor-plugin-evals run --config ${editor.document.uri.fsPath}`);
      terminal.show();
    }),
    vscode.commands.registerCommand('cursorPluginEvals.runTest', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const line = editor.document.lineAt(editor.selection.active.line).text;
      const nameMatch = line.match(/name:\s*(.+)/);
      if (!nameMatch) { vscode.window.showWarningMessage('Place cursor on a test name line'); return; }
      const terminal = vscode.window.createTerminal('Cursor Evals');
      terminal.sendText(`npx cursor-plugin-evals run --config ${editor.document.uri.fsPath} --suite "${nameMatch[1].trim()}"`);
      terminal.show();
    }),
    vscode.commands.registerCommand('cursorPluginEvals.estimateCost', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const terminal = vscode.window.createTerminal('Cursor Evals');
      terminal.sendText(`npx cursor-plugin-evals run --config ${editor.document.uri.fsPath} --estimate-cost`);
      terminal.show();
    }),
  );
}

export function deactivate() {}
