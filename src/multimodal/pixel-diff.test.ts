import { describe, it, expect } from 'vitest';
import { compareImages } from './pixel-diff.js';

describe('compareImages', () => {
  it('returns 100% match for identical buffers', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 10, 20, 30, 40, 50]);
    const result = compareImages(buf, buf);

    expect(result.matchPercent).toBe(100);
    expect(result.diffPixels).toBe(0);
    expect(result.totalPixels).toBe(buf.length);
  });

  it('returns 0% match for completely different buffers', () => {
    const a = Buffer.from([0, 0, 0, 0]);
    const b = Buffer.from([255, 255, 255, 255]);
    const result = compareImages(a, b);

    expect(result.matchPercent).toBe(0);
    expect(result.diffPixels).toBe(4);
    expect(result.totalPixels).toBe(4);
  });

  it('returns partial match for partially different buffers', () => {
    const a = Buffer.from([10, 20, 30, 40]);
    const b = Buffer.from([10, 20, 99, 99]);
    const result = compareImages(a, b);

    expect(result.matchPercent).toBe(50);
    expect(result.diffPixels).toBe(2);
    expect(result.totalPixels).toBe(4);
  });

  it('handles buffers of different lengths', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([1, 2, 3, 4, 5]);
    const result = compareImages(a, b);

    expect(result.totalPixels).toBe(5);
    expect(result.diffPixels).toBe(2);
    expect(result.matchPercent).toBe(60);
  });

  it('handles empty buffers', () => {
    const result = compareImages(Buffer.alloc(0), Buffer.alloc(0));

    expect(result.matchPercent).toBe(100);
    expect(result.diffPixels).toBe(0);
    expect(result.totalPixels).toBe(0);
  });

  it('handles one empty and one non-empty buffer', () => {
    const a = Buffer.alloc(0);
    const b = Buffer.from([1, 2, 3]);
    const result = compareImages(a, b);

    expect(result.totalPixels).toBe(3);
    expect(result.diffPixels).toBe(3);
    expect(result.matchPercent).toBe(0);
  });
});
