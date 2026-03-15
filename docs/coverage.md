# Coverage Analysis

Static analysis of your plugin's evaluation coverage. Parses the plugin manifest and `plugin-eval.yaml` config to produce a coverage matrix showing which test layers cover each component — without running any evals.

## Coverage Metrics

The coverage system tracks two complementary metrics:

**Component Coverage** — the percentage of plugin components (tools, skills, rules, agents, commands) that have at least one test of any kind. A component either has a test or it does not; this is a binary measure.

**Depth Coverage** — the percentage of applicable test slots that are filled. Each component type has a different number of applicable layers:

| Component | Applicable Layers | Slots |
|-----------|-------------------|-------|
| Tools     | unit, integration, llm, performance, security, static | 6 |
| Skills    | static, llm, security | 3 |
| Rules     | static | 1 |
| Agents    | static, llm | 2 |
| Commands  | static, llm | 2 |

A plugin with 100% component coverage but 50% depth coverage has tests for every component, but many layer slots remain unfilled.

## CLI Usage

```bash
# Terminal matrix (default)
npx cursor-plugin-evals coverage

# Markdown report
npx cursor-plugin-evals coverage --report markdown

# JSON for CI/automation
npx cursor-plugin-evals coverage --report json

# SVG badge for README
npx cursor-plugin-evals coverage --report badge -o badges/coverage.svg

# Write to file
npx cursor-plugin-evals coverage --report markdown -o coverage-report.md
```

### Report Formats

| Format     | Flag                  | Use Case |
|------------|-----------------------|----------|
| `terminal` | `--report terminal`   | Local development, quick inspection (default) |
| `markdown` | `--report markdown`   | Documentation, PR descriptions |
| `json`     | `--report json`       | CI pipelines, automation, custom tooling |
| `badge`    | `--report badge`      | README badges, status pages |

Use `-o <path>` with any format to write output to a file instead of stdout.

## Terminal Output

```
Coverage Matrix — elastic-developer-experience

Component Coverage: 100% (62/62 have tests)
Depth Coverage:     54% (148/273 applicable test slots filled)

                                  unit   integ     llm    perf     sec  static
elasticsearch_api                    ✓       ✓       ✓       ✓       ·       ✓    ( 83%)
esql_query                           ✓       ✓       ✓       ✓       ·       ✓    ( 83%)
discover_data                        ✓       ✓       ✓       ✓       ·       ✓    ( 83%)
...

Legend: ✓ = covered, · = missing, ✗ = not applicable

Summary: 37/37 tools | 10/10 skills | 9/9 rules | 2/2 agents | 4/4 commands
Gaps: 51 critical, 32 high, 14 medium, 28 low
```

Each row shows a single component with its coverage across all applicable layers. The percentage at the end of each row is that component's individual depth coverage.

## Gap Severity

Gaps are classified by how critical the missing coverage is:

| Severity     | Description |
|--------------|-------------|
| **critical** | Missing security tests for tools |
| **high**     | Missing integration or LLM tests for tools |
| **medium**   | Missing unit tests, frontmatter validation, activation tests |
| **low**      | Missing performance tests, negative activation tests |

The gap list is sorted by severity. Focus on eliminating critical and high gaps first — these represent the most impactful blind spots in your test suite.

## SVG Badge

Generate an SVG badge showing the depth coverage percentage:

```bash
npx cursor-plugin-evals coverage --report badge -o badges/coverage.svg
```

The badge color reflects the coverage level:

| Coverage   | Color        |
|------------|--------------|
| < 25%      | Red          |
| 25% – 49%  | Orange       |
| 50% – 74%  | Yellow       |
| 75% – 89%  | Green        |
| >= 90%     | Bright green |

Embed it in your README:

```markdown
![Coverage](badges/coverage.svg)
```

## Dashboard

The coverage matrix is also available in the web dashboard at `#/coverage`, with an interactive view that lets you filter by component type and sort by coverage depth.

![Coverage dashboard page](screenshots/dashboard-coverage.png)

## Programmatic API

```typescript
import {
  analyzeCoverage,
  formatCoverageTerminal,
  formatCoverageMarkdown,
  generateCoverageBadge,
} from 'cursor-plugin-evals';

const report = analyzeCoverage('/path/to/plugin', '/path/to/plugin-eval.yaml');

// Terminal-formatted matrix
console.log(formatCoverageTerminal(report));

// Markdown-formatted report
console.log(formatCoverageMarkdown(report));

// SVG badge string
const svg = generateCoverageBadge(report);

// Inspect the report directly
console.log(report.coveragePercent); // 100
console.log(report.depthPercent);     // 54
console.log(report.gaps.length);      // 125
```

### `analyzeCoverage(pluginDir, evalConfigPath)`

Returns a `CoverageReport` with the following structure:

| Field              | Type               | Description |
|--------------------|--------------------|-------------|
| `pluginName`       | `string`           | Name from the plugin manifest |
| `coveragePercent`  | `number`           | Component coverage (0-100) |
| `depthPercent`     | `number`           | Depth coverage (0–100) |
| `components`       | `ComponentEntry[]` | Per-component layer matrix |
| `gaps`             | `Gap[]`            | Missing coverage with severity |
| `summary`          | `Summary`          | Counts by component type |

Each `Gap` entry includes:

| Field       | Type     | Description |
|-------------|----------|-------------|
| `component` | `string` | Component name |
| `layer`     | `string` | Missing test layer |
| `severity`  | `string` | `critical`, `high`, `medium`, or `low` |
