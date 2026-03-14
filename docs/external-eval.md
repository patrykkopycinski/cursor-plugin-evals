# External Evaluation

Evaluate any Cursor plugin without committing eval files to the target repository. All configs, results, and infrastructure stay in a local workspace — only content improvements (skills, rules) are applied to the target.

## When to Use

- You want to evaluate a plugin in a repo you don't own or control
- The target repo hasn't officially adopted cursor-plugin-evals
- You want to run a one-off quality audit and open a PR with findings
- You need to evaluate a subset of a large plugin (e.g., only security skills)

## Workflow

### 1. Create a workspace

```bash
npx cursor-plugin-evals external-init \
  --external ~/Projects/target-plugin \
  --scope skills/security
```

This creates `workspaces/<plugin-name>/` in the framework repo:

```
workspaces/target-plugin-skills-security/
├── workspace.json       # Metadata: target path, scope, timestamps
├── plugin-eval.yaml     # Eval config pointing to the external repo
├── eval-results/        # Where results are stored locally
├── fixes/               # Staged content improvements
└── .gitignore
```

**Options:**

| Flag | Description |
|------|-------------|
| `--external <path>` | (Required) Path to the target plugin repository |
| `--scope <subdir>` | Subdirectory to scope evaluation to (e.g., `skills/security`) |
| `--output <path>` | Override workspace directory location |
| `--plugin-root <path>` | Plugin root relative to external dir |
| `--transport <type>` | Transport type (stdio, http, sse, streamable-http) |
| `--layers <layers...>` | Layers to generate (static, unit, integration, llm, skill) |

### 2. Run evals

```bash
npx cursor-plugin-evals run -c workspaces/target-plugin-skills-security/plugin-eval.yaml --verbose
```

Results are stored in `workspaces/<name>/eval-results/`, not the target repo.

### 3. Fix and iterate

The Framework Assistant works in external mode too. When activated, it:
- Writes all eval YAML changes to the workspace directory
- Saves content improvements (improved `SKILL.md`, `.mdc` files) to `workspaces/<name>/fixes/`
- Never writes eval infrastructure to the target repo

### 4. Apply fixes to the target

```bash
# Preview what would change
npx cursor-plugin-evals apply-fixes --workspace workspaces/target-plugin-skills-security --dry-run

# Apply skill/rule improvements
npx cursor-plugin-evals apply-fixes --workspace workspaces/target-plugin-skills-security
```

Only content files (`.md`, `.mdc`, `.yaml`) under the scoped directory are touched. Eval configs, Docker files, CI workflows, and test scripts are never written to the target.

### 5. Generate a PR findings report

```bash
npx cursor-plugin-evals pr-findings \
  --workspace workspaces/target-plugin-skills-security \
  -o FINDINGS.md
```

This produces a structured markdown report with:
- Summary statistics (total tests, pass rate, quality grade)
- Per-suite breakdown with scores
- Detailed failure analysis
- List of improvements applied

### 6. Open a PR

```bash
cd ~/Projects/target-plugin
git checkout -b eval/skill-improvements
git add skills/security/
gh pr create \
  --title "Improve security skills based on eval findings" \
  --body-file ~/Projects/cursor-plugin-evals/FINDINGS.md
```

The PR contains only skill/rule content changes — zero eval framework artifacts.

## What stays where

| Artifact | Location | Committed to target? |
|----------|----------|---------------------|
| `plugin-eval.yaml` | `workspaces/<name>/` | No |
| Eval results (JSON) | `workspaces/<name>/eval-results/` | No |
| `workspace.json` | `workspaces/<name>/` | No |
| Docker Compose | `workspaces/<name>/` | No |
| `.env.test` | `workspaces/<name>/` | No |
| Improved SKILL.md | target repo via `apply-fixes` | Yes (only these) |
| Improved .mdc rules | target repo via `apply-fixes` | Yes (only these) |
| FINDINGS.md | wherever you specify with `-o` | Your choice |

## Using with the Framework Assistant

Tell the assistant to use external mode:

```
Evaluate the security skills in ~/Projects/agent-skills-sandbox without committing evals to that repo
```

The assistant will:
1. Run `external-init` to create the workspace
2. Enhance the generated config with comprehensive tests
3. Run the convergence loop (run → fix → re-run)
4. Stage content improvements in `workspaces/<name>/fixes/`
5. Generate a findings report
6. Help you open the PR

## CLI Reference

```bash
# Create workspace
npx cursor-plugin-evals external-init --external <path> [--scope <subdir>] [--output <dir>]

# Run evals
npx cursor-plugin-evals run -c workspaces/<name>/plugin-eval.yaml

# Apply improvements
npx cursor-plugin-evals apply-fixes --workspace workspaces/<name> [--dry-run] [--target <path>]

# Generate PR report
npx cursor-plugin-evals pr-findings --workspace workspaces/<name> [-o <file>]
```
