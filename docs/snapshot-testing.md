# Snapshot Testing

Capture and compare tool responses with configurable sanitizers to catch regressions.

## Usage

```typescript
import { SnapshotStore, defaultSanitizers } from 'cursor-plugin-evals';

const store = new SnapshotStore();

// Capture a baseline
store.update('cluster-health', toolResponse, [
  defaultSanitizers.timestamps,
  defaultSanitizers.uuids,
]);

// Compare against baseline
const result = store.match('cluster-health', newResponse, [
  defaultSanitizers.timestamps,
  defaultSanitizers.uuids,
]);

if (!result.matches) {
  console.log('Regression detected:', result.diff);
}
```

## Built-in Sanitizers

| Sanitizer | What it strips |
|-----------|---------------|
| `timestamps` | ISO 8601 dates → `[TIMESTAMP]` |
| `uuids` | UUID v4 strings → `[UUID]` |
| `numericIds` | Numeric fields ending in `id` → `[ID]` |

## Custom Sanitizers

```typescript
const stripTokens: Sanitizer = (obj) => {
  const copy = { ...obj };
  delete copy.access_token;
  delete copy.refresh_token;
  return copy;
};

store.update('auth-response', response, [stripTokens]);
```

## Persistence

```typescript
// Save snapshots to disk
const json = store.toJSON();
fs.writeFileSync('snapshots.json', JSON.stringify(json));

// Load from disk
const loaded = JSON.parse(fs.readFileSync('snapshots.json', 'utf-8'));
store.loadFromJSON(loaded);
```
