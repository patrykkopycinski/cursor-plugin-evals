# Dataset Management

Create, version, annotate, and export evaluation datasets for reproducible testing.

## Creating Datasets

```bash
cursor-plugin-evals dataset create my-search-tests --description "Search tool evaluation examples"
```

Datasets are stored in `.cursor-plugin-evals/datasets/` as JSON files.

## Adding Examples

Add examples via CLI with inline JSON or stdin:

```bash
# Inline JSON
cursor-plugin-evals dataset add my-search-tests \
  --json '{"input":{"prompt":"Find error logs"},"output":"Found 42 errors","metadata":{"difficulty":"simple"}}'

# From stdin (pipe from a file or script)
echo '{"input":{"prompt":"Create an index"},"output":"Index created"}' | \
  cursor-plugin-evals dataset add my-search-tests
```

## Versioning

Create immutable version snapshots:

```bash
cursor-plugin-evals dataset version my-search-tests
```

Each version captures the current examples. Previous versions are preserved, allowing you to compare evaluator scores across dataset versions.

## Annotations

Annotate examples programmatically with evaluator feedback, human labels, or metadata:

```typescript
import { annotateExample } from 'cursor-plugin-evals';

await annotateExample('my-search-tests', 0, {
  humanLabel: 'correct',
  evaluatorScore: 0.95,
  notes: 'Good example of simple search query',
});
```

## Listing Datasets

```bash
cursor-plugin-evals dataset list
```

Output:

```
  my-search-tests          v2   15 examples  Search tool evaluation examples
  create-index-tests       v1    8 examples  Index creation scenarios
```

## Exporting to YAML

Export a dataset as a YAML test suite:

```bash
# Print to stdout
cursor-plugin-evals dataset export my-search-tests

# Write to file
cursor-plugin-evals dataset export my-search-tests -o search-suite.yaml
```

The exported YAML can be referenced directly in `plugin-eval.yaml`.

## CLI Reference

| Command | Description |
|---------|-------------|
| `dataset create <name>` | Create a new dataset |
| `dataset list` | List all datasets with version and example counts |
| `dataset add <name>` | Add an example (via `--json` or stdin) |
| `dataset version <name>` | Create a version snapshot |
| `dataset export <name>` | Export as YAML suite format |

## Programmatic API

```typescript
import {
  createDataset, listDatasets, addExample,
  versionDataset, exportToYaml, annotateExample,
} from 'cursor-plugin-evals';
import type { DatasetFile, DatasetExample, DatasetMeta } from 'cursor-plugin-evals';

// Create
const ds: DatasetFile = await createDataset('my-tests', 'Test dataset');
console.log(`Created: ${ds.name} v${ds.version}`);

// Add examples
await addExample('my-tests', {
  input: { prompt: 'Search for errors' },
  output: 'Found 10 errors in the last hour',
  metadata: { difficulty: 'simple', tags: ['search'] },
});

await addExample('my-tests', {
  input: { prompt: 'Create a dashboard' },
  output: 'Dashboard created with 3 panels',
  metadata: { difficulty: 'complex', tags: ['visualization'] },
});

// Annotate
await annotateExample('my-tests', 0, { humanLabel: 'correct' });

// Version
const snapshot = await versionDataset('my-tests');
console.log(`Versioned: v${snapshot.version}`);

// List
const datasets: DatasetMeta[] = await listDatasets();
for (const d of datasets) {
  console.log(`${d.name} v${d.version} — ${d.exampleCount} examples`);
}

// Export
const yaml: string = await exportToYaml('my-tests');
console.log(yaml);
```

## See Also

- [Skill Eval Layer](./layers/skill.md)
- [Trace Ingestion](./trace-import.md)
- [Configuration Reference](./configuration.md)
