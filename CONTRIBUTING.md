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
  adapters/       Task adapter implementations (mcp, plain-llm, etc.)
  analyzers/      Skill collision detection
  auth/           Authentication providers (API key, bearer, OAuth2)
  ci/             CI threshold enforcement
  cli/            CLI commands and logger
  comparison/     Model A/B comparison
  core/           Types, config loader, runner, utilities
  dashboard/      Web dashboard (Hono + SQLite)
  docker/         Docker health checks and setup
  evaluators/     All 17 evaluators (CODE and LLM kinds)
  expect/         TypeScript Expect API for programmatic suites
  fixtures/       Record/replay/mock-gen
  layers/         Layer implementations (static, unit, integration, llm, performance, skill)
  mcp/            MCP client, schema converter, tool discovery
  plugins/        Plugin loader
  plugin/         Plugin discovery and frontmatter parsing
  pricing/        Token cost calculation
  reporting/      Report generators (terminal, markdown, JSON, HTML, JUnit XML)
  scoring/        Quality score dimensions, composite, badges, confidence intervals
  templates/      CI pipeline templates
  tracing/        OTel spans and exporters
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
