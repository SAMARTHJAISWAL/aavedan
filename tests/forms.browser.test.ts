// Reads, fills and reads back the fixture forms in a real headless Chrome.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, fillOne, values, clickSubmit } from '../src/apply/fill.ts';
import { shows } from '../src/apply/match.ts';
import type { Field } from '../src/apply/page.ts';
import { comboForm, plainForm } from './fixtures/forms.ts';

let browser: Browser;
let page: Page;
const resume = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aavedan-')), 'resume.pdf');

beforeAll(async () => {
  fs.writeFileSync(resume, '%PDF-1.4\n%fixture\n');
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  page = await browser.newPage();
}, 60_000);
afterAll(async () => { await browser?.close(); });

const byLabel = (fields: Field[], re: RegExp) => {
  const f = fields.find(x => re.test(x.label));
  if (!f) throw new Error(`no field matching ${re}: ${fields.map(x => x.label).join(' | ')}`);
  return f;
};

describe('a plain form', () => {
  it('finds every question with its label, kind, options and whether it is required', async () => {
    await page.setContent(plainForm);
    const fields = await scan(page);
    const summary = fields.map(f => [f.kind, f.label, f.required, f.options.join('/')]);
    expect(summary).toEqual([
      ['text', 'Full name', true, ''],
      ['text', 'Email', true, ''],
      ['text', 'Phone', false, ''],
      ['file', 'Resume/CV', true, ''],
      ['select', 'Notice period', false, 'Immediate/15 days/30 days/60 days'],
      ['radio', 'Are you willing to work from our Bengaluru office?', false, 'Yes/No'],
      ['textarea', 'Why do you want to join us?', false, ''],
      ['checkbox', 'I agree to the privacy policy', false, 'I agree to the privacy policy'],
    ]);
    expect(byLabel(fields, /why/i).maxLength).toBe(500);
  });

  it('fills each kind and reads the same values back', async () => {
    await page.setContent(plainForm);
    const fields = await scan(page);
    const answers: [RegExp, string[]][] = [
      [/full name/i, ['Ananya Rao']], [/email/i, ['ananya.rao@example.com']], [/phone/i, ['+91 98450 12345']],
      [/resume/i, [resume]], [/notice/i, ['30 days']], [/bengaluru office/i, ['Yes']],
      [/why/i, ['I like payments.']], [/privacy/i, ['I agree to the privacy policy']],
    ];
    for (const [re, v] of answers) expect(await fillOne(page, byLabel(fields, re), { id: '', value: v })).toBeNull();
    const shown = await values(page);
    for (const [re, v] of answers) {
      const f = byLabel(fields, re);
      expect(shows(f.kind, f.inputType, v, shown[f.id] ?? ''), `${f.label}: ${shown[f.id]}`).toBe(true);
    }
    expect(shown[byLabel(fields, /resume/i).id]).toBe('resume.pdf');
  });

  it('refuses an option the form does not offer', async () => {
    await page.setContent(plainForm);
    const fields = await scan(page);
    expect(await fillOne(page, byLabel(fields, /notice/i), { id: '', value: ['90 days'] })).toMatch(/no option/);
  });

  it('finds the submit button', async () => {
    await page.setContent(plainForm.replace('<form>', '<form novalidate onsubmit="event.preventDefault(); document.body.dataset.sent = 1">'));
    expect(await clickSubmit(page)).toBe(true);
    expect(await page.evaluate(() => document.body.dataset.sent)).toBe('1');
  });
});

describe('dropdowns, searchable boxes, checkbox groups and Yes/No buttons', () => {
  it('reads dropdown options, and marks boxes that need typing as searchable', async () => {
    await page.setContent(comboForm);
    const fields = await scan(page);
    const country = byLabel(fields, /^country/i);
    expect(country.kind).toBe('combobox');
    expect(country.required).toBe(true);
    expect(country.options).toEqual(['India', 'Indonesia', 'Singapore', 'United States']);
    expect(byLabel(fields, /city/i).searchable).toBe(true);
    const group = byLabel(fields, /which countries/i);
    expect([group.kind, group.multi, group.options]).toEqual(['checkbox', true, ['India', 'Singapore', 'US']]);
    const yn = byLabel(fields, /sponsorship/i);
    expect([yn.kind, yn.options]).toEqual(['radio', ['Yes', 'No']]);
  });

  it('types into searchable boxes, picks the right suggestion, and reads choices shown outside the input', async () => {
    await page.setContent(comboForm);
    const fields = await scan(page);
    expect(await fillOne(page, byLabel(fields, /^country/i), { id: '', value: ['India'] })).toBeNull();
    expect(await fillOne(page, byLabel(fields, /city/i), { id: '', value: ['Pune'] })).toBeNull();
    expect(await fillOne(page, byLabel(fields, /which countries/i), { id: '', value: ['India', 'Singapore'] })).toBeNull();
    expect(await fillOne(page, byLabel(fields, /sponsorship/i), { id: '', value: ['No'] })).toBeNull();
    const shown = await values(page);
    expect(shown[byLabel(fields, /^country/i).id]).toBe('India');
    expect(shown[byLabel(fields, /city/i).id]).toBe('Pune, Maharashtra, India');
    expect(shown[byLabel(fields, /which countries/i).id]).toBe('India; Singapore');
    expect(shown[byLabel(fields, /sponsorship/i).id]).toBe('No');
  });

  it('takes the first suggestion for a city, as boards rank them, and reports what it picked', async () => {
    await page.setContent(comboForm);
    const fields = await scan(page);
    const answer = { id: '', value: ['Bengaluru, India'] };
    expect(await fillOne(page, byLabel(fields, /city/i), answer)).toBeNull();
    expect(answer.value).toEqual(['Bengaluru, Karnataka, India']);
  });

  it('will not guess between two close options anywhere else', async () => {
    await page.setContent(comboForm);
    const fields = await scan(page);
    expect(await fillOne(page, byLabel(fields, /^country/i), { id: '', value: ['Ind'] })).toMatch(/no option matches/);
  });
});
