# Cursor Extension: Plugin Evals

A VS Code / Cursor extension that surfaces `cursor-plugin-evals` results directly in your editor — CodeLens annotations, a status bar score, a tree view of results, and commands to trigger runs.

## Status

**Scaffold** — the extension compiles and defines all contribution points, but is not yet published. Use it as a starting point for local development.

## Features

### CodeLens in `plugin-eval.yaml`

Above each suite definition you'll see:
- **Run Eval** — click to run that suite in a terminal
- **Last: X%** — shows the pass rate from the most recent run

### Status Bar

A persistent status bar item shows the overall quality grade:

```
$(beaker) Plugin Eval: A (96%)
```

Click it to open the HTML report dashboard. Updates automatically when results change or files are saved.

### Tree View (Activity Bar)

An activity bar panel titled **Plugin Evals** displays a hierarchical view:

```
📦 Suites
  ├── ✅ tool-schema-validation
  │   ├── ✅ valid JSON schema for all tools
  │   └── ✅ required fields present
  ├── ❌ search-tool-integration
  │   ├── ✅ returns results for valid query
  │   └── ❌ handles empty query (score: 45%)
```

### Commands

| Command | Description |
|---|---|
| `Plugin Eval: Run All` | Run the full eval suite in a terminal |
| `Plugin Eval: Run Suite` | Pick a specific suite via QuickPick, then run it |
| `Plugin Eval: Show Dashboard` | Open the HTML report or launch the dashboard server |

## Setup

### Prerequisites

- Node.js >= 20
- `cursor-plugin-evals` installed in your project (`npm install cursor-plugin-evals`)
- A `plugin-eval.yaml` config file in your workspace root

### Build the Extension

```bash
cd extension
npm install
npm run build
```

### Run in Development

1. Open the `extension/` folder in VS Code / Cursor
2. Press `F5` to launch the Extension Development Host
3. Open a workspace that contains a `plugin-eval.yaml` file
4. The extension activates automatically

### Watch Mode

```bash
cd extension
npm run watch
```

This recompiles on every change so you can just reload the Extension Development Host (`Cmd+Shift+P` > `Developer: Reload Window`).

## Project Structure

```
extension/
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript config (CJS for VS Code)
├── src/
│   ├── extension.ts      # Activation / deactivation entry point
│   ├── codelens.ts       # CodeLens provider for plugin-eval.yaml
│   ├── statusbar.ts      # Status bar quality score
│   ├── treeview.ts       # Tree view of suites > tests > evaluators
│   └── commands.ts       # Command registrations (run, suite pick, dashboard)
└── dist/                 # Compiled output (gitignored)
```

## Data Format

The extension reads from `.cursor-plugin-evals/latest-run.json`, which has this shape:

```json
{
  "overall": {
    "score": 96,
    "passRate": 98.5,
    "grade": "A"
  },
  "suites": [
    {
      "name": "tool-schema-validation",
      "passed": true,
      "tests": [
        {
          "name": "valid JSON schema for all tools",
          "passed": true,
          "evaluators": [
            {
              "name": "schema-valid",
              "passed": true,
              "score": 1.0
            }
          ]
        }
      ]
    }
  ]
}
```

## Publishing

When ready to publish:

1. Install `vsce`: `npm install -g @vscode/vsce`
2. Package: `vsce package`
3. Publish: `vsce publish`

For Cursor-specific distribution, follow the Cursor plugin marketplace guidelines.
