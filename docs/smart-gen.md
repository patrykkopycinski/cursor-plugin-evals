# Smart Test Generation

Generate LLM-powered test cases with persona variants, multilingual prompts, and automatic edge case discovery.

## Standard vs Smart Mode

The `gen-tests` command has two modes:

| Mode | Flag | Description |
|------|------|-------------|
| Standard | *(default)* | Schema-walking generates tests from JSON Schema (valid, boundary, negative) |
| Smart | `--smart` | LLM generates realistic prompts with personas, languages, and edge cases |

Standard mode is deterministic and free. Smart mode requires an LLM API key but produces more realistic, diverse test cases.

## Persona Variants

Smart mode generates prompts as different user types:

| Persona | Behavior |
|---------|----------|
| `novice` | Simple language, vague descriptions, non-technical terms |
| `expert` | Precise technical terminology, references specific parameters |
| `adversarial` | Confusing inputs, misspellings, contradictory instructions |

```bash
cursor-plugin-evals gen-tests --smart --personas novice expert adversarial -o tests.yaml
```

Each persona produces different prompt phrasings for the same tool, testing robustness across user types.

## Multilingual Generation

Generate prompts in multiple languages:

```bash
cursor-plugin-evals gen-tests --smart --multilingual es de ja -o tests.yaml
```

Supported language codes: `es` (Spanish), `de` (German), `ja` (Japanese), `fr` (French), `pt` (Portuguese), `zh` (Chinese), `ko` (Korean), `it` (Italian), `ru` (Russian), `ar` (Arabic).

## Edge Case Discovery

With `--smart`, the LLM also generates edge case prompts that test:
- Empty or minimal input
- Very long input strings
- Special characters and Unicode
- Ambiguous requests that could match multiple tools
- Requests that require multiple tool calls

## CLI Usage

```bash
# Standard schema-based generation
cursor-plugin-evals gen-tests -o tests.yaml

# Single tool only
cursor-plugin-evals gen-tests --tool elasticsearch_api -o es-tests.yaml

# Smart mode with all features
cursor-plugin-evals gen-tests --smart \
  --personas novice expert adversarial \
  --multilingual es de ja \
  -o smart-tests.yaml
```

## Output Format

Generated tests are written as YAML suites:

```yaml
suites:
  - name: my-plugin-smart-tests
    layer: llm
    tests:
      - name: novice-search-0
        prompt: "How do I look for stuff in my data?"
        expected:
          tools: [elasticsearch_api]
        evaluators:
          - tool-selection
          - response-quality
        difficulty: simple

      - name: expert-search-0
        prompt: "Execute a bool query with must/should clauses against the logs-* index pattern"
        expected:
          tools: [elasticsearch_api]
        evaluators:
          - tool-selection
          - response-quality
        difficulty: moderate

      - name: multilingual-search-es-0
        prompt: "Buscar documentos sobre errores en el último hora"
        expected:
          tools: [elasticsearch_api]
        evaluators:
          - tool-selection
          - response-quality
        difficulty: simple

      - name: edge-case-0
        prompt: ""
        expected:
          tools: []
        evaluators:
          - response-quality
        difficulty: adversarial
```

## Programmatic API

```typescript
import { McpPluginClient, generateSmartTests, formatSmartTestsAsYaml } from 'cursor-plugin-evals';
import type { SmartGenConfig } from 'cursor-plugin-evals';

const client = await McpPluginClient.connect({ command: 'node', args: ['dist/index.js'] });
const tools = await client.listTools();

const config: SmartGenConfig = {
  tools: tools as any,
  count: 5,
  personas: ['novice', 'expert', 'adversarial'],
  multilingual: ['es', 'de'],
  edgeCases: true,
};

const tests = await generateSmartTests(config);
console.log(`Generated ${tests.length} test cases`);

for (const t of tests) {
  console.log(`[${t.category}] ${t.name}: "${t.prompt.slice(0, 60)}..." (${t.difficulty})`);
}

const yaml = formatSmartTestsAsYaml(tests, 'my-plugin');
console.log(yaml);

await client.disconnect();
```

## See Also

- [Test Auto-Generation](./gen-tests.md) — standard schema-based generation
- [LLM Eval Layer](./layers/llm.md)
- [Prompt Sensitivity](./prompt-sensitivity.md)
