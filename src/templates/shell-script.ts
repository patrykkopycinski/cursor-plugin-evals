import { CLI_NAME } from '../core/constants.js';

export function generateShellScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

# Plugin Evaluation CI Script
# Usage: ./eval-ci.sh [--layer <layer>] [--mock] [--start-local]

LAYER=""
MOCK_FLAG=""
USE_START_LOCAL=false
EXIT_CODE=0

while [[ \$# -gt 0 ]]; do
  case \$1 in
    --layer) LAYER="\$2"; shift 2 ;;
    --mock) MOCK_FLAG="--mock"; shift ;;
    --start-local) USE_START_LOCAL=true; shift ;;
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
NEED_ES=false

if [ -z "$LAYER" ] || [ "$LAYER" = "integration" ] || [ "$LAYER" = "llm" ]; then
  if [ -z "$MOCK_FLAG" ]; then
    NEED_ES=true
  fi
fi

if [ "$NEED_ES" = true ]; then
  if [ "$USE_START_LOCAL" = true ]; then
    echo "--- Starting Elastic Stack via start-local ---"
    curl -fsSL https://elastic.co/start-local | sh -s --
    source elastic-start-local/.env
    export ELASTICSEARCH_URL="http://localhost:9200"
    export ES_USER="elastic"
    export ES_PASS="\${ES_LOCAL_PASSWORD}"
    echo "Waiting for Elasticsearch..."
    until curl -sf "http://elastic:\${ES_LOCAL_PASSWORD}@localhost:9200/_cluster/health" > /dev/null 2>&1; do sleep 2; done
  elif [ -f "docker/docker-compose.yml" ]; then
    echo "--- Starting Docker services ---"
    docker compose -f "docker/docker-compose.yml" up -d
    echo "Waiting for services..."
    sleep 10
  fi
fi

cleanup() {
  if [ "$NEED_ES" = true ]; then
    if [ "$USE_START_LOCAL" = true ] && [ -d "elastic-start-local" ]; then
      echo "--- Stopping Elasticsearch (start-local) ---"
      cd elastic-start-local && docker compose down || true
      cd ..
    elif [ -f "docker/docker-compose.yml" ]; then
      echo "--- Stopping Docker services ---"
      docker compose -f "docker/docker-compose.yml" down || true
    fi
  fi
}
trap cleanup EXIT

# Run evaluations
LAYER_FLAG=""
if [ -n "$LAYER" ]; then
  LAYER_FLAG="--layer $LAYER"
fi

echo "--- Running evaluations ---"
npx ${CLI_NAME} run $LAYER_FLAG $MOCK_FLAG --ci --report json --output eval-results.json || EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== All evaluations passed ==="
else
  echo "=== Evaluations failed (exit code: $EXIT_CODE) ==="
fi

exit $EXIT_CODE
`;
}
