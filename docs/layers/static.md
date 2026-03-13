# Static Layer

Validate plugin structure, metadata, and naming conventions without starting the MCP server.

## What It Checks

Static checks analyze your plugin directory on disk. They verify that component files have correct frontmatter, the manifest is well-formed, hooks follow the expected schema, MCP server configs are valid, component references resolve, naming follows conventions, and components are coherent with each other.

## Available Checks

| Check | Description |
|-------|-------------|
| `manifest` | Plugin manifest (`plugin.json`) exists and has required fields (`name`, `description`) |
| `skill_frontmatter` | Each `SKILL.md` has valid YAML frontmatter with `description` |
| `rule_frontmatter` | Each rule `.mdc` file has valid frontmatter with `description` and `alwaysApply`/`globs` |
| `agent_frontmatter` | Each agent `.md` file has valid frontmatter with `name` and `description` |
| `command_frontmatter` | Each command `.md` file has valid frontmatter with `description` |
| `hooks_schema` | `hooks.json` entries have valid `event` and `handlers` with required `command` field |
| `mcp_config` | MCP server entries in `mcp.json` have `name` and either `command`/`args` or `url` |
| `component_references` | Cross-references between components (e.g. tool names in skills) resolve to real components |
| `cross_component_coherence` | Skills, rules, and agents don't have conflicting instructions or overlapping scopes |
| `naming_conventions` | File and directory names follow kebab-case conventions |

## YAML Config

```yaml
suites:
  - name: plugin-structure
    layer: static
    tests:
      - name: valid-manifest
        check: manifest

      - name: skill-metadata
        check: skill_frontmatter

      - name: rule-metadata
        check: rule_frontmatter

      - name: agent-metadata
        check: agent_frontmatter

      - name: command-metadata
        check: command_frontmatter

      - name: hooks-valid
        check: hooks_schema

      - name: mcp-config
        check: mcp_config

      - name: references-resolve
        check: component_references

      - name: coherence
        check: cross_component_coherence

      - name: naming
        check: naming_conventions
```

You can scope component checks to specific paths:

```yaml
      - name: specific-skills
        check: skill_frontmatter
        components:
          - skills/search
          - skills/create-index
```

## When to Use

- **Every PR** — static checks are fast (no server needed) and catch structural regressions
- **Before publishing** — verify all metadata is complete
- **In CI** — run as the first layer; fail fast before slower integration/LLM tests

## CLI Usage

```bash
# Run only static checks
cursor-plugin-evals run -l static

# Discover all components first
cursor-plugin-evals discover -d ./my-plugin
```

## Programmatic API

```typescript
import { runStaticSuite, discoverPlugin } from 'cursor-plugin-evals';
import type { SuiteConfig, PluginConfig } from 'cursor-plugin-evals';

const manifest = discoverPlugin('./my-plugin');
const suite: SuiteConfig = {
  name: 'structure',
  layer: 'static',
  tests: [
    { name: 'manifest', check: 'manifest' },
    { name: 'skills', check: 'skill_frontmatter' },
  ],
};

const results = await runStaticSuite(suite, { name: 'my-plugin', dir: './my-plugin' }, manifest);
for (const r of results) {
  console.log(`${r.pass ? '✅' : '❌'} ${r.name}`);
}
```

## See Also

- [Configuration Reference](../configuration.md)
- [Unit Layer](./unit.md)
- [Evaluators](../evaluators.md)
