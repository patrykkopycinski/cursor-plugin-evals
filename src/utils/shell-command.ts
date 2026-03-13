/**
 * Shell command normalization for skill evaluation.
 *
 * Maps script-based tool invocations (e.g., `node scripts/case-manager.js create ...`)
 * to canonical tool names (e.g., `case_manager`) and parses their arguments into
 * structured key-value pairs.
 *
 * This is critical for evaluators (tool-match, tool-args, tool-sequence) that need
 * to compare actual tool usage against expected tools defined in eval.yaml.
 */

export type ScriptToolMapping = Record<string, string>;

const DEFAULT_SCRIPT_TO_TOOL: ScriptToolMapping = {};

const POSITIONAL_ARG_NAMES: Record<string, string> = {};

const REDIRECT_ARG_NAMES: Record<string, string> = {};

const QUERY_PATTERN = /^["']?(?:FROM|ROW|SHOW|METRICS)\s/i;
const KQL_PATTERN = /[:*].*(?:AND|OR)\b|^\w+\.\w+\s*:/;

export function extractToolNameFromShellCommand(
  command: string,
  mapping: ScriptToolMapping = DEFAULT_SCRIPT_TO_TOOL,
): string | undefined {
  for (const [script, toolName] of Object.entries(mapping)) {
    if (command.includes(script)) return toolName;
  }
  return undefined;
}

export function parseShellCommandArgs(
  command: string,
  mapping: ScriptToolMapping = DEFAULT_SCRIPT_TO_TOOL,
): Record<string, unknown> | undefined {
  const matchedScript = Object.keys(mapping).find((s) => command.includes(s));
  if (!matchedScript) return undefined;

  const idx = command.indexOf(matchedScript);
  const afterScript = command.slice(idx + matchedScript.length).trim();
  const beforeScript = command.slice(0, idx).trim();

  const result: Record<string, unknown> = {};
  const positionalName = POSITIONAL_ARG_NAMES[matchedScript] ?? 'action';
  const hasPositionalArg = matchedScript in POSITIONAL_ARG_NAMES;

  const heredocMatch = afterScript.match(/<<[-']?(\w+)['"]?\s*\n?([\s\S]*?)\n?\1/);
  if (heredocMatch) {
    result[positionalName] = heredocMatch[2].trim();
    const beforeHeredoc = afterScript.slice(0, afterScript.indexOf('<<')).trim();
    const tokens: string[] = beforeHeredoc.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith('--')) {
        const key = token.slice(2).replace(/-/g, '_');
        const values: string[] = [];
        let j = i + 1;
        while (j < tokens.length && !tokens[j].startsWith('--')) {
          values.push(tokens[j].replace(/^["']|["']$/g, ''));
          j++;
        }
        result[key] = values.length === 0 ? true : values.length === 1 ? values[0] : values;
        i = j - 1;
      }
    }
    return result;
  }

  const isPiped =
    beforeScript.match(/echo\s+['"].*['"]\s*\|/) || beforeScript.match(/\|\s*(?:node\s*)?$/);
  if (isPiped) {
    const echoMatch =
      beforeScript.match(/echo\s+['"](.*)['"]/) ?? beforeScript.match(/echo\s+(.*?)\s*\|/);
    if (echoMatch) {
      result[positionalName] = echoMatch[1].trim();
    } else {
      const catMatch = beforeScript.match(/cat\s+['"]?([^\s'"]+)['"]?\s*\|/);
      const redirectArgName = REDIRECT_ARG_NAMES[matchedScript];
      if (catMatch && redirectArgName) {
        result[redirectArgName] = catMatch[1];
      } else {
        result[positionalName] = '<piped_input>';
      }
    }
  }

  const tokens: string[] = afterScript.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  let i = 0;

  if (
    !result[positionalName] &&
    tokens.length > 0 &&
    !tokens[0].startsWith('--') &&
    !tokens[0].startsWith('-') &&
    !tokens[0].startsWith('<<')
  ) {
    result[positionalName] = tokens[0].replace(/^["']|["']$/g, '');
    i = 1;
  }

  while (i < tokens.length) {
    const token = tokens[i];
    if (token === '<' && i + 1 < tokens.length) {
      const redirectArgName = REDIRECT_ARG_NAMES[matchedScript];
      if (redirectArgName) {
        result[redirectArgName] = tokens[i + 1].replace(/^["']|["']$/g, '');
      }
      i += 2;
    } else if (token.startsWith('--')) {
      const key = token.slice(2).replace(/-/g, '_');
      if (hasPositionalArg) {
        const nextToken = i + 1 < tokens.length ? tokens[i + 1] : undefined;
        const stripped = nextToken?.replace(/^["']|["']$/g, '') ?? '';
        const nextIsQuery =
          nextToken && (QUERY_PATTERN.test(nextToken) || KQL_PATTERN.test(stripped));
        if (nextToken && !nextToken.startsWith('--') && nextToken !== '<' && !nextIsQuery) {
          result[key] = stripped;
          i += 2;
        } else {
          result[key] = true;
          i += 1;
        }
      } else {
        const values: string[] = [];
        let j = i + 1;
        while (j < tokens.length && !tokens[j].startsWith('--') && tokens[j] !== '<') {
          values.push(tokens[j].replace(/^["']|["']$/g, ''));
          j++;
        }
        result[key] = values.length === 0 ? true : values.length === 1 ? values[0] : values;
        i = j;
      }
    } else {
      if (hasPositionalArg) {
        const stripped = token.replace(/^["']|["']$/g, '');
        if (stripped !== '2>&1' && !result[positionalName]) {
          result[positionalName] = stripped;
        }
      }
      i++;
    }
  }

  return result;
}

const UNMAPPED_SCRIPT_PATTERN = /(?:^|[\s/])scripts\/[^\s]*?([^/\s]+\.js)\b/;
const warnedScripts = new Set<string>();

function warnUnmappedScript(command: string): void {
  const match = command.match(UNMAPPED_SCRIPT_PATTERN);
  if (!match) return;

  const scriptFile = match[1];
  if (warnedScripts.has(scriptFile)) return;
  warnedScripts.add(scriptFile);

  console.warn(
    `⚠ Unmapped script detected: "${scriptFile}" is not in the tool mapping. ` +
      `Tool-match evaluator will record this as "shell" instead of a canonical tool name. ` +
      `Add an entry to your scriptToTool mapping to fix. Command: ${command.slice(0, 120)}`,
  );
}

export interface NormalizeToolCallOptions {
  scriptToTool?: ScriptToolMapping;
  positionalArgNames?: Record<string, string>;
  redirectArgNames?: Record<string, string>;
}

/**
 * Normalize a tool call by detecting shell commands and resolving
 * them to canonical tool names with parsed arguments.
 *
 * Works for any adapter — pass the raw tool name and arguments,
 * get back the resolved name/args (or the originals if no shell
 * command was detected).
 */
export function normalizeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  options?: NormalizeToolCallOptions,
): { name: string; arguments: Record<string, unknown> } {
  const mapping = options?.scriptToTool ?? DEFAULT_SCRIPT_TO_TOOL;

  if (Object.keys(mapping).length === 0) {
    return { name: toolName, arguments: args };
  }

  const cmd = args.command ?? args.cmd;
  if (cmd) {
    const extracted = extractToolNameFromShellCommand(String(cmd), mapping);
    if (extracted) {
      const parsed = parseShellCommandArgs(String(cmd), mapping);
      return { name: extracted, arguments: parsed ?? args };
    }
    warnUnmappedScript(String(cmd));
  }

  const extracted = extractToolNameFromShellCommand(toolName, mapping);
  if (extracted) {
    return { name: extracted, arguments: args };
  }

  return { name: toolName, arguments: args };
}

/**
 * Build a tool catalog section for injection into agent prompts.
 * Returns a markdown-formatted list of available tools and their descriptions.
 */
export function buildToolCatalogSection(catalog: Record<string, string>): string {
  const entries = Object.entries(catalog);
  if (entries.length === 0) return '';
  const lines = entries.map(([name, desc]) => `- **${name}**: ${desc}`);
  return (
    '\n## Available Tools\n\n' +
    'These tools are available as shell scripts. Call them by name using the appropriate script:\n' +
    lines.join('\n') +
    '\n'
  );
}
