import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Company, Job } from '../src/sources/types.ts';
import { ananya } from './fixtures/profile.ts';

// find() reads and writes me/jobs.json, so point it at a throwaway folder before loading it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aavedan-find-'));
vi.stubEnv('AAVEDAN_HOME', home);
const { find } = await import('../src/jobs/find.ts');
const { loadJobs } = await import('../src/jobs/store.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

const acme: Company = { name: 'Acme', board: 'lever', slug: 'acme', hq: 'Bengaluru' };
const job = (n: string): Job => ({
  id: `lever:acme:${n}`, board: 'lever', company: 'Acme', companySlug: 'acme', postingId: n, title: 'Data Analyst',
  locations: ['Bengaluru, India'], remote: false, department: null, url: `https://x/${n}`, applyUrl: `https://x/${n}/apply`,
  postedAt: new Date().toISOString(), description: 'SQL and Power BI.',
});
const run = (fetcher: () => Promise<Job[]>) =>
  find({ llm: {} as never, profile: ananya, companies: [acme], fetcher, feeds: false, rankLimit: 0 });

describe('find', () => {
  it('keeps the jobs of a board that failed to load, so they are not found again as new', async () => {
    await run(async () => [job('1')]);
    const handle = Object.values(loadJobs().jobs)[0]!.handle;

    const report = await run(async () => { throw new Error('timeout'); });
    expect(report.failedCompanies).toHaveLength(1);
    expect(Object.keys(loadJobs().jobs)).toEqual(['lever:acme:1']);

    const again = await run(async () => [job('1')]);
    expect(again.fresh).toBe(0);
    expect(Object.values(loadJobs().jobs)[0]!.handle).toBe(handle);
  });

  it('still drops untouched jobs that a board that loaded no longer lists', async () => {
    await run(async () => [job('2')]);
    expect(Object.keys(loadJobs().jobs)).toEqual(['lever:acme:2']);
  });
});
