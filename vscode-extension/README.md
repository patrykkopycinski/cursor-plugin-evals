# Cursor Plugin Evals — VS Code Extension

Syntax highlighting, snippets, and inline run commands for `plugin-eval.yaml` files.

## Features

- **Syntax highlighting** for eval keywords, evaluator names, and layer types
- **Snippets**: `suite`, `llm-test`, `int-test` — quick scaffolding
- **Commands**: Run Suite, Run Test, Estimate Cost from the palette

## Installation

```bash
cd vscode-extension
npm install && npm run compile
# Then use "Install from VSIX" in VS Code
```

## Commands

| Command | Description |
|---------|-------------|
| `Cursor Evals: Run Suite` | Run the current config file |
| `Cursor Evals: Run Test` | Run test at cursor position |
| `Cursor Evals: Estimate Cost` | Predict LLM costs |
