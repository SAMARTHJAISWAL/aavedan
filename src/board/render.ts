// The board: one self-contained HTML page with the queue and every application. No server.
import fs from 'node:fs';
import path from 'node:path';
import type { Application, JobsFile } from '../jobs/store.ts';
import type { Profile } from '../profile/schema.ts';

export interface BoardData {
  name: string;
  generatedAt: string;
  demo: boolean;
  /** Shown under the name and in the banner on the public demo. */
  demoNote?: { who: string; banner: string };
  applications: Pick<Application, 'handle' | 'company' | 'title' | 'url' | 'location' | 'status' | 'reason' | 'at' | 'fitScore' | 'note'>[];
  queue: { handle: string; company: string; title: string; url: string; location: string; remote: boolean; score: number; oneLine: string; matches: string[]; gaps: string[]; postedAt: string | null; status: string; via: string | null }[];
  minFit: number;
}

export function boardData(jobs: JobsFile, apps: Application[], profile: Profile | null, demo = false): BoardData {
  const queue = Object.values(jobs.jobs)
    .filter(q => q.fit && !q.filtered && q.fit.eligible)
    .sort((a, b) => b.fit!.score - a.fit!.score)
    .slice(0, 300)
    .map(q => ({
      handle: q.handle, company: q.job.company, title: q.job.title, url: q.job.url,
      location: q.job.locations.join('; ') || (q.job.remote ? 'Remote' : ''), remote: q.job.remote,
      score: q.fit!.score, oneLine: q.fit!.oneLine, matches: q.fit!.matches, gaps: q.fit!.gaps,
      postedAt: q.job.postedAt, status: q.status, via: q.job.via ?? null,
    }));
  return {
    name: profile?.name ?? '',
    generatedAt: new Date().toISOString(),
    demo,
    applications: apps.map(({ handle, company, title, url, location, status, reason, at, fitScore, note }) => ({ handle, company, title, url, location, status, reason, at, fitScore, note })),
    queue,
    minFit: profile?.preferences.minFit ?? 70,
  };
}

export function writeBoard(jobs: JobsFile, apps: Application[], profile: Profile | null, out: string): string {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, boardHtml(boardData(jobs, apps, profile)));
  return out;
}

const TEMPLATE = fs.readFileSync(new URL('./board.html', import.meta.url), 'utf8');

export function boardHtml(data: BoardData): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
  return TEMPLATE.replace('/*__DATA__*/null', () => json);
}
