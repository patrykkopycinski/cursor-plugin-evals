---
description: Diagnose and fix eval infrastructure issues
---

# Eval Doctor

Run diagnostics to identify and fix infrastructure issues.

## Usage

```
/eval:doctor
```

## What it does

1. Checks Docker and Docker Compose availability
2. Verifies Node.js version (>=20)
3. Validates plugin build
4. Checks LLM API key availability
5. Tests Docker service health (ES, Kibana, EDOT collector)
6. Suggests and applies fixes for any issues found
