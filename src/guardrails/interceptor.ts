import type { GuardrailConfig, GuardrailRule, GuardrailEvent, InterceptResult } from './types.js';

// Shell metacharacters that indicate command injection risk
const SHELL_METACHAR_RE = /[;|&$`(){}<>]/;

// High-risk injection patterns — be specific to avoid false positives
const COMMAND_INJECTION_PATTERNS = [
  /\brm\s+-[rf]{1,2}\s+\//,   // rm -rf / or rm -f /path
  /\brm\s+-[rf]{1,2}\s+~/,    // rm -rf ~
  /curl\s+.*\|\s*(?:bash|sh)/,  // curl | bash
  /wget\s+.*\|\s*(?:bash|sh)/,  // wget | bash
  /\beval\s*\(/,
  /\bexec\s*\(/,
];

// Path traversal indicators
const PATH_TRAVERSAL_RE = /(?:\.\.[/\\]|\.\.[/\\]|^\/etc\/|^\/proc\/|^~\/\.)/;

// SSRF — internal network indicators in URL-like values
const SSRF_RE =
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|^10\.|^172\.(?:1[6-9]|2\d|3[01])\.|^192\.168\.|(?:\[::1\]))/i;

// Prompt injection prefixes
const PROMPT_INJECTION_RE =
  /(?:ignore\s+previous|disregard\s+|system\s*:|<\|im_start\|>|ADMIN\s*:|(?:\[INST\]))/i;

// Credential patterns — only flag clear credential-looking values
const CREDENTIAL_RE = /(?:^sk-[A-Za-z0-9]{20,}|^key-[A-Za-z0-9]{20,}|^token-[A-Za-z0-9]{20,})/;

// Data exfiltration — tool names that suggest data leaving the system
const EXFIL_TOOL_RE = /(?:send|upload|post|email)(?:_|\b)/i;

function stringValuesOf(args: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(args).flatMap(([field, value]) => {
    if (typeof value === 'string') return [[field, value] as [string, string]];
    if (Array.isArray(value)) {
      return value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => [field, v] as [string, string]);
    }
    return [];
  });
}

function checkCommandInjection(
  toolName: string,
  args: Record<string, unknown>,
  rule: GuardrailRule,
  now: number,
): GuardrailEvent | null {
  for (const [field, value] of stringValuesOf(args)) {
    if (SHELL_METACHAR_RE.test(value)) {
      return {
        timestamp: now,
        tool: toolName,
        args,
        rule: rule.evaluator,
        action: rule.action,
        reason: `Shell metacharacter detected in arg '${field}'`,
        blocked: rule.action === 'block',
      };
    }
    for (const pattern of COMMAND_INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        return {
          timestamp: now,
          tool: toolName,
          args,
          rule: rule.evaluator,
          action: rule.action,
          reason: `Command injection pattern detected in arg '${field}'`,
          blocked: rule.action === 'block',
        };
      }
    }
  }
  return null;
}

function checkPathTraversal(
  toolName: string,
  args: Record<string, unknown>,
  rule: GuardrailRule,
  now: number,
): GuardrailEvent | null {
  for (const [field, value] of stringValuesOf(args)) {
    if (PATH_TRAVERSAL_RE.test(value)) {
      return {
        timestamp: now,
        tool: toolName,
        args,
        rule: rule.evaluator,
        action: rule.action,
        reason: `Path traversal pattern detected in arg '${field}'`,
        blocked: rule.action === 'block',
      };
    }
  }
  return null;
}

function checkSsrf(
  toolName: string,
  args: Record<string, unknown>,
  rule: GuardrailRule,
  now: number,
): GuardrailEvent | null {
  for (const [field, value] of stringValuesOf(args)) {
    // Only check URL-like values (contain :// or start with http)
    if (/https?:\/\/|:\/\//i.test(value) && SSRF_RE.test(value)) {
      return {
        timestamp: now,
        tool: toolName,
        args,
        rule: rule.evaluator,
        action: rule.action,
        reason: `Internal network target detected in arg '${field}'`,
        blocked: rule.action === 'block',
      };
    }
  }
  return null;
}

function checkPromptInjection(
  toolName: string,
  args: Record<string, unknown>,
  rule: GuardrailRule,
  now: number,
): GuardrailEvent | null {
  for (const [field, value] of stringValuesOf(args)) {
    if (PROMPT_INJECTION_RE.test(value)) {
      return {
        timestamp: now,
        tool: toolName,
        args,
        rule: rule.evaluator,
        action: rule.action,
        reason: `Prompt injection pattern detected in arg '${field}'`,
        blocked: rule.action === 'block',
      };
    }
  }
  return null;
}

function checkCredentialExposure(
  toolName: string,
  args: Record<string, unknown>,
  rule: GuardrailRule,
  now: number,
): GuardrailEvent | null {
  for (const [field, value] of stringValuesOf(args)) {
    if (CREDENTIAL_RE.test(value)) {
      return {
        timestamp: now,
        tool: toolName,
        args,
        rule: rule.evaluator,
        action: rule.action,
        reason: `Potential credential value detected in arg '${field}'`,
        blocked: rule.action === 'block',
      };
    }
  }
  return null;
}

function checkDataExfiltration(
  toolName: string,
  args: Record<string, unknown>,
  rule: GuardrailRule,
  now: number,
): GuardrailEvent | null {
  if (!EXFIL_TOOL_RE.test(toolName)) return null;

  // Tool name suggests exfil — check if args contain file paths or large data
  for (const [field, value] of stringValuesOf(args)) {
    const isFilePath = /^[/~]|\.(?:json|csv|txt|log|yaml|yml|xml|db|sql)$/i.test(value);
    const isLargeData = value.length > 500;
    if (isFilePath || isLargeData) {
      return {
        timestamp: now,
        tool: toolName,
        args,
        rule: rule.evaluator,
        action: rule.action,
        reason: `Potential data exfiltration: tool '${toolName}' with ${isFilePath ? `file path in arg '${field}'` : `large data in arg '${field}'`}`,
        blocked: rule.action === 'block',
      };
    }
  }
  return null;
}

function checkArgPatterns(
  toolName: string,
  args: Record<string, unknown>,
  rule: GuardrailRule,
  now: number,
): GuardrailEvent | null {
  if (!rule.argPatterns) return null;

  for (const { field, pattern, action } of rule.argPatterns) {
    const value = args[field];
    if (typeof value !== 'string') continue;

    const re = new RegExp(pattern);
    if (re.test(value)) {
      return {
        timestamp: now,
        tool: toolName,
        args,
        rule: rule.evaluator,
        action,
        reason: `Arg pattern /${pattern}/ matched field '${field}'`,
        blocked: action === 'block',
      };
    }
  }
  return null;
}

const BUILT_IN_CHECKS: Record<
  string,
  (
    toolName: string,
    args: Record<string, unknown>,
    rule: GuardrailRule,
    now: number,
  ) => GuardrailEvent | null
> = {
  'command-injection': checkCommandInjection,
  'path-traversal': checkPathTraversal,
  ssrf: checkSsrf,
  'prompt-injection': checkPromptInjection,
  'credential-exposure': checkCredentialExposure,
  'data-exfiltration': checkDataExfiltration,
};

/**
 * Check a tool call against guardrail rules.
 * Returns whether the call should be allowed and any events generated.
 */
export function interceptToolCall(
  toolName: string,
  args: Record<string, unknown>,
  config: GuardrailConfig,
): InterceptResult {
  const events: GuardrailEvent[] = [];
  const now = Date.now();

  for (const rule of config.rules) {
    // If the rule has a tool filter, skip if this tool isn't in the list
    if (rule.tools && rule.tools.length > 0 && !rule.tools.includes(toolName)) {
      continue;
    }

    let event: GuardrailEvent | null = null;

    // Run built-in check if available
    const builtIn = BUILT_IN_CHECKS[rule.evaluator];
    if (builtIn) {
      event = builtIn(toolName, args, rule, now);
    }

    // Also run argPatterns check (can supplement or be standalone)
    if (!event && rule.argPatterns) {
      event = checkArgPatterns(toolName, args, rule, now);
    }

    if (event) {
      events.push(event);
    }
  }

  if (events.length === 0) {
    return { allowed: true, action: 'log', events: [] };
  }

  // The most severe action wins: block > warn > log
  const blocked = events.find((e) => e.blocked);
  if (blocked) {
    return {
      allowed: false,
      action: 'block',
      rule: blocked.rule,
      reason: blocked.reason,
      events,
    };
  }

  const warned = events.find((e) => e.action === 'warn');
  if (warned) {
    return {
      allowed: true,
      action: 'warn',
      rule: warned.rule,
      reason: warned.reason,
      events,
    };
  }

  const logged = events[0];
  return {
    allowed: true,
    action: 'log',
    rule: logged.rule,
    reason: logged.reason,
    events,
  };
}
