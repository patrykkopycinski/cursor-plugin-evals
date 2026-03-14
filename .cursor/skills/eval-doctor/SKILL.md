---
name: eval-doctor
description: Diagnose and fix plugin eval infrastructure issues. Use when Docker isn't running, API keys are missing, the plugin won't build, or the user says "doctor", "diagnose", "setup issues", "can't run evals".
license: MIT
metadata:
  author: cursor-plugin-evals
  version: "1.0"
---

Diagnose and fix infrastructure issues preventing plugin evals from running.

**Input**: Specific error or symptom. If not provided, run full diagnostic.

**Steps**

1. **Run doctor command**

   ```bash
   npx cursor-plugin-evals doctor
   ```

   This checks:
   - Docker installed and running
   - Docker Compose available
   - Node.js version >= 20
   - Plugin directory exists and has package.json
   - Plugin builds successfully
   - LLM API keys present (OPENAI_API_KEY, ANTHROPIC_API_KEY)
   - Docker services health (if running)

2. **Fix issues by category**

   **Docker not running:**
   ```bash
   open -a Docker  # macOS
   # Wait for Docker to start, then:
   docker compose -f docker/docker-compose.yml up -d
   ```

   **Plugin build fails:**
   ```bash
   cd $PLUGIN_DIR
   npm install
   npm run build
   ```

   **Missing API keys:**
   - Check .env file exists (copy from .env.example if not)
   - Verify keys are set in the environment

   **Docker services unhealthy:**
   ```bash
   docker compose -f docker/docker-compose.yml down
   docker compose -f docker/docker-compose.yml up -d
   # Wait 30s for ES to start
   npx cursor-plugin-evals doctor
   ```

3. **Verify fix**

   ```bash
   npx cursor-plugin-evals doctor
   ```

   All checks should pass.

**Output**

```
## Infrastructure Diagnostic

✓ Docker: running
✓ Docker Compose: v2.24.0
✓ Node.js: v20.11.0
✓ Plugin: builds successfully
✗ API Keys: OPENAI_API_KEY not set
✓ Test ES: healthy (localhost:9220)
✓ Backend services: healthy
✗ Obs ES: not running

### Fixes Applied
1. Set OPENAI_API_KEY from .env file
2. Started obs cluster: docker compose -f docker/docker-compose.lite.yml up -d

All checks passing ✓
```
