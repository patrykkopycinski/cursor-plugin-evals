import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface RunResults {
  overall?: { score?: number; passRate?: number; grade?: string };
}

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly resultsDir: string) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'cursorPluginEvals.showDashboard';
    this.item.tooltip = 'Click to open Plugin Eval Dashboard';
    this.disposables.push(this.item);

    this.refresh();
    this.item.show();

    const saveWatcher = vscode.workspace.onDidSaveTextDocument(() =>
      this.refresh()
    );
    this.disposables.push(saveWatcher);
  }

  refresh(): void {
    const results = this.loadResults();
    if (!results?.overall) {
      this.item.text = '$(beaker) Plugin Eval: --';
      return;
    }

    const { score, grade } = results.overall;
    const label = grade ?? this.scoreToGrade(score);
    const pct = score !== undefined ? `${Math.round(score)}%` : '--';
    this.item.text = `$(beaker) Plugin Eval: ${label} (${pct})`;

    if (score !== undefined) {
      this.item.backgroundColor =
        score >= 90
          ? undefined
          : new vscode.ThemeColor('statusBarItem.warningBackground');
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private scoreToGrade(score?: number): string {
    if (score === undefined) return '--';
    if (score >= 97) return 'A+';
    if (score >= 93) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 87) return 'B+';
    if (score >= 83) return 'B';
    if (score >= 80) return 'B-';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
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
