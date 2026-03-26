export type Sanitizer = (obj: Record<string, unknown>) => Record<string, unknown>;

export interface MatchResult {
  matches: boolean;
  diff: string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const defaultSanitizers = {
  timestamps: (obj: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...obj };
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'string' && ISO_DATE_RE.test(value)) result[key] = '[TIMESTAMP]';
    }
    return result;
  },
  uuids: (obj: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...obj };
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'string' && UUID_RE.test(value)) result[key] = '[UUID]';
    }
    return result;
  },
  numericIds: (obj: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...obj };
    for (const [key, value] of Object.entries(result)) {
      if (key.toLowerCase().endsWith('id') && typeof value === 'number') result[key] = '[ID]';
    }
    return result;
  },
};

export class SnapshotStore {
  private snapshots = new Map<string, string>();

  private applySanitizers(obj: Record<string, unknown>, sanitizers: Sanitizer[]): Record<string, unknown> {
    let result = { ...obj };
    for (const fn of sanitizers) result = fn(result);
    return result;
  }

  update(key: string, data: Record<string, unknown>, sanitizers: Sanitizer[] = []): void {
    const sanitized = this.applySanitizers(data, sanitizers);
    this.snapshots.set(key, JSON.stringify(sanitized, null, 2));
  }

  match(key: string, data: Record<string, unknown>, sanitizers: Sanitizer[] = []): MatchResult {
    const stored = this.snapshots.get(key);
    if (!stored) return { matches: false, diff: `no snapshot found for "${key}"` };
    const sanitized = JSON.stringify(this.applySanitizers(data, sanitizers), null, 2);
    if (stored === sanitized) return { matches: true, diff: null };
    const storedLines = stored.split('\n');
    const actualLines = sanitized.split('\n');
    const diffs: string[] = [];
    const maxLen = Math.max(storedLines.length, actualLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (storedLines[i] !== actualLines[i]) {
        diffs.push(`  line ${i + 1}:`);
        if (storedLines[i]) diffs.push(`    - ${storedLines[i]}`);
        if (actualLines[i]) diffs.push(`    + ${actualLines[i]}`);
      }
    }
    return { matches: false, diff: diffs.join('\n') };
  }

  toJSON(): Record<string, string> { return Object.fromEntries(this.snapshots); }

  loadFromJSON(data: Record<string, string>): void {
    for (const [key, value] of Object.entries(data)) this.snapshots.set(key, value);
  }
}
