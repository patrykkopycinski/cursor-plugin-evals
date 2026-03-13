import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface EvaluatorResult {
  name: string;
  passed: boolean;
  score?: number;
  message?: string;
}

interface TestResult {
  name: string;
  passed: boolean;
  evaluators?: EvaluatorResult[];
}

interface SuiteResult {
  name: string;
  passed: boolean;
  tests?: TestResult[];
}

interface RunResults {
  suites?: SuiteResult[];
}

type TreeItem = SuiteItem | TestItem | EvaluatorItem;

class SuiteItem extends vscode.TreeItem {
  constructor(public readonly suite: SuiteResult) {
    super(suite.name, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(
      suite.passed ? 'pass' : 'error',
      new vscode.ThemeColor(
        suite.passed
          ? 'testing.iconPassed'
          : 'testing.iconFailed'
      )
    );
    this.contextValue = 'suite';
  }
}

class TestItem extends vscode.TreeItem {
  constructor(public readonly test: TestResult) {
    super(
      test.name,
      test.evaluators?.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.iconPath = new vscode.ThemeIcon(
      test.passed ? 'pass' : 'error',
      new vscode.ThemeColor(
        test.passed
          ? 'testing.iconPassed'
          : 'testing.iconFailed'
      )
    );
    this.contextValue = 'test';
  }
}

class EvaluatorItem extends vscode.TreeItem {
  constructor(evaluator: EvaluatorResult) {
    super(evaluator.name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(
      evaluator.passed ? 'pass' : 'error',
      new vscode.ThemeColor(
        evaluator.passed
          ? 'testing.iconPassed'
          : 'testing.iconFailed'
      )
    );
    if (evaluator.message) {
      this.tooltip = evaluator.message;
    }
    if (evaluator.score !== undefined) {
      this.description = `${Math.round(evaluator.score * 100)}%`;
    }
    this.contextValue = 'evaluator';
  }
}

export class EvalTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private results: RunResults | undefined;

  constructor(private readonly resultsDir: string) {
    this.loadResults();
  }

  refresh(): void {
    this.loadResults();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      return (
        this.results?.suites?.map((s) => new SuiteItem(s)) ?? []
      );
    }

    if (element instanceof SuiteItem) {
      return (
        element.suite.tests?.map((t) => new TestItem(t)) ?? []
      );
    }

    if (element instanceof TestItem) {
      return (
        element.test.evaluators?.map((e) => new EvaluatorItem(e)) ?? []
      );
    }

    return [];
  }

  private loadResults(): void {
    const filePath = path.join(this.resultsDir, 'latest-run.json');
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      this.results = JSON.parse(raw) as RunResults;
    } catch {
      this.results = undefined;
    }
  }
}
