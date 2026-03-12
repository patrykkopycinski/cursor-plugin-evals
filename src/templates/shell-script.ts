export function generateShellScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

# Plugin Evaluation CI Script
# Usage: ./eval-ci.sh [--layer <layer>] [--mock]

LAYER=""
MOCK_FLAG=""
EXIT_CODE=0

while [[ \$# -gt 0 ]]; do
  case \$1 in
    --layer) LAYER="\$2"; shift 2 ;;
    --mock) MOCK_FLAG="--mock"; shift ;;
    *) echo "Unknown option: \$1"; exit 1 ;;
  esac
done

echo "=== Plugin Evaluation CI ==="
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: node is not installed"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is not installed"; exit 1; }

NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js >= 20 required (found $(node -v))"
  exit 1
fi

# Install dependencies
echo "--- Installing dependencies ---"
npm ci --silent

# Start services if needed for integration/llm layers
COMPOSE_FILE="docker/docker-compose.yml"
NEED_DOCKER=false

if [ -z "$LAYER" ] || [ "$LAYER" = "integration" ] || [ "$LAYER" = "llm" ]; then
  if [ -z "$MOCK_FLAG" ] && [ -f "$COMPOSE_FILE" ]; then
    NEED_DOCKER=true
  fi
fi

if [ "$NEED_DOCKER" = true ]; then
  echo "--- Starting Docker services ---"
  docker compose -f "$COMPOSE_FILE" up -d
  echo "Waiting for services..."
  sleep 10
fi

cleanup() {
  if [ "$NEED_DOCKER" = true ]; then
    echo "--- Stopping Docker services ---"
    docker compose -f "$COMPOSE_FILE" down || true
  fi
}
trap cleanup EXIT

# Run evaluations
LAYER_FLAG=""
if [ -n "$LAYER" ]; then
  LAYER_FLAG="--layer $LAYER"
fi

echo "--- Running evaluations ---"
npx cursor-plugin-evals run $LAYER_FLAG $MOCK_FLAG --ci --report json --output eval-results.json || EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== All evaluations passed ==="
else
  echo "=== Evaluations failed (exit code: $EXIT_CODE) ==="
fi

exit $EXIT_CODE
`;
}
