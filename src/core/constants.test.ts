import { describe, it, expect } from 'vitest';
import { DATA_DIR, SERVICE_NAME } from './constants.js';

describe('constants', () => {
  it('DATA_DIR is a dot-prefixed directory name', () => {
    expect(DATA_DIR).toMatch(/^\./);
    expect(DATA_DIR).not.toContain('/');
    expect(DATA_DIR).not.toContain(' ');
  });

  it('SERVICE_NAME is a non-empty kebab-case string', () => {
    expect(SERVICE_NAME.length).toBeGreaterThan(0);
    expect(SERVICE_NAME).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('DATA_DIR starts with a dot followed by SERVICE_NAME', () => {
    // This invariant ensures renaming SERVICE_NAME automatically updates DATA_DIR
    expect(DATA_DIR).toBe(`.${SERVICE_NAME}`);
  });
});
