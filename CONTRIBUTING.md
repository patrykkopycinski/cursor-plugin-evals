# Contributing to cursor-plugin-evals

Thank you for your interest in contributing. This document covers the development workflow, conventions, and guidelines for the project.

## Prerequisites

- **Node.js** >= 20
- **npm** (comes with Node.js)
- **Docker** (for integration and performance layer tests)

## Getting Started

```bash
git clone <repo-url>
cd cursor-plugin-evals
npm install
```

## Development Workflow

```bash
# Type-check
npm run typecheck

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint:fix

# Format
npm run format

# Build
npm run build
```

All of the above must pass before submitting changes.

## Project Structure

```
src/
  adapters/       Task adapter implementations (mcp, plain-llm, headless-coder, gemini-cli, claude-sdk, cursor-cli)
  analyzers/      Skill collision detection and security lint
  auth/           Authentication providers (API key, bearer, OAuth2)
  cache/          LLM response cache with disk persistence and TTL
  ci/             CI threshold enforcement
  cli/            CLI commands, logger, setup wizard
  comparison/     Model A/B comparison matrix
  core/           Types, config loader, runner, utilities
  dashboard/      Web dashboard (Hono + SQLite)
  dataset/        Dataset generator for programmatic test creation
  docker/         Docker health checks and test cluster setup
  evaluators/     All 35 evaluators (16 CODE + 14 LLM + multi-judge)
  expect/         TypeScript Expect API for programmatic suites
  fixtures/       Record/replay/mock-gen for MCP tool calls
  layers/         Layer implementations (static, unit, integration, llm, performance, skill, conformance)
  mcp/            MCP client, schema converter, tool discovery
  plugins/        Plugin loader for custom evaluators/reporters/transports
  plugin/         Plugin discovery and frontmatter parsing
  pricing/        Token cost calculation with 11+ model catalog
  recordings/     Recording repository for storing and replaying full eval runs
  reporting/      Report generators (terminal, markdown, JSON, HTML, JUnit XML, failure clustering)
  scoring/        Quality score dimensions, composite, badges, confidence intervals
  templates/      CI pipeline templates (GitHub Actions, GitLab CI, shell)
  tracing/        OTel spans and exporters (OTLP, Elasticsearch)
  transports/     MCP transport implementations (stdio, HTTP, SSE, streamable-HTTP)
```

## Adding a New Evaluator

1. Create `src/evaluators/my-evaluator.ts` implementing the `Evaluator` interface:

```typescript
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';

export class MyEvaluator implements Evaluator {
  name = 'my-evaluator';
  kind: EvaluatorKind = 'CODE'; // or 'LLM'

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    // Your evaluation logic
    return {
      evaluator: this.name,
      score: 1.0,
      pass: true,
      label: 'ok',
      explanation: 'Evaluation passed',
    };
  }
}
```

2. Register it in `src/evaluators/index.ts`:
   - Add the import
   - Add the name to `EVALUATOR_NAMES`
   - Add the class to `EVALUATOR_MAP`
   - Add it to the re-export block

3. Add tests in `src/evaluators/my-evaluator.test.ts`

4. Update the evaluator table in `README.md`

## Adding a New Task Adapter

1. Create `src/adapters/my-adapter.ts` exporting a `createMyAdapter(config: AdapterConfig): TaskAdapter` function

2. Register it in `src/adapters/index.ts`:
   - Add the name to the `AdapterName` union
   - Add a case in the `getAdapterFactory` switch

3. If it requires an optional dependency, handle the import error gracefully:

```typescript
try {
  const sdk = await import('optional-dep');
  // use sdk
} catch {
  throw new Error(
    'my-adapter requires "optional-dep". Install it with: npm install optional-dep',
  );
}
```

## Code Conventions

- **TypeScript** with strict mode
- **ESM** (`"type": "module"` in package.json)
- **Vitest** for testing — co-located test files (`*.test.ts`)
- **Prettier** for formatting (run `npm run format`)
- **No comments that just narrate** — comments should explain non-obvious intent
- Test helper factories use `makeXxx(overrides: Partial<T>)` pattern

## Documentation Requirements

Every non-trivial change **must** update documentation:

| What changed | What to update |
|---|---|
| New evaluator | `src/evaluators/index.ts` registration, evaluator docs in `docs/evaluators.md` |
| New CLI command | `src/cli/main.ts` wiring, `CHANGELOG.md` entry |
| New adapter | `src/adapters/index.ts` registration, `docs/adapters.md` |
| New module/directory | `src/index.ts` exports, Project Structure in `CONTRIBUTING.md`, architecture diagram |
| New env variable | `.env.example`, `src/cli/env.ts` ENV_VARS array |
| Any feature change | `CHANGELOG.md` entry under appropriate section |
| Badge-visible counts | README badges (evaluators, adapters, layers) |

Run `npm test` and `npm run typecheck` before considering docs complete.

## Commit Messages

Use concise, descriptive commit messages:

```
fix: correct CI summary direction for latency/cost violations
feat: add keywords evaluator with case-insensitive matching
test: add unit tests for CI threshold enforcement
docs: update README with unified framework capabilities
```

## License

By contributing, you agree that your contributions will be licensed under the Elastic License 2.0.
