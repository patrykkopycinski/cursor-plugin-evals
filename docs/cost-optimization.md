# LLM Cost Optimization

Reduce LLM evaluation costs by 50-80% with automatic caching, smart model selection, call deduplication, and more.

## Judge Response Caching

Every `callJudge()` call is automatically cached to disk. Identical inputs (same model + system prompt + user prompt) return the cached response without an API call.

- **TTL:** 24 hours (re-runs within a day are free)
- **Storage:** `.cursor-plugin-evals/judge-cache/`
- **Disable:** Set `JUDGE_CACHE=false` or pass `cache: false` per request

```bash
# First run: all API calls are live
npx cursor-plugin-evals run

# Second run within 24h: judge calls served from cache
npx cursor-plugin-evals run  # near-instant, $0 judge cost
```

## Per-Evaluator Model Selection

Lightweight evaluators (keywords, similarity, response-quality, content-quality) automatically use a cheaper model (`gpt-5.2-mini` at $0.12/M input) instead of the default judge model.

| Tier | Evaluators | Default Model |
|------|-----------|---------------|
| **Lightweight** | keywords, similarity, response-quality, content-quality | `gpt-5.2-mini` |
| **Standard** | correctness, groundedness, security, plan-quality, etc. | Default judge model |

Override the lightweight model: `JUDGE_MODEL_LIGHTWEIGHT=gemini-2.0-flash`

## Call Deduplication

When multiple evaluators run concurrently on the same test and produce identical judge prompts, only one API call is made. The `DedupJudge` class automatically coalesces concurrent identical requests.

## Multi-Judge Panel Tiers

Instead of always running 3 expensive models, choose a tier:

| Tier | Models | Use Case |
|------|--------|----------|
| `fast` | 1 (gpt-5.2-mini) | Development, iteration |
| `balanced` | 2 (gpt-5.2 + gemini-2.5-flash) | CI, daily runs |
| `thorough` | 3 (gpt-5.2 + claude-opus + gemini-pro) | Pre-release, high-stakes |

```yaml
defaults:
  multi_judge_tier: balanced  # 2 judges instead of 3
```

## Cost Estimation

Predict costs before running:

```bash
npx cursor-plugin-evals run --estimate-cost
```

Output:
```
  Cost Estimate
  Judge calls: 45
  Estimated cost: $0.0234

  gpt-5.2: 30 calls (~$0.0192)
  gpt-5.2-mini: 15 calls (~$0.0042)
```

## Judge Fixture Recording

Record judge responses for fully offline replay:

```typescript
import { JudgeFixtureStore } from 'cursor-plugin-evals';

const store = new JudgeFixtureStore('.fixtures/judges');
await store.load();

// Record during live run
await store.record(request, response);
await store.flush();

// Replay in offline mode
const cached = await store.replay(request);
```

## Cost Impact Summary

| Feature | Savings | When |
|---------|---------|------|
| Judge caching | 90-100% on re-runs | Same tests within 24h |
| Per-evaluator models | 30-50% per run | Lightweight evaluators use cheap model |
| Call deduplication | 10-30% per run | Concurrent identical prompts |
| Panel tiers (fast) | 67% vs thorough | Development/iteration |
| Fixture replay | 100% | Offline/CI |
