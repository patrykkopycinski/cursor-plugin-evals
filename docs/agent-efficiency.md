# Agent Efficiency Evaluator

Detect inefficient agent behavior — loops, redundant calls, excessive retries, and step bloat. Pure CODE evaluator with zero LLM cost.

## Usage

```yaml
evaluators: [agent-efficiency]
expected:
  goldenPath: [search, analyze, respond]  # optional, enables step bloat detection
```

## Detection Patterns

### Redundant Calls (-0.1 each)
Same tool called with identical arguments multiple times.
```
search(q="logs") → search(q="logs") → search(q="logs")  # 2 redundant calls = -0.2
```

### Retry Bursts (-0.15 each)
Same tool called 3+ times in sequence (even with different args).
```
search(q="a") → search(q="b") → search(q="c") → search(q="d")  # 1 burst = -0.15
```

### Loop Detection (-0.3 each)
Repeating sequence of 2+ tool calls.
```
search → analyze → search → analyze → search → analyze  # loop detected = -0.3
```

### Step Bloat (-0.2)
Tool call count exceeds 2x the golden path length.
```
goldenPath: [search, respond]  # 2 steps
actual: 6 tool calls           # 6 > 2×2 = step bloat
```

### Idle Tools (-0.05 each)
Tool calls with latency exceeding the threshold (default 30s).

## Config

| Key | Default | Description |
|-----|---------|-------------|
| `threshold` | `0.5` | Pass threshold |
| `idleThresholdMs` | `30000` | Idle detection threshold (ms) |

## Metadata

Returns detailed metadata for debugging:
```json
{
  "redundantCalls": [{"tool": "search", "args": {"q": "logs"}, "indices": [0, 2]}],
  "retryBursts": [{"tool": "search", "startIndex": 0, "count": 4}],
  "loops": [{"sequence": ["search", "analyze"], "startIndex": 0, "repetitions": 3}],
  "stepBloat": true,
  "idleTools": [{"tool": "slow_query", "index": 3, "latencyMs": 45000}]
}
```
