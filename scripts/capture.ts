// Makes the README images: docs/og.png (share card) and docs/rehearsal-samarth.png (a real form, filled in rehearsal).
// AAVEDAN_HOME=<a home with the made-up profile> node scripts/capture.ts [job id]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, paths } from '../src/config.ts';
import { claude } from '../src/llm.ts';
import { loadProfile } from '../src/profile/init.ts';
import { loadJobs, findJob } from '../src/jobs/store.ts';
import { formUrl } from '../src/apply/browser.ts';
import { scan, fillOne } from '../src/apply/fill.ts';
import { plan } from '../src/apply/plan.ts';

const docs = path.join(ROOT, 'docs');
fs.mkdirSync(docs, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

// Share card
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,650&family=Yatra+One&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
body{margin:0;width:1200px;height:630px;background:#f7f2e8;color:#1f1b16;font-family:'Bricolage Grotesque';display:grid;grid-template-columns:1.1fr 1fr;gap:40px;padding:64px 70px;box-sizing:border-box}
h1{margin:0;display:flex;align-items:baseline;gap:18px}.l{font-family:Fraunces;font-size:92px;letter-spacing:-.03em}.d{font-family:'Yatra One';font-size:78px;color:#b8461b}
p{font-size:28px;line-height:1.35;margin:26px 0 0;color:#3d362e}.tag{margin-top:34px;display:flex;gap:10px;flex-wrap:wrap}.tag span{background:#f6e2d5;color:#8a3b12;border-radius:999px;padding:6px 14px;font-size:19px;font-weight:600}
.cards{display:flex;flex-direction:column;gap:14px;justify-content:center}.c{background:#fffdf8;border:1px solid #e5dccc;border-radius:16px;padding:16px 18px;display:flex;gap:14px;align-items:center;box-shadow:0 6px 20px rgba(60,40,20,.06)}
.r{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;font-weight:600;font-size:19px;background:conic-gradient(#b8461b calc(var(--p)*1%),#e5dccc 0);position:relative;flex:none}.r:before{content:'';position:absolute;inset:5px;border-radius:50%;background:#fffdf8}.r b{position:relative}
.t{font-weight:600;font-size:20px}.s{color:#6b6257;font-size:16px}.ok{margin-left:auto;font-family:'JetBrains Mono';font-size:14px;color:#2e7a4e;background:#def0e3;border-radius:8px;padding:4px 8px}
</style></head><body><div><h1><span class="l">aavedan</span><span class="d">आवेदन</span></h1>
<p>Finds jobs in India, remote and worldwide, ranks them against your resume, fills each form in Chrome, checks every answer, and sends only what you approve.</p>
<div class="tag"><span>Greenhouse</span><span>Lever</span><span>Ashby</span><span>Claude</span><span>Playwright</span></div></div>
<div class="cards">
<div class="c"><div class="r" style="--p:72"><b>72</b></div><div><div class="t">Intermediate Data Engineer</div><div class="s">GitLab · Bengaluru</div></div><span class="ok">✓ 13/15 · 2 for you</span></div>
<div class="c"><div class="r" style="--p:62"><b>62</b></div><div><div class="t">Risk Analyst</div><div class="s">Paytm · Bengaluru</div></div><span class="ok">✓ every answer</span></div>
<div class="c"><div class="r" style="--p:62"><b>62</b></div><div><div class="t">Fraud Analyst</div><div class="s">CRED · Bengaluru</div></div><span class="ok">✓ every answer</span></div>
</div></body></html>`, { waitUntil: 'networkidle' });
await og.waitForTimeout(500);
await og.screenshot({ path: path.join(docs, 'og.png') });
console.log('wrote docs/og.png');

// A real form, filled in rehearsal (nothing is sent).
const ref = process.argv[2];
if (ref && fs.existsSync(paths.profile)) {
  const q = findJob(loadJobs(), ref);
  if (!q) throw new Error(`no job ${ref}`);
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(formUrl(q.job), { waitUntil: 'networkidle', timeout: 60_000 });
  const fields = await scan(page);
  const steps = await plan({ llm: claude, profile: loadProfile(), job: q.job, fields, memory: [], files: { resume: paths.resume, cover: null } });
  for (const s of steps) if (s.action === 'answer') await fillOne(page, s.field, { id: s.field.id, value: s.value });
  // The README is public: blur contact details in the screenshot.
  await page.addStyleTag({ content: 'input[type=email], input[type=tel], input[name=email], input[name=phone], #email, #phone { filter: blur(7px); }' });
  await page.evaluate(() => window.scrollTo(0, 0));
  const first = page.locator('[data-aavedan]').first();
  const box = await first.boundingBox();
  await page.screenshot({ path: path.join(docs, 'rehearsal-samarth.png'), clip: { x: 0, y: Math.max(0, (box?.y ?? 0) - 60), width: 900, height: 1000 } , fullPage: true });
  console.log('wrote docs/rehearsal-samarth.png');
}
await browser.close();
