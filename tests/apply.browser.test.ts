// One whole application against a local server: plan, ask, fill, read back, send, confirm, record.
// Claude is replaced by a fake that answers like the real one, so this runs offline.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { BrowserContext } from 'playwright-core';
import type { Llm } from '../src/llm.ts';
import type { Io } from '../src/apply/run.ts';
import type { QueuedJob } from '../src/jobs/store.ts';
import { ananya } from './fixtures/profile.ts';
import { plainForm } from './fixtures/forms.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aavedan-home-'));
process.env.AAVEDAN_HOME = home;
const { applyOne } = await import('../src/apply/run.ts');
const { loadApplications } = await import('../src/jobs/store.ts');
const { readJson } = await import('../src/util/store.ts');
const { paths } = await import('../src/config.ts');
const { chromium } = await import('playwright-core');

let server: http.Server;
let base = '';
let posted: string | null = null;
let ctx: BrowserContext;

beforeAll(async () => {
  fs.mkdirSync(path.join(home, 'me'), { recursive: true });
  fs.writeFileSync(path.join(home, 'me', 'resume.pdf'), '%PDF-1.4\n%fixture\n');
  const form = plainForm.replace('<form>', '<form method="post" action="/submit" enctype="multipart/form-data">');
  server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => { posted = body; res.writeHead(303, { location: '/thanks' }).end(); });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url === '/thanks' ? '<h1>Thank you for applying!</h1><p>We have received your application.</p>' : form);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  ctx = await browser.newContext();
}, 60_000);
afterAll(async () => { await ctx?.browser()?.close(); server?.close(); });

/** Answers the way the real mapping call does, from the field list in the prompt. */
const fakeClaude: Llm = {
  async json(req) {
    const content = typeof req.content === 'string' ? req.content : '';
    if (req.label === 'map-form') {
      const fields = content.split('<fields>\n')[1]!.split('\n</fields>')[0]!.split('\n').map(l => JSON.parse(l) as { id: string; label: string });
      const answer = (label: string): { action: string; value: string[]; source: string } => {
        if (/full name/i.test(label)) return { action: 'answer', value: ['Ananya Rao'], source: 'name' };
        if (/email/i.test(label)) return { action: 'answer', value: [ananya.email], source: 'email' };
        if (/phone/i.test(label)) return { action: 'answer', value: [ananya.phone], source: 'phone' };
        if (/notice/i.test(label)) return { action: 'answer', value: ['30 days'], source: 'notice period 30 days' };
        if (/why/i.test(label)) return { action: 'write', value: [], source: '' };
        return { action: 'ask', value: [], source: '' }; // the office question and the consent
      };
      return { fields: fields.map(f => ({ id: f.id, ...answer(f.label) })) } as never;
    }
    if (req.label === 'write-answers') {
      const ids = [...content.matchAll(/"id":"(f\d+)"/g)].map(m => m[1]!);
      return { answers: ids.map(id => ({ id, text: 'At Paysetu I built the refunds service in Go, and I would like to keep working on payments.' })) } as never;
    }
    throw new Error(`unexpected call ${req.label}`);
  },
};

const job = (): QueuedJob => ({
  handle: 'a1', status: 'new', filtered: null, firstSeen: new Date().toISOString(),
  fit: { score: 80, eligible: true, eligibilityNote: '', matches: [], gaps: [], oneLine: 'Payments.' },
  job: {
    id: 'lever:acme:1', board: 'lever', company: 'Acme', companySlug: 'acme', postingId: '1', title: 'Backend Engineer',
    locations: ['Bengaluru, India'], remote: false, department: null, url: `${base}/`, applyUrl: `${base}/`, postedAt: null, description: 'Go and payments.',
  },
});

const io = (over: Partial<Io> = {}): Io & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    interactive: true,
    log: () => {},
    async ask(q, options) { asked.push(q); return /office/i.test(q) ? ['Yes'] : /privacy/i.test(q) ? [options[0]!] : null; },
    async decide() { return 'send'; },
    async waitFor() {},
    ...over,
  };
};

describe('an application from start to finish', () => {
  it('rehearses without sending, asks only required questions the profile cannot answer, and leaves optional ones', async () => {
    const strict = plainForm.replace('<form>', '<form method="post" action="/submit" enctype="multipart/form-data">').replace('name="office" value="y"', 'name="office" value="y" required');
    const handler = server.listeners('request')[0] as http.RequestListener;
    server.removeAllListeners('request');
    server.on('request', (req, res) => (req.method === 'GET' && req.url === '/' ? (res.writeHead(200, { 'content-type': 'text/html' }), res.end(strict)) : handler(req, res)));
    const people = io();
    const out = await applyOne({ ctx, llm: fakeClaude, profile: ananya, q: job(), io: people, send: false, tailorFirst: false, cover: false });
    expect(out.status).toBe('rehearsed');
    expect(out.reason).toBeNull();
    expect(posted).toBeNull();
    expect(people.asked.map(q => q.split('  (')[0])).toEqual(['Are you willing to work from our Bengaluru office?']);
    // The person's answer is kept for the next form.
    expect(readJson<{ question: string; answer: string }[]>(paths.answers, []).map(m => m.answer)).toEqual(['Yes']);
    server.removeAllListeners('request');
    server.on('request', handler);
  }, 60_000);

  it('sends after a yes, sees the confirmation, and records every answer', async () => {
    const out = await applyOne({ ctx, llm: fakeClaude, profile: ananya, q: job(), io: io(), send: true, tailorFirst: false, cover: false });
    expect(out).toEqual({ status: 'sent', reason: null });
    expect(posted).toContain('Ananya Rao');
    expect(posted).toContain('filename="resume.pdf"');
    expect(posted).toContain('30 days');
    const rec = loadApplications()[0]!;
    expect(rec.status).toBe('sent');
    expect(rec.answers.find(a => /why/i.test(a.label))!.value).toMatch(/^At Paysetu/);
  }, 60_000);

  it('holds a form when nobody is there to answer, and does not send it', async () => {
    posted = null;
    fs.rmSync(paths.answers, { force: true });
    const out = await applyOne({ ctx, llm: fakeClaude, profile: ananya, q: job(), io: io({ interactive: false, ask: async () => null }), send: true, tailorFirst: false, cover: false });
    expect(out.status).toBe('sent'); // both unanswered questions are optional, so the form is complete
    posted = null;
    const strict = plainForm.replace('name="office" value="y"', 'name="office" value="y" required');
    server.removeAllListeners('request');
    server.on('request', (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(strict); });
    const held = await applyOne({ ctx, llm: fakeClaude, profile: ananya, q: job(), io: io({ interactive: false, ask: async () => null }), send: true, tailorFirst: false, cover: false });
    expect(held.status).toBe('held');
    expect(held.reason).toMatch(/Bengaluru office.*required and empty/);
    expect(posted).toBeNull();
  }, 60_000);
});
