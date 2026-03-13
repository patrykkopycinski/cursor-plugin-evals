import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface SuiteResult {
  name: string;
  score?: number;
  passRate?: number;
}

interface RunResults {
  overall?: { score?: number; passRate?: number };
  suites?: SuiteResult[];
}

export class EvalCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly resultsDir: string) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const results = this.loadResults();
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const suiteMatch = line.match(/^(\s*)- name:\s*['"]?(.+?)['"]?\s*$/);
      if (!suiteMatch) continue;

      const range = new vscode.Range(i, 0, i, line.length);

      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(play) Run Eval',
          command: 'cursorPluginEvals.runSuite',
          arguments: [suiteMatch[2]],
        })
      );

      const suiteResult = results?.suites?.find(
        (s) => s.name === suiteMatch[2]
      );
      if (suiteResult?.passRate !== undefined) {
        const pct = Math.round(suiteResult.passRate);
        lenses.push(
          new vscode.CodeLens(range, {
            title: `Last: ${pct}%`,
            command: 'cursorPluginEvals.showDashboard',
          })
        );
      }
    }

    return lenses;
  }

  private loadResults(): RunResults | undefined {
    const filePath = path.join(this.resultsDir, 'latest-run.json');
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as RunResults;
    } catch {
      return undefined;
    }
  }
}
