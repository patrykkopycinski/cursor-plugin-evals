export interface DiffResult {
  matchPercent: number;
  diffPixels: number;
  totalPixels: number;
}

export function compareImages(baseline: Buffer, current: Buffer): DiffResult {
  const totalPixels = Math.max(baseline.length, current.length);

  if (totalPixels === 0) {
    return { matchPercent: 100, diffPixels: 0, totalPixels: 0 };
  }

  const minLen = Math.min(baseline.length, current.length);
  let diffBytes = Math.abs(baseline.length - current.length);

  for (let i = 0; i < minLen; i++) {
    if (baseline[i] !== current[i]) {
      diffBytes++;
    }
  }

  const matchPercent = ((totalPixels - diffBytes) / totalPixels) * 100;

  return {
    matchPercent,
    diffPixels: diffBytes,
    totalPixels,
  };
}
