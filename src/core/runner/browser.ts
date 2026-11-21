import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';

export interface BrowserOptions {
  /** Visible window (desktop hand-off). The clerk-box runs headless and uses live view. */
  visible?: boolean;
  /** Explicit Chromium/Chrome binary, e.g. /usr/bin/chromium on a Raspberry Pi. */
  executablePath?: string;
}

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINUX_CANDIDATES = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

/**
 * Picks a browser binary: PAKID_BROWSER_PATH, then the configured path, then
 * Playwright's own download if present, then an installed Chrome/Chromium.
 */
export async function launchBrowser(opts: BrowserOptions = {}): Promise<{ browser: Browser; context: BrowserContext }> {
  const explicit = process.env.PAKID_BROWSER_PATH ?? opts.executablePath;
  const launch = (executablePath?: string) =>
    chromium.launch({ headless: !opts.visible, ...(executablePath ? { executablePath } : {}) });

  let browser: Browser;
  if (explicit) {
    browser = await launch(explicit);
  } else {
    try {
      browser = await launch();
    } catch (err) {
      const fallback = [MAC_CHROME, ...LINUX_CANDIDATES].find((p) => existsSync(p));
      if (!fallback) {
        throw new Error(
          `No browser found. Install one with "npx playwright-core install chromium" or set PAKID_BROWSER_PATH. (${(err as Error).message.split('\n')[0]})`,
        );
      }
      browser = await launch(fallback);
    }
  }
  const context = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1280, height: 900 } });
  return { browser, context };
}
