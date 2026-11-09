// One Chrome window with its own profile, separate from the user's everyday browser.
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import fs from 'node:fs';
import { paths } from '../config.ts';

export async function openBrowser(opts: { headless?: boolean } = {}): Promise<BrowserContext> {
  fs.mkdirSync(paths.chromeProfile, { recursive: true });
  const launch = (channel: string | undefined) =>
    chromium.launchPersistentContext(paths.chromeProfile, {
      channel,
      headless: opts.headless ?? false,
      viewport: null,
      args: ['--window-size=1280,900'],
    });
  try {
    return await launch('chrome');
  } catch (e) {
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
