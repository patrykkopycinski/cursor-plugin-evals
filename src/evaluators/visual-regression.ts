import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { captureScreenshot } from '../multimodal/screenshot.js';
import { compareImages } from '../multimodal/pixel-diff.js';
import { saveBaseline, loadBaseline } from '../multimodal/baselines.js';

export class VisualRegressionEvaluator implements Evaluator {
  readonly name = 'visual-regression';
  readonly kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const output = context.finalOutput ?? '';
    const isHtml = output.trim().startsWith('<') && output.includes('</');

    if (!isHtml) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skipped',
        explanation: 'Output is not HTML — visual regression check skipped',
      };
    }

    const screenshot = await captureScreenshot(output);

    if (!screenshot) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skipped_no_puppeteer',
        explanation: 'puppeteer not available — visual regression check skipped',
      };
    }

    const baselineName = context.testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const baseline = await loadBaseline(baselineName);

    if (!baseline) {
      await saveBaseline(baselineName, screenshot);
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'baseline_created',
        explanation: `Baseline saved for "${context.testName}" — first run`,
      };
    }

    const diff = compareImages(baseline, screenshot);
    const threshold = (context.config?.['visual-regression-threshold'] as number) ?? 95;
    const pass = diff.matchPercent >= threshold;

    return {
      evaluator: this.name,
      score: diff.matchPercent / 100,
      pass,
      label: pass ? 'match' : 'regression',
      explanation: `Visual match: ${diff.matchPercent.toFixed(1)}% (threshold: ${threshold}%)`,
      metadata: {
        matchPercent: diff.matchPercent,
        diffPixels: diff.diffPixels,
        totalPixels: diff.totalPixels,
      },
    };
  }
}
