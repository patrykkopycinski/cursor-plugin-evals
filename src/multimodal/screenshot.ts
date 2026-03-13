export interface ScreenshotOptions {
  width?: number;
  height?: number;
  fullPage?: boolean;
}

export async function captureScreenshot(
  html: string,
  options: ScreenshotOptions = {},
): Promise<Buffer | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = await (import('puppeteer' as string) as Promise<any>);
    const browser = await puppeteer.default.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.setViewport({
        width: options.width ?? 1280,
        height: options.height ?? 720,
      });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const screenshot = await page.screenshot({
        fullPage: options.fullPage ?? false,
        type: 'png',
      });

      return Buffer.from(screenshot);
    } finally {
      await browser.close();
    }
  } catch {
    console.warn('puppeteer not installed — visual regression tests will be skipped');
    return null;
  }
}
