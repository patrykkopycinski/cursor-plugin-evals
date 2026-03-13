# Multimodal Evaluation

Test visual output through screenshot capture, pixel-level comparison, and baseline management.

## Visual Regression Testing

Visual regression tests capture screenshots of rendered output and compare them against stored baselines to detect unintended visual changes.

## Screenshot Capture

The framework uses Puppeteer to capture screenshots of web pages or rendered HTML:

```typescript
import { captureScreenshot } from 'cursor-plugin-evals';
import type { ScreenshotOptions } from 'cursor-plugin-evals';

const options: ScreenshotOptions = {
  url: 'http://localhost:5601/app/dashboards',
  width: 1280,
  height: 720,
  waitForSelector: '.dashboard-container',
  delay: 1000, // wait for animations
};

const buffer = await captureScreenshot(options);
writeFileSync('screenshot.png', buffer);
```

## Pixel Diff Comparison

Compare two images and get a diff score:

```typescript
import { compareImages } from 'cursor-plugin-evals';
import type { DiffResult } from 'cursor-plugin-evals';

const result: DiffResult = await compareImages(
  'baseline.png',
  'current.png',
);

console.log(`Match: ${(result.matchPercent * 100).toFixed(2)}%`);
console.log(`Diff pixels: ${result.diffPixels}`);
console.log(`Total pixels: ${result.totalPixels}`);
```

The `DiffResult` contains:

| Field | Type | Description |
|-------|------|-------------|
| `matchPercent` | number | Fraction of matching pixels (0–1) |
| `diffPixels` | number | Number of differing pixels |
| `totalPixels` | number | Total pixels in the image |
| `diffImageBuffer` | Buffer | PNG buffer highlighting changed pixels in red |

## Baseline Management

Store and retrieve reference screenshots:

```typescript
import { saveBaseline, loadBaseline } from 'cursor-plugin-evals';

// Save a new baseline
await saveBaseline('dashboard-overview', screenshotBuffer);

// Load existing baseline
const baseline = await loadBaseline('dashboard-overview');
if (baseline) {
  const diff = await compareImages(baseline, currentScreenshot);
  if (diff.matchPercent < 0.95) {
    console.warn('Visual regression detected!');
  }
}
```

Baselines are stored in `.cursor-plugin-evals/baselines/` as PNG files.

## Using the Visual Regression Evaluator

The `visual-regression` evaluator integrates with the LLM eval layer:

```yaml
suites:
  - name: visual-tests
    layer: llm
    tests:
      - name: dashboard-render
        prompt: "Create a dashboard with a line chart of CPU usage"
        evaluators:
          - visual-regression
          - response-quality
```

The evaluator:
1. Captures a screenshot of the rendered output
2. Compares against the stored baseline
3. Scores as `1 - (diffPixels / totalPixels)`
4. Default threshold: `0.95` (95% match)

## Updating Baselines

When intentional visual changes are made, update the baselines:

```typescript
import { captureScreenshot, saveBaseline } from 'cursor-plugin-evals';

const screenshot = await captureScreenshot({ url: 'http://localhost:5601/app/dashboards' });
await saveBaseline('dashboard-overview', screenshot);
```

## VLM-as-Judge (Future)

A planned feature will use vision-language models (VLMs) to evaluate screenshots qualitatively — assessing layout, readability, and design quality beyond pixel comparison.

## See Also

- [Evaluators](./evaluators.md) — `visual-regression` evaluator details
- [LLM Eval Layer](./layers/llm.md)
- [CI/CD Integration](./ci-cd.md)
