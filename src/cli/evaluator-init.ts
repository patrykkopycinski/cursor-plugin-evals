import { writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { log } from './logger.js';

type Language = 'typescript' | 'javascript' | 'python' | 'shell';

interface EvaluatorInitOptions {
  name: string;
  language: Language;
  dir: string;
  description: string;
}

const ENTRY_BY_LANGUAGE: Record<Language, string> = {
  typescript: 'index.ts',
  javascript: 'index.js',
  python: 'evaluator.py',
  shell: 'evaluator.sh',
};

function generateTypeScriptTemplate(name: string): string {
  return `import { readFileSync } from 'node:fs';

// Read input from stdin
const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));

// Your evaluation logic here
const score = evaluateOutput(input);

// Write result to stdout
const result = {
  protocol_version: '1.0',
  score: Math.max(0, Math.min(1, score)),
  pass: score >= 0.5,
  label: score >= 0.5 ? 'good' : 'needs-improvement',
  explanation: \`Score: \${score.toFixed(2)}\`,
};

console.log(JSON.stringify(result));

function evaluateOutput(input: any): number {
  const { final_output, expected, tool_calls } = input;

  // TODO: Implement your evaluation logic
  // Available fields: prompt, final_output, tool_calls, expected, messages, token_usage, latency_ms

  return 1.0;
}
`;
}

function generateJavaScriptTemplate(_name: string): string {
  return `import { readFileSync } from 'node:fs';

// Read input from stdin
const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));

// Your evaluation logic here
const score = evaluateOutput(input);

// Write result to stdout
const result = {
  protocol_version: '1.0',
  score: Math.max(0, Math.min(1, score)),
  pass: score >= 0.5,
  label: score >= 0.5 ? 'good' : 'needs-improvement',
  explanation: \`Score: \${score.toFixed(2)}\`,
};

console.log(JSON.stringify(result));

function evaluateOutput(input) {
  const { final_output, expected, tool_calls } = input;

  // TODO: Implement your evaluation logic
  // Available fields: prompt, final_output, tool_calls, expected, messages, token_usage, latency_ms

  return 1.0;
}
`;
}

function generatePythonTemplate(name: string): string {
  return `#!/usr/bin/env python3
"""Custom evaluator: ${name}"""
import json
import sys


def evaluate(input_data: dict) -> dict:
    """Evaluate the agent output.

    Available fields in input_data:
    - prompt: The user prompt
    - final_output: The agent's response
    - tool_calls: List of tool calls [{tool, args, result, latency_ms}]
    - expected: Expected output config
    - messages: Conversation messages [{role, content}]
    - token_usage: {input, output, cached}
    - latency_ms: Total latency
    - config: Evaluator-specific config from YAML
    """
    # TODO: Implement your evaluation logic
    score = 1.0

    return {
        "protocol_version": "1.0",
        "score": max(0.0, min(1.0, score)),
        "pass": score >= 0.5,
        "label": "good" if score >= 0.5 else "needs-improvement",
        "explanation": f"Score: {score:.2f}",
    }


if __name__ == "__main__":
    input_data = json.load(sys.stdin)
    result = evaluate(input_data)
    print(json.dumps(result))
`;
}

function generateShellTemplate(name: string): string {
  return `#!/usr/bin/env sh
# Custom evaluator: ${name}
# Reads JSON from stdin, writes JSON to stdout

INPUT=$(cat)

# Extract fields using basic tools (requires jq for full access)
# FINAL_OUTPUT=$(echo "$INPUT" | jq -r '.final_output // ""')
# PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')

# TODO: Implement your evaluation logic
SCORE=1.0
PASS=true
LABEL="good"
EXPLANATION="Score: 1.00"

cat <<EOF
{"protocol_version":"1.0","score":\${SCORE},"pass":\${PASS},"label":"\${LABEL}","explanation":"\${EXPLANATION}"}
EOF
`;
}

function generateTemplate(language: Language, name: string): string {
  switch (language) {
    case 'typescript':
      return generateTypeScriptTemplate(name);
    case 'javascript':
      return generateJavaScriptTemplate(name);
    case 'python':
      return generatePythonTemplate(name);
    case 'shell':
      return generateShellTemplate(name);
  }
}

function generateManifest(opts: EvaluatorInitOptions): string {
  const entry = ENTRY_BY_LANGUAGE[opts.language];
  return JSON.stringify(
    {
      name: opts.name,
      version: '1.0.0',
      description: opts.description,
      language: opts.language,
      entry,
      protocol_version: '1.0',
      tags: [],
      config_schema: {},
    },
    null,
    2,
  );
}

function generateReadme(opts: EvaluatorInitOptions): string {
  const { name, description, language } = opts;
  const entry = ENTRY_BY_LANGUAGE[language];
  const testCmd =
    language === 'typescript'
      ? `npx tsx ${entry}`
      : language === 'python'
        ? `python3 ${entry}`
        : language === 'shell'
          ? `sh ${entry}`
          : `node ${entry}`;

  return `# ${name} Evaluator

${description}

## Usage

Add to your \`plugin-eval.yaml\`:

\`\`\`yaml
evaluators:
  add:
    - name: custom
      path: ./evaluators/${name}
      config:
        # your config here
\`\`\`

## Protocol

This evaluator uses the cursor-plugin-evals custom evaluator protocol v1.0.

**Input:** Full evaluation context (prompt, output, tool calls, expected, messages, tokens, latency)
**Output:** \`{ score: 0-1, pass: boolean, label?, explanation?, metadata? }\`

## Development

\`\`\`bash
# Test your evaluator
echo '{"protocol_version":"1.0","test_name":"test","prompt":"hello","final_output":"world","tool_calls":[],"expected":null,"token_usage":null,"latency_ms":null,"adapter":null,"config":{},"messages":[],"evaluator_name":"${name}"}' | ${testCmd}
\`\`\`
`;
}

function scaffoldEvaluator(opts: EvaluatorInitOptions): void {
  const outDir = resolve(opts.dir);

  if (existsSync(outDir)) {
    log.warn(`Directory already exists: ${outDir}`);
  } else {
    mkdirSync(outDir, { recursive: true });
  }

  const entry = ENTRY_BY_LANGUAGE[opts.language];
  const entryPath = join(outDir, entry);
  const manifestPath = join(outDir, 'evaluator.json');
  const readmePath = join(outDir, 'README.md');

  writeFileSync(entryPath, generateTemplate(opts.language, opts.name), 'utf-8');
  writeFileSync(manifestPath, generateManifest(opts), 'utf-8');
  writeFileSync(readmePath, generateReadme(opts), 'utf-8');

  if (opts.language === 'python' || opts.language === 'shell') {
    try {
      chmodSync(entryPath, 0o755);
    } catch {
      // Non-fatal — user can chmod manually
    }
  }
}

export function registerEvaluatorInitCommand(program: Command): void {
  const evaluatorCmd = program.command('evaluator').description('Manage custom evaluators');

  evaluatorCmd
    .command('init')
    .description('Scaffold a new custom evaluator')
    .requiredOption('--name <name>', 'Evaluator name')
    .option('--language <lang>', 'Language: typescript | javascript | python | shell', 'typescript')
    .option('--dir <path>', 'Output directory (default: ./evaluators/<name>)')
    .option('--description <desc>', 'Evaluator description', 'A custom evaluator')
    .action(
      (cmdOpts: { name: string; language: string; dir?: string; description: string }) => {
        const validLanguages: Language[] = ['typescript', 'javascript', 'python', 'shell'];
        const language = cmdOpts.language as Language;

        if (!validLanguages.includes(language)) {
          log.error(
            `Invalid language "${language}". Choose from: ${validLanguages.join(', ')}`,
          );
          process.exit(1);
        }

        const dir = cmdOpts.dir ?? `./evaluators/${cmdOpts.name}`;

        const opts: EvaluatorInitOptions = {
          name: cmdOpts.name,
          language,
          dir,
          description: cmdOpts.description,
        };

        try {
          scaffoldEvaluator(opts);
        } catch (err) {
          log.error('Failed to scaffold evaluator', err);
          process.exit(1);
        }

        const entry = ENTRY_BY_LANGUAGE[language];
        const relDir = dir.startsWith('./') ? dir : `./${dir}`;

        console.log(`\nCreated evaluator "${cmdOpts.name}" at ${relDir}/\n`);
        console.log(`  Next steps:`);
        console.log(`  1. Edit ${relDir}/${entry} with your scoring logic`);
        if (language === 'typescript') {
          console.log(
            `  2. Test: echo '{"protocol_version":"1.0",...}' | npx tsx ${relDir}/${entry}`,
          );
        } else if (language === 'python') {
          console.log(
            `  2. Test: echo '{"protocol_version":"1.0",...}' | python3 ${relDir}/${entry}`,
          );
        } else if (language === 'shell') {
          console.log(`  2. Test: echo '{"protocol_version":"1.0",...}' | sh ${relDir}/${entry}`);
        } else {
          console.log(`  2. Test: echo '{"protocol_version":"1.0",...}' | node ${relDir}/${entry}`);
        }
        console.log(`  3. Add to plugin-eval.yaml:`);
        console.log(`     evaluators:`);
        console.log(`       add:`);
        console.log(`         - name: custom`);
        console.log(`           path: ${relDir}`);
      },
    );
}
