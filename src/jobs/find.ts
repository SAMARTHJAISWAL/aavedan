// `aavedan find`: read every board, drop what the rules rule out, rank the rest with Claude.
import type { Profile } from '../profile/schema.ts';
import type { Llm } from '../llm.ts';
import type { Company, Job } from '../sources/types.ts';
import { listJobs } from '../sources/boards.ts';
import { judge } from './filter.ts';
import { rankJob } from './rank.ts';
import { loadJobs, saveJobs, type QueuedJob } from './store.ts';
import { limits } from '../config.ts';
import { mapLimit } from '../util/store.ts';

export interface FindReport {
  companies: number;
  failedCompanies: string[];
  seen: number;
  fresh: number;
  passedRules: number;
  ranked: number;
  good: number;
  dropped: Record<string, number>;
}

export async function find(opts: { llm: Llm; profile: Profile; companies: Company[]; rankLimit?: number; log?: (s: string) => void; fetcher?: (c: Company) => Promise<Job[]> }): Promise<FindReport> {
  const log = opts.log ?? (() => {});
  const fetcher = opts.fetcher ?? listJobs;
  const failed: string[] = [];
  const lists = await mapLimit(opts.companies, limits.fetchConcurrency, async c => {
    try {
      return await fetcher(c);
    } catch (e) {
      failed.push(`${c.name} (${(e as Error).message})`);
      return [];
    }
  });
  const all = lists.flat();
  log(`Read ${all.length} postings from ${opts.companies.length - failed.length} companies.`);

  const file = loadJobs();
  const now = new Date().toISOString();
  let fresh = 0;
  const dropped: Record<string, number> = {};
  for (const job of all) {
    const prev = file.jobs[job.id];
    const verdict = judge(job, opts.profile);
    const filtered = verdict.pass ? null : verdict.reason;
    if (!verdict.pass) {
      const bucket = verdict.reason.split(':')[0]!.replace(/\d+/g, 'N');
      dropped[bucket] = (dropped[bucket] ?? 0) + 1;
    }
    if (prev) {
      // Keep the status and rating; refresh the posting itself and the rule verdict (the profile may have changed).
      prev.job = job;
      prev.filtered = filtered;
      if (filtered && prev.status === 'new' && !prev.fit) delete file.jobs[job.id];
      continue;
    }
    // Only jobs that pass the rules are kept; the rest are read again, and judged again, on every find.
    if (filtered) continue;
    fresh++;
    file.jobs[job.id] = { job, fit: null, filtered, status: 'new', firstSeen: now, handle: `a${file.nextHandle++}` };
  }
  // Jobs that are no longer listed are closed; keep them only if something was done with them.
  const live = new Set(all.map(j => j.id));
  for (const [id, q] of Object.entries(file.jobs)) if (!live.has(id) && q.status === 'new') delete file.jobs[id];

  const toRank = Object.values(file.jobs)
    .filter(q => !q.filtered && !q.fit && q.status === 'new')
    .sort((a, b) => (b.job.postedAt ?? '').localeCompare(a.job.postedAt ?? ''))
    .slice(0, opts.rankLimit ?? limits.rankPerRun);
  log(`${Object.values(file.jobs).filter(q => !q.filtered).length} pass your rules; rating ${toRank.length} new ones with Claude…`);
  let done = 0;
  await mapLimit(toRank, 6, async (q: QueuedJob) => {
    try {
      q.fit = await rankJob(opts.llm, q.job, opts.profile);
    } catch (e) {
      log(`  could not rate ${q.job.company} · ${q.job.title}: ${(e as Error).message}`);
    }
    if (++done % 10 === 0) { saveJobs(file); log(`  ${done}/${toRank.length}`); }
  });
  file.lastFind = now;
  saveJobs(file);

  const passed = Object.values(file.jobs).filter(q => !q.filtered);
  const passedNow = all.filter(j => file.jobs[j.id] && !file.jobs[j.id]!.filtered).length;
  return {
    companies: opts.companies.length,
    failedCompanies: failed,
    seen: all.length,
    fresh,
    passedRules: passedNow,
    ranked: toRank.filter(q => q.fit).length,
    good: passed.filter(q => q.fit && q.fit.eligible && q.fit.score >= opts.profile.preferences.minFit && q.status === 'new').length,
    dropped,
  };
}
