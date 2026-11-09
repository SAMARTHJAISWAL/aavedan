// Puts answers on the page the way a person would: typing, clicking options, attaching files.
import type { Page, Locator } from 'playwright-core';
import { extractFields, readValues, type Field } from './page.ts';
import { pickOption, norm } from './match.ts';

const OPTION = '[role="option"], [class*="select__option" i]';

export async function scan(page: Page): Promise<Field[]> {
  const fields = await page.evaluate(extractFields);
  for (const f of fields) if (f.kind === 'combobox') await readComboOptions(page, f);
  return fields;
}

export const values = (page: Page) => page.evaluate(readValues);

const el = (page: Page, id: string) => page.locator(`[data-aavedan="${id}"]`).first();

async function visibleOptions(page: Page): Promise<{ text: string; loc: Locator }[]> {
  const locs = await page.locator(OPTION).all();
  const out: { text: string; loc: Locator }[] = [];
  for (const loc of locs.slice(0, 400)) {
    if (!(await loc.isVisible().catch(() => false))) continue;
    const text = ((await loc.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (text && !/^(no options|loading|type to search)/i.test(text)) out.push({ text, loc });
  }
  return out;
}

async function typeAndRead(page: Page, target: Locator, query: string): Promise<{ text: string; loc: Locator }[]> {
  await target.click({ timeout: 6000 });
  await target.fill('').catch(() => {});
  await target.pressSequentially(query, { delay: 25 });
  let opts: { text: string; loc: Locator }[] = [];
  for (let i = 0; i < 12 && !opts.length; i++) {
    await page.waitForTimeout(300);
    opts = await visibleOptions(page);
  }
  return opts;
}

/** Opens a dropdown just long enough to read its options. Ones that need typing are marked searchable. */
async function readComboOptions(page: Page, f: Field): Promise<void> {
  const input = el(page, f.id);
  try {
    await input.scrollIntoViewIfNeeded();
    await input.click({ timeout: 4000 });
    await page.waitForTimeout(350);
    const opts = await visibleOptions(page);
    f.options = [...new Set(opts.map(o => o.text))].slice(0, 300);
    f.searchable = f.options.length === 0;
  } catch {
    f.searchable = true;
  } finally {
    await page.keyboard.press('Escape').catch(() => {});
    await input.blur().catch(() => {});
  }
}

const SUGGESTION = `${OPTION}, [class*="dropdown-location" i], [class*="dropdown-results" i] > *, .pac-item, [class*="suggestion" i] li, [class*="autocomplete" i] li`;

/**
 * Location boxes often search as you type and keep only a picked suggestion. Type the city key by key,
 * take the first suggestion for that city (lists are ranked), and fall back to the typed text when none appears.
 */
async function fillLocation(page: Page, target: Locator, text: string, a: Answer): Promise<null> {
  const city = text.split(',')[0]!.trim();
  await target.click({ timeout: 6000 });
  await target.fill('');
  await target.pressSequentially(city, { delay: 35 });
  let picked = false;
  for (let i = 0; i < 8 && !picked; i++) {
    await page.waitForTimeout(300);
    for (const loc of (await page.locator(SUGGESTION).all()).slice(0, 30)) {
      if (!(await loc.isVisible().catch(() => false))) continue;
      const t = ((await loc.innerText().catch(() => '')) || '').trim();
      if (t && norm(t).startsWith(norm(city))) { await loc.click({ timeout: 4000 }); picked = true; break; }
    }
  }
  if (!picked) await target.fill(text);
  await target.blur().catch(() => {});
  await page.waitForTimeout(300);
  a.value = [(await target.inputValue().catch(() => '')) || text];
  return null;
}

export interface Answer {
  id: string;
  /** Text for text fields; one or more option labels for choice fields; a file path for files. */
  value: string[];
}

/** Fills one control. Returns null on success or a reason it could not. */
export async function fillOne(page: Page, f: Field, a: Answer): Promise<string | null> {
  const target = el(page, f.id);
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const want = a.value;
  try {
    switch (f.kind) {
      case 'text':
      case 'textarea': {
        const text = want[0] ?? '';
        if (f.kind === 'text' && /location|city/i.test(f.label)) return await fillLocation(page, target, text, a);
        await target.fill(text, { timeout: 8000 });
        await target.blur().catch(() => {});
        return null;
      }
      case 'select': {
        const labels = want.map(w => pickOption(f.options, w));
        if (labels.some(l => !l)) return `no option matches “${want.join(', ')}”`;
        await target.selectOption(labels.map(l => ({ label: l! })), { timeout: 8000 });
        return null;
      }
      case 'radio':
      case 'checkbox': {
        for (const w of want) {
          const opt = pickOption(f.options, w);
          if (!opt) return `no option matches “${w}”`;
          const k = f.options.indexOf(opt);
          const o = page.locator(`[data-aavedan-opt="${f.id}:${k}"]`).first();
          const isInput = await o.evaluate(n => n.tagName === 'INPUT');
          if (isInput) await o.check({ force: true, timeout: 8000 });
          else await o.click({ timeout: 8000 });
        }
        return null;
      }
      case 'combobox': {
        const isPlace = /location|city|where do you live|residence/i.test(f.label);
        const chosen: string[] = [];
        for (const w of want) {
          // For a place, the city alone finds the board's own spelling ("Bengaluru, Karnataka, India").
          const query = isPlace ? w.split(',')[0]!.trim() : w.split(/\s+/).slice(0, 4).join(' ').slice(0, 40);
          let opts = await typeAndRead(page, target, query);
          const pool = f.options.length ? opts.filter(o => f.options.includes(o.text)) : opts;
          let best = pickOption((pool.length ? pool : opts).map(o => o.text), w);
          if (!best && isPlace) best = opts.find(o => norm(o.text).startsWith(norm(query)))?.text ?? null;
          if (!best && f.searchable) {
            // Long lists (schools, employers) end in "Other"; a person would pick it, and the form usually asks for the name next.
            opts = await typeAndRead(page, target, 'Other');
            best = opts.find(o => /^other\b/i.test(o.text))?.text ?? null;
          }
          if (!best) {
            await page.keyboard.press('Escape');
            return `no option matches “${w}”${opts.length ? ` (offered: ${opts.slice(0, 4).map(o => o.text).join(' / ')})` : ''}`;
          }
          await opts.find(o => o.text === best)!.loc.click({ timeout: 6000 });
          chosen.push(best);
          await page.waitForTimeout(150);
        }
        a.value = chosen;
        return null;
      }
      case 'file': {
        await target.setInputFiles(want[0]!, { timeout: 10_000 });
        a.value = [want[0]!.split(/[\\/]/).pop()!];
        await page.waitForTimeout(1200); // boards upload or parse the file right away
        return null;
      }
    }
  } catch (e) {
    return (e as Error).message.split('\n')[0]!;
  }
}

/** A human check that only the person can complete. */
export async function humanCheckVisible(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (!/hcaptcha|recaptcha|turnstile|challenges\.cloudflare/i.test(frame.url())) continue;
    if (/api2\/anchor|checkbox|invisible/i.test(frame.url()) && !/bframe|challenge/i.test(frame.url())) continue;
    const handle = await frame.frameElement().catch(() => null);
    const box = await handle?.boundingBox().catch(() => null);
    if (box && box.width > 150 && box.height > 150) return true;
  }
  return false;
}

const CONFIRMED = /thank(s| you)[^.]{0,40}(appl|interest|submitt)|application (has been |was )?(received|submitted)|we('ve| have) received your application|successfully (submitted|applied)|your application is (in|on its way)/i;

export async function confirmed(page: Page): Promise<boolean> {
  if (/confirmation|thank|success|submitted/i.test(page.url())) return true;
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return CONFIRMED.test(text);
}

export async function clickSubmit(page: Page): Promise<boolean> {
  const candidates = [
    page.locator('button[type="submit"]:visible, input[type="submit"]:visible'),
    page.getByRole('button', { name: /^(submit( application)?|apply|send application)$/i }),
  ];
  for (const c of candidates) {
    const n = await c.count();
    for (let i = n - 1; i >= 0; i--) {
      const b = c.nth(i);
      const text = ((await b.innerText().catch(() => '')) || (await b.getAttribute('value')) || '').trim();
      if (/search|subscribe|newsletter/i.test(text)) continue;
      if (!(await b.isVisible().catch(() => false))) continue;
      await b.scrollIntoViewIfNeeded().catch(() => {});
      await b.click({ timeout: 8000 });
      return true;
    }
  }
  return false;
}
