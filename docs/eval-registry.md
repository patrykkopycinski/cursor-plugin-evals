# Community Eval Registry

Browse, pull, and share evaluation suites through a community registry.

## CLI Usage

```bash
# List available suites
cursor-plugin-evals registry list

# Download a suite into collections/
cursor-plugin-evals registry pull filesystem-basics

# Download to a custom directory
cursor-plugin-evals registry pull elasticsearch-smoke -o ./my-collections

# Package a local suite for submission
cursor-plugin-evals registry push --suite ./suites/my-suite.yaml
```

## Registry JSON Format

The registry is a JSON manifest hosted on GitHub:

```json
{
  "version": 1,
  "suites": [
    {
      "name": "filesystem-basics",
      "description": "Basic file read/write/list integration tests",
      "version": "1.0.0",
      "author": "community",
      "layer": "integration",
      "url": "https://raw.githubusercontent.com/.../filesystem-basics.yaml"
    }
  ]
}
```

Each entry contains a `url` pointing to the raw YAML suite file.

## How Pulled Suites Integrate

Downloaded suites are saved to `collections/` (or a custom directory). Reference them in your config using the `collection` key:

```yaml
plugin:
  name: my-plugin
  dir: ./my-plugin

suites:
  # Inline suites
  - name: my-custom-tests
    layer: unit
    tests:
      - name: tools-register
        check: registration

  # Pulled community suite
  - collection: filesystem-basics
```

The `collection` value resolves to `collections/<name>.yaml` relative to the config file. The suite is loaded and merged into the evaluation run alongside inline suites.

## Packaging a Suite

`registry push` reads your suite YAML and outputs a registry entry JSON. Fill in `author`, `description`, and `url` (pointing to the hosted YAML), then add the entry to `registry.json`.

## Programmatic API

```typescript
import { fetchRegistry, pullSuite, packageSuite } from 'cursor-plugin-evals';

// List all available suites
const entries = await fetchRegistry();
for (const e of entries) {
  console.log(`${e.name} v${e.version} [${e.layer}] — ${e.description}`);
}

// Download a suite
const entry = entries.find((e) => e.name === 'filesystem-basics')!;
const path = await pullSuite(entry, './collections');
console.log(`Downloaded to ${path}`);

// Package a local suite for registry submission
const meta = packageSuite('./suites/my-suite.yaml');
console.log(JSON.stringify(meta, null, 2));
```
