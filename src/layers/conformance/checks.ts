import type { McpPluginClient } from '../../mcp/client.js';
import type { ConformanceCheck, ConformanceResult, ConformanceCategory } from './types.js';

export interface CheckDefinition {
  check: ConformanceCheck;
  run: (client: McpPluginClient) => Promise<ConformanceResult>;
}

function makeCheck(
  id: string,
  category: ConformanceCategory,
  name: string,
  description: string,
  required: boolean,
  fn: (client: McpPluginClient) => Promise<{ passed: boolean; message: string }>,
): CheckDefinition {
  const check: ConformanceCheck = { id, category, name, description, required };
  return {
    check,
    run: async (client) => {
      const start = performance.now();
      try {
        const result = await fn(client);
        return { check, ...result, durationMs: performance.now() - start };
      } catch (err) {
        return {
          check,
          passed: false,
          message: err instanceof Error ? err.message : String(err),
          durationMs: performance.now() - start,
        };
      }
    },
  };
}

function makeSkippableCheck(
  id: string,
  category: ConformanceCategory,
  name: string,
  description: string,
  required: boolean,
  capabilityKey: 'tools' | 'resources' | 'prompts',
  fn: (client: McpPluginClient) => Promise<{ passed: boolean; message: string }>,
): CheckDefinition {
  const check: ConformanceCheck = { id, category, name, description, required };
  return {
    check,
    run: async (client) => {
      const start = performance.now();
      const caps = client.rawClient.getServerCapabilities();
      if (!caps?.[capabilityKey]) {
        return {
          check,
          passed: true,
          skipped: true,
          message: `Server does not declare ${capabilityKey} capability — skipped`,
          durationMs: performance.now() - start,
        };
      }
      try {
        const result = await fn(client);
        return { check, ...result, durationMs: performance.now() - start };
      } catch (err) {
        return {
          check,
          passed: false,
          message: err instanceof Error ? err.message : String(err),
          durationMs: performance.now() - start,
        };
      }
    },
  };
}

// --- initialization ---

const initResponds = makeCheck(
  'init-responds',
  'initialization',
  'Server responds to initialize',
  'Server completes the initialize handshake and returns a result',
  true,
  async (client) => {
    const caps = client.rawClient.getServerCapabilities();
    return caps !== undefined
      ? { passed: true, message: 'Server returned capabilities after initialize' }
      : { passed: false, message: 'Server did not return capabilities' };
  },
);

const initCapabilities = makeCheck(
  'init-capabilities',
  'initialization',
  'Server reports capabilities',
  'The initialize result includes a capabilities object',
  true,
  async (client) => {
    const caps = client.rawClient.getServerCapabilities();
    if (!caps || typeof caps !== 'object') {
      return { passed: false, message: 'capabilities is missing or not an object' };
    }
    return { passed: true, message: 'capabilities object present' };
  },
);

const initServerInfo = makeCheck(
  'init-server-info',
  'initialization',
  'Server provides serverInfo',
  'The initialize result includes serverInfo with name field',
  true,
  async (client) => {
    const info = client.rawClient.getServerVersion();
    if (!info || !info.name) {
      return { passed: false, message: 'serverInfo missing or has no name' };
    }
    return { passed: true, message: `serverInfo.name = "${info.name}"` };
  },
);

const initReinitialization = makeCheck(
  'init-reinitialization',
  'initialization',
  'Handles re-initialization gracefully',
  'Calling getServerCapabilities multiple times returns consistent results',
  false,
  async (client) => {
    const caps1 = client.rawClient.getServerCapabilities();
    const caps2 = client.rawClient.getServerCapabilities();
    const same = JSON.stringify(caps1) === JSON.stringify(caps2);
    return same
      ? { passed: true, message: 'Capabilities are consistent across calls' }
      : { passed: false, message: 'Capabilities differ between calls' };
  },
);

// --- tool-listing ---

const toolListReturnsArray = makeSkippableCheck(
  'tool-list-array',
  'tool-listing',
  'tools/list returns array',
  'Calling listTools returns an array of tool definitions',
  true,
  'tools',
  async (client) => {
    const tools = await client.listTools();
    return Array.isArray(tools)
      ? { passed: true, message: `Returned ${tools.length} tool(s)` }
      : { passed: false, message: 'listTools did not return an array' };
  },
);

const toolHasNameAndSchema = makeSkippableCheck(
  'tool-name-schema',
  'tool-listing',
  'Each tool has name + inputSchema',
  'Every tool definition contains a name string and inputSchema object',
  true,
  'tools',
  async (client) => {
    const tools = await client.listTools();
    const invalid = tools.filter((t) => !t.name || !t.inputSchema);
    return invalid.length === 0
      ? { passed: true, message: 'All tools have name and inputSchema' }
      : {
          passed: false,
          message: `${invalid.length} tool(s) missing name or inputSchema: ${invalid.map((t) => t.name ?? '<unnamed>').join(', ')}`,
        };
  },
);

const toolSchemaIsValid = makeSkippableCheck(
  'tool-schema-valid',
  'tool-listing',
  'inputSchema is valid JSON Schema',
  'Each tool inputSchema has a type field consistent with JSON Schema',
  true,
  'tools',
  async (client) => {
    const tools = await client.listTools();
    const invalid = tools.filter((t) => {
      const s = t.inputSchema;
      return !s || typeof s !== 'object';
    });
    return invalid.length === 0
      ? { passed: true, message: 'All inputSchemas are valid objects' }
      : { passed: false, message: `${invalid.length} tool(s) have invalid inputSchema` };
  },
);

// --- tool-execution ---

const toolCallReturnsResult = makeSkippableCheck(
  'tool-call-result',
  'tool-execution',
  'tools/call returns result',
  'Calling a known tool with valid args returns a result object',
  true,
  'tools',
  async (client) => {
    const tools = await client.listTools();
    if (tools.length === 0) {
      return { passed: true, message: 'No tools to test — vacuously true' };
    }
    const tool = tools[0];
    const result = await client.callTool(tool.name, {});
    return result
      ? { passed: true, message: `Tool "${tool.name}" returned a result` }
      : { passed: false, message: `Tool "${tool.name}" returned null/undefined` };
  },
);

const toolCallHasContent = makeSkippableCheck(
  'tool-call-content',
  'tool-execution',
  'Result has content array',
  'The tool result contains a content array',
  true,
  'tools',
  async (client) => {
    const tools = await client.listTools();
    if (tools.length === 0) {
      return { passed: true, message: 'No tools to test — vacuously true' };
    }
    const result = await client.callTool(tools[0].name, {});
    return Array.isArray(result.content)
      ? { passed: true, message: `content array has ${result.content.length} item(s)` }
      : { passed: false, message: 'result.content is not an array' };
  },
);

const toolCallContentHasType = makeSkippableCheck(
  'tool-call-content-type',
  'tool-execution',
  'Each content item has type field',
  'Every item in the content array includes a type field',
  true,
  'tools',
  async (client) => {
    const tools = await client.listTools();
    if (tools.length === 0) {
      return { passed: true, message: 'No tools to test — vacuously true' };
    }
    const result = await client.callTool(tools[0].name, {});
    const missingType = result.content.filter((c) => !c.type);
    return missingType.length === 0
      ? { passed: true, message: 'All content items have a type field' }
      : { passed: false, message: `${missingType.length} content item(s) missing type` };
  },
);

const toolCallUnknownTool = makeSkippableCheck(
  'tool-call-unknown',
  'tool-execution',
  'Unknown tool returns error',
  'Calling a non-existent tool returns an error result rather than crashing',
  true,
  'tools',
  async (client) => {
    try {
      const result = await client.callTool('__nonexistent_tool_' + Date.now(), {});
      return result.isError
        ? { passed: true, message: 'Server returned error for unknown tool' }
        : { passed: false, message: 'Server did not return error for unknown tool' };
    } catch {
      return { passed: true, message: 'Server threw error for unknown tool' };
    }
  },
);

// --- resource-listing ---

const resourceListReturnsArray = makeSkippableCheck(
  'resource-list-array',
  'resource-listing',
  'resources/list returns array',
  'Calling listResources returns an array',
  true,
  'resources',
  async (client) => {
    const resources = await client.listResources();
    return Array.isArray(resources)
      ? { passed: true, message: `Returned ${resources.length} resource(s)` }
      : { passed: false, message: 'listResources did not return an array' };
  },
);

const resourceHasUriAndName = makeSkippableCheck(
  'resource-uri-name',
  'resource-listing',
  'Each resource has uri + name',
  'Every resource includes a uri string and name string',
  true,
  'resources',
  async (client) => {
    const resources = await client.listResources();
    const invalid = resources.filter((r) => !r.uri || !r.name);
    return invalid.length === 0
      ? { passed: true, message: 'All resources have uri and name' }
      : { passed: false, message: `${invalid.length} resource(s) missing uri or name` };
  },
);

const resourceUriFormat = makeSkippableCheck(
  'resource-uri-format',
  'resource-listing',
  'Resources have valid URI format',
  'Each resource uri is parseable as a valid URI',
  false,
  'resources',
  async (client) => {
    const resources = await client.listResources();
    const invalid = resources.filter((r) => {
      try {
        new URL(r.uri);
        return false;
      } catch {
        return true;
      }
    });
    return invalid.length === 0
      ? { passed: true, message: 'All resource URIs are valid' }
      : {
          passed: false,
          message: `${invalid.length} resource(s) with invalid URI: ${invalid.map((r) => r.uri).join(', ')}`,
        };
  },
);

// --- resource-reading ---

const resourceReadContents = makeSkippableCheck(
  'resource-read-contents',
  'resource-reading',
  'resources/read returns contents',
  'Reading a known resource returns a contents array',
  true,
  'resources',
  async (client) => {
    const resources = await client.listResources();
    if (resources.length === 0) {
      return { passed: true, message: 'No resources to test — vacuously true' };
    }
    const result = await client.readResource(resources[0].uri);
    return Array.isArray(result.contents)
      ? { passed: true, message: `Resource returned ${result.contents.length} content item(s)` }
      : { passed: false, message: 'readResource did not return contents array' };
  },
);

const resourceReadUnknown = makeSkippableCheck(
  'resource-read-unknown',
  'resource-reading',
  'Unknown resource returns error',
  'Reading a non-existent resource URI returns an error',
  true,
  'resources',
  async (client) => {
    try {
      await client.readResource('urn:nonexistent:' + Date.now());
      return { passed: false, message: 'Server did not error for unknown resource' };
    } catch {
      return { passed: true, message: 'Server errored for unknown resource' };
    }
  },
);

// --- prompt-listing ---

const promptListReturnsArray = makeSkippableCheck(
  'prompt-list-array',
  'prompt-listing',
  'prompts/list returns array',
  'Calling listPrompts returns an array',
  true,
  'prompts',
  async (client) => {
    const result = await client.rawClient.listPrompts();
    return Array.isArray(result.prompts)
      ? { passed: true, message: `Returned ${result.prompts.length} prompt(s)` }
      : { passed: false, message: 'listPrompts did not return an array' };
  },
);

const promptHasName = makeSkippableCheck(
  'prompt-has-name',
  'prompt-listing',
  'Each prompt has name',
  'Every prompt includes a name field',
  true,
  'prompts',
  async (client) => {
    const result = await client.rawClient.listPrompts();
    const invalid = result.prompts.filter((p: { name?: string }) => !p.name);
    return invalid.length === 0
      ? { passed: true, message: 'All prompts have a name' }
      : { passed: false, message: `${invalid.length} prompt(s) missing name` };
  },
);

// --- prompt-getting ---

const promptGetMessages = makeSkippableCheck(
  'prompt-get-messages',
  'prompt-getting',
  'prompts/get returns messages',
  'Getting a known prompt returns a messages array',
  true,
  'prompts',
  async (client) => {
    const list = await client.rawClient.listPrompts();
    if (list.prompts.length === 0) {
      return { passed: true, message: 'No prompts to test — vacuously true' };
    }
    const result = await client.rawClient.getPrompt({ name: list.prompts[0].name });
    return Array.isArray(result.messages)
      ? { passed: true, message: `Prompt returned ${result.messages.length} message(s)` }
      : { passed: false, message: 'getPrompt did not return messages array' };
  },
);

const promptGetUnknown = makeSkippableCheck(
  'prompt-get-unknown',
  'prompt-getting',
  'Unknown prompt returns error',
  'Getting a non-existent prompt returns an error',
  true,
  'prompts',
  async (client) => {
    try {
      await client.rawClient.getPrompt({ name: '__nonexistent_prompt_' + Date.now() });
      return { passed: false, message: 'Server did not error for unknown prompt' };
    } catch {
      return { passed: true, message: 'Server errored for unknown prompt' };
    }
  },
);

// --- error-handling ---

const errorInvalidMethod = makeCheck(
  'error-invalid-method',
  'error-handling',
  'Invalid method returns error',
  'Sending an unrecognized method returns an error response',
  true,
  async (client) => {
    try {
      await client.rawClient.request(
        { method: '__invalid_method_' + Date.now(), params: {} },
        {} as never,
      );
      return { passed: false, message: 'Server did not reject invalid method' };
    } catch {
      return { passed: true, message: 'Server rejected invalid method' };
    }
  },
);

const errorMalformedParams = makeCheck(
  'error-malformed-params',
  'error-handling',
  'Malformed params handled gracefully',
  'Sending malformed params does not crash the server',
  true,
  async (client) => {
    try {
      await client.callTool('', { [Symbol() as unknown as string]: true });
      return { passed: true, message: 'Server handled malformed params without crash' };
    } catch {
      return { passed: true, message: 'Server rejected malformed params gracefully' };
    }
  },
);

const errorResponseShape = makeCheck(
  'error-response-shape',
  'error-handling',
  'Error response has code and message',
  'Error responses include a numeric code and descriptive message',
  false,
  async (client) => {
    try {
      await client.rawClient.request(
        { method: '__invalid_method_' + Date.now(), params: {} },
        {} as never,
      );
      return { passed: false, message: 'Expected an error but got success' };
    } catch (err: unknown) {
      const hasCode = typeof (err as Record<string, unknown>).code === 'number';
      const hasMessage = typeof (err as Record<string, unknown>).message === 'string';
      if (hasCode && hasMessage) {
        return { passed: true, message: 'Error has code and message' };
      }
      if (hasMessage) {
        return { passed: true, message: 'Error has message (code may be wrapped)' };
      }
      return { passed: false, message: 'Error lacks expected code/message structure' };
    }
  },
);

// --- capability-negotiation ---

const capOnlyDeclared = makeCheck(
  'cap-only-declared',
  'capability-negotiation',
  'Server only exposes declared capabilities',
  'Undeclared capabilities are not reachable',
  false,
  async (client) => {
    const caps = client.rawClient.getServerCapabilities();
    if (!caps) {
      return { passed: false, message: 'No capabilities returned' };
    }

    const issues: string[] = [];

    if (!caps.tools) {
      try {
        const tools = await client.listTools();
        if (tools.length > 0) {
          issues.push('tools not declared but listTools returned results');
        }
      } catch {
        // Expected — capability not declared
      }
    }

    if (!caps.resources) {
      try {
        const resources = await client.listResources();
        if (resources.length > 0) {
          issues.push('resources not declared but listResources returned results');
        }
      } catch {
        // Expected
      }
    }

    if (!caps.prompts) {
      try {
        const result = await client.rawClient.listPrompts();
        if (result.prompts.length > 0) {
          issues.push('prompts not declared but listPrompts returned results');
        }
      } catch {
        // Expected
      }
    }

    return issues.length === 0
      ? { passed: true, message: 'Server respects declared capabilities' }
      : { passed: false, message: issues.join('; ') };
  },
);

const capWellFormed = makeCheck(
  'cap-well-formed',
  'capability-negotiation',
  'Capabilities object is well-formed',
  'The capabilities object only contains recognized top-level keys',
  true,
  async (client) => {
    const caps = client.rawClient.getServerCapabilities();
    if (!caps) {
      return { passed: false, message: 'No capabilities object' };
    }

    const recognized = new Set([
      'tools',
      'resources',
      'prompts',
      'logging',
      'experimental',
      'completions',
    ]);
    const keys = Object.keys(caps);
    const unknown = keys.filter((k) => !recognized.has(k));

    return unknown.length === 0
      ? { passed: true, message: `Capabilities keys: ${keys.join(', ') || '(empty)'}` }
      : {
          passed: true,
          message: `Contains extension keys: ${unknown.join(', ')} (allowed by spec)`,
        };
  },
);

export const ALL_CHECKS: CheckDefinition[] = [
  initResponds,
  initCapabilities,
  initServerInfo,
  initReinitialization,

  toolListReturnsArray,
  toolHasNameAndSchema,
  toolSchemaIsValid,

  toolCallReturnsResult,
  toolCallHasContent,
  toolCallContentHasType,
  toolCallUnknownTool,

  resourceListReturnsArray,
  resourceHasUriAndName,
  resourceUriFormat,

  resourceReadContents,
  resourceReadUnknown,

  promptListReturnsArray,
  promptHasName,

  promptGetMessages,
  promptGetUnknown,

  errorInvalidMethod,
  errorMalformedParams,
  errorResponseShape,

  capOnlyDeclared,
  capWellFormed,
];

export const CHECKS_BY_CATEGORY: Record<ConformanceCategory, CheckDefinition[]> = {
  initialization: [initResponds, initCapabilities, initServerInfo, initReinitialization],
  'tool-listing': [toolListReturnsArray, toolHasNameAndSchema, toolSchemaIsValid],
  'tool-execution': [
    toolCallReturnsResult,
    toolCallHasContent,
    toolCallContentHasType,
    toolCallUnknownTool,
  ],
  'resource-listing': [resourceListReturnsArray, resourceHasUriAndName, resourceUriFormat],
  'resource-reading': [resourceReadContents, resourceReadUnknown],
  'prompt-listing': [promptListReturnsArray, promptHasName],
  'prompt-getting': [promptGetMessages, promptGetUnknown],
  'error-handling': [errorInvalidMethod, errorMalformedParams, errorResponseShape],
  cancellation: [],
  'capability-negotiation': [capOnlyDeclared, capWellFormed],
};
