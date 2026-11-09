// One Chrome window with its own profile, separate from the user's everyday browser.
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import fs from 'node:fs';
import { paths } from '../config.ts';
import { execFileSync } from 'node:child_process';

/** Ends Chrome processes started with aavedan's profile directory, and nothing else. */
function closeLeftover(): void {
  if (process.platform === 'win32') return;
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m && m[2]!.includes(`--user-data-dir=${paths.chromeProfile}`) && !m[2]!.includes('--type=')) process.kill(Number(m[1]), 'SIGTERM');
    }
  } catch { /* nothing to close */ }
}

export async function openBrowser(opts: { headless?: boolean } = {}): Promise<BrowserContext> {
  fs.mkdirSync(paths.chromeProfile, { recursive: true });
  const launch = (channel: string | undefined) =>
    chromium.launchPersistentContext(paths.chromeProfile, {
      channel,
      headless: opts.headless ?? false,
      viewport: null,
      // Keep Chrome's own sandbox on (Playwright turns it off by default, which shows a warning bar).
      chromiumSandbox: true,
      args: ['--window-size=1280,900'],
    });
  try {
    return await launch('chrome');
  } catch (e) {
    if (/already in use|existing browser session/i.test((e as Error).message)) {
      // A window from an earlier run that did not close. It uses aavedan's own profile, never the user's Chrome.
      closeLeftover();
      await new Promise(r => setTimeout(r, 1500));
      return launch('chrome');
    }
    if (!/executable|not found|install/i.test((e as Error).message)) throw e;
    return launch(undefined); // A Playwright-installed Chromium, when Chrome itself is missing.
  }
}

/** Greenhouse company sites (stripe.com/jobs…) wrap the form; the embed URL is the form alone. */
export function formUrl(job: { board: string; companySlug: string; postingId: string; applyUrl: string }): string {
  if (job.board === 'greenhouse') return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(job.companySlug)}&token=${encodeURIComponent(job.postingId)}`;
  return job.applyUrl;
}

export async function newTab(ctx: BrowserContext, url: string): Promise<Page> {
  const page = ctx.pages().find(p => p.url() === 'about:blank') ?? (await ctx.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  return page;
}
