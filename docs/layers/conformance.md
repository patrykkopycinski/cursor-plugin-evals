# Conformance Layer

Validates your MCP server against the Model Context Protocol specification with 25 checks across 9 categories.

## How It Works

The conformance layer connects to your MCP server and runs protocol-level checks — no LLM or cluster needed. It verifies that your server correctly implements MCP initialization, tool listing, tool execution, resource handling, prompt handling, and error responses.

## Categories

| Category | Checks | Description |
|----------|--------|-------------|
| **Initialization** | 4 | Server responds, reports capabilities, provides serverInfo, handles re-init |
| **Tool Listing** | 3 | Returns arrays, valid schemas, stable results |
| **Tool Execution** | 3 | Valid responses, handles unknown tools, returns errors correctly |
| **Resource Listing** | 2 | Valid URI format, resource metadata |
| **Resource Access** | 2 | Content retrieval, error on missing resources |
| **Prompt Listing** | 2 | Valid prompt metadata, argument schemas |
| **Prompt Access** | 2 | Content retrieval, error handling |
| **Error Handling** | 4 | Invalid methods, malformed params, proper error codes |
| **Capability Negotiation** | 3 | Only declared capabilities exposed, version negotiation |

## Tier Scoring

Conformance results map to the official MCP SDK tiering:

| Tier | Pass Rate | Meaning |
|------|-----------|---------|
| **Tier 1** | 100% | Fully compliant — production ready |
| **Tier 2** | ≥ 80% | Commitment to full support — minor gaps |
| **Tier 3** | < 80% | Experimental — significant gaps |

## CLI Usage

```bash
# Run conformance checks
cursor-plugin-evals conformance --server "node dist/index.js"

# Filter to specific categories
cursor-plugin-evals conformance --category tool-listing --category tool-execution

# Use HTTP transport
cursor-plugin-evals conformance --url http://localhost:3000 --transport http
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--server <cmd>` | from config | Command to start the MCP server (stdio) |
| `--url <url>` | — | Server URL (for HTTP/SSE transports) |
| `--transport <type>` | `stdio` | Transport type |
| `--category <cats...>` | all | Filter to specific categories |
| `--report <format>` | `terminal` | Output format (terminal, json, markdown) |
| `-o, --output <path>` | — | Write report to file |

## YAML Config

```yaml
suites:
  - name: mcp-conformance
    layer: conformance
    tests:
      - name: full-spec
        check: all
      - name: tools-only
        check: tool-listing
      - name: error-handling
        check: error-handling
```

## Interpreting Results

```
Conformance Report — my-plugin
═══════════════════════════════

Tier: 1 (100% pass rate)

Category Results:
  ✅ initialization          4/4
  ✅ tool-listing            3/3
  ✅ tool-execution          3/3
  ✅ resource-listing        2/2
  ✅ resource-access         2/2
  ✅ prompt-listing          2/2
  ✅ prompt-access           2/2
  ✅ error-handling          4/4
  ✅ capability-negotiation  3/3

Total: 25/25 passed
```

## Programmatic API

```typescript
import { runConformanceChecks, formatConformanceReport } from 'cursor-plugin-evals';

const result = await runConformanceChecks({
  command: 'node',
  args: ['dist/index.js'],
  cwd: './my-plugin',
});

console.log(`Tier: ${result.tier}`);
console.log(`Pass rate: ${(result.passRate * 100).toFixed(0)}%`);
console.log(formatConformanceReport(result));
```

## See Also

- [Static Layer](./static.md) — structural checks without running the server
- [Unit Layer](./unit.md) — tool registration checks
- [Configuration Reference](../configuration.md)
