import type { McpToolDefinition } from '../../core/types.js';

const DISTRACTOR_TEMPLATES: McpToolDefinition[] = [
  {
    name: 'send_email',
    description: 'Send an email to a recipient with subject and body',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body text' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Schedule a calendar event with title, date, and attendees',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start time in ISO 8601 format' },
        end: { type: 'string', description: 'End time in ISO 8601 format' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses of attendees' },
      },
      required: ['title', 'start'],
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt using AI',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Description of the image to generate' },
        size: { type: 'string', enum: ['256x256', '512x512', '1024x1024'] },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'translate_text',
    description: 'Translate text from one language to another',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to translate' },
        from: { type: 'string', description: 'Source language code' },
        to: { type: 'string', description: 'Target language code' },
      },
      required: ['text', 'to'],
    },
  },
  {
    name: 'weather_forecast',
    description: 'Get the weather forecast for a location',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name or coordinates' },
        days: { type: 'number', description: 'Number of forecast days (1-7)' },
      },
      required: ['location'],
    },
  },
  {
    name: 'play_music',
    description: 'Play a song or playlist by name or artist',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Song name, artist, or playlist' },
        shuffle: { type: 'boolean', description: 'Whether to shuffle playback' },
      },
      required: ['query'],
    },
  },
  {
    name: 'order_food',
    description: 'Order food from a restaurant for delivery',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant: { type: 'string', description: 'Restaurant name' },
        items: { type: 'array', items: { type: 'string' }, description: 'Menu items to order' },
        address: { type: 'string', description: 'Delivery address' },
      },
      required: ['restaurant', 'items'],
    },
  },
  {
    name: 'book_flight',
    description: 'Book a flight between two airports',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Departure airport code' },
        to: { type: 'string', description: 'Arrival airport code' },
        date: { type: 'string', description: 'Departure date in YYYY-MM-DD format' },
        passengers: { type: 'number', description: 'Number of passengers' },
      },
      required: ['from', 'to', 'date'],
    },
  },
  {
    name: 'set_alarm',
    description: 'Set an alarm for a specific time',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: 'string', description: 'Alarm time (HH:MM)' },
        label: { type: 'string', description: 'Alarm label' },
        repeat: { type: 'array', items: { type: 'string' }, description: 'Days to repeat' },
      },
      required: ['time'],
    },
  },
  {
    name: 'convert_currency',
    description: 'Convert an amount from one currency to another',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount to convert' },
        from: { type: 'string', description: 'Source currency code (e.g. USD)' },
        to: { type: 'string', description: 'Target currency code (e.g. EUR)' },
      },
      required: ['amount', 'from', 'to'],
    },
  },
  {
    name: 'send_sms',
    description: 'Send an SMS text message to a phone number',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Recipient phone number' },
        message: { type: 'string', description: 'Message text' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'take_screenshot',
    description: 'Capture a screenshot of the current screen',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', enum: ['full', 'window', 'selection'] },
        format: { type: 'string', enum: ['png', 'jpg'] },
      },
    },
  },
];

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generateTargetedDistractor(existingTool: McpToolDefinition): McpToolDefinition {
  const prefixes = ['advanced_', 'legacy_', 'internal_', 'beta_', 'v2_'];
  const suffixes = ['_extended', '_lite', '_pro', '_async', '_batch'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const usePrefix = Math.random() > 0.5;

  const name = usePrefix
    ? `${prefix}${existingTool.name}`
    : `${existingTool.name}${suffix}`;

  return {
    name,
    description: `${existingTool.description ?? 'Perform operation'} (${usePrefix ? prefix.replace('_', '') : suffix.replace('_', '')} variant)`,
    inputSchema: { ...existingTool.inputSchema },
  };
}

export function generateDistractors(
  mode: 'random' | 'targeted' | 'none',
  count: number,
  existingTools?: McpToolDefinition[],
): McpToolDefinition[] {
  if (mode === 'none' || count <= 0) return [];

  const existingNames = new Set(existingTools?.map((t) => t.name) ?? []);

  if (mode === 'random') {
    const available = DISTRACTOR_TEMPLATES.filter((t) => !existingNames.has(t.name));
    return shuffle(available).slice(0, count);
  }

  if (mode === 'targeted') {
    if (!existingTools || existingTools.length === 0) {
      return shuffle(DISTRACTOR_TEMPLATES).slice(0, count);
    }

    const distractors: McpToolDefinition[] = [];
    const usedNames = new Set(existingNames);

    for (let i = 0; i < count; i++) {
      const base = existingTools[i % existingTools.length];
      const distractor = generateTargetedDistractor(base);

      if (usedNames.has(distractor.name)) {
        distractor.name = `${distractor.name}_${i}`;
      }

      usedNames.add(distractor.name);
      distractors.push(distractor);
    }

    return distractors;
  }

  return [];
}

export { DISTRACTOR_TEMPLATES };
