// The queue of found jobs and the record of applications, both plain JSON under me/.
import { paths } from '../config.ts';
import { readJson, writeJson } from '../util/store.ts';
import { csvCell } from '../util/text.ts';
import fs from 'node:fs';
import type { Job } from '../sources/types.ts';
import type { Fit } from './rank.ts';

export type JobStatus = 'new' | 'skipped' | 'held' | 'applied';

export interface QueuedJob {
  job: Job;
  fit: Fit | null;
  /** Why the rule filters dropped it, when they did. */
  filtered: string | null;
  status: JobStatus;
  firstSeen: string;
  /** Short handle for the CLI: a1, a2, ... assigned in the order jobs were first found. */
  handle: string;
}

export interface Application {
  jobId: string;
  handle: string;
  company: string;
  title: string;
  url: string;
  location: string;
  status: 'sent' | 'held' | 'rehearsed';
  /** For held forms: what only the user can do. */
  reason: string | null;
  at: string;
  fitScore: number | null;
  resume: string | null;
  coverLetter: string | null;
  /** Every answer that was on the page when it was sent, label → value. */
  answers: { label: string; value: string }[];
  note: string;
}

export interface JobsFile { lastFind: string | null; nextHandle: number; jobs: Record<string, QueuedJob> }

export const loadJobs = () => readJson<JobsFile>(paths.jobs, { lastFind: null, nextHandle: 1, jobs: {} });
export const saveJobs = (f: JobsFile) => writeJson(paths.jobs, f);

export function findJob(f: JobsFile, ref: string): QueuedJob | undefined {
  return Object.values(f.jobs).find(q => q.handle === ref || q.job.id === ref);
}

export function ranked(f: JobsFile, opts: { includeDone?: boolean } = {}): QueuedJob[] {
  return Object.values(f.jobs)
    .filter(q => q.fit && !q.filtered && q.fit.eligible && (opts.includeDone || q.status === 'new'))
    .sort((a, b) => (b.fit!.score - a.fit!.score) || a.job.company.localeCompare(b.job.company));
}

export const loadApplications = () => readJson<Application[]>(paths.applications, []);

export function recordApplication(a: Application): void {
  const all = loadApplications().filter(x => !(x.jobId === a.jobId && x.status !== 'sent'));
  all.unshift(a);
  writeJson(paths.applications, all);
  const head = ['at', 'status', 'company', 'title', 'location', 'fit', 'url', 'reason', 'resume', 'note'];
  const rows = all.map(x => [x.at, x.status, x.company, x.title, x.location, x.fitScore, x.url, x.reason, x.resume, x.note].map(csvCell).join(','));
  fs.writeFileSync(paths.applicationsCsv, [head.join(','), ...rows].join('\n') + '\n');
}
