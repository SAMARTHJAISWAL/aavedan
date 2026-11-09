// Every path and setting in one place. Nothing about the user lives outside `me/` and `.cache/`.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.AAVEDAN_HOME ? path.resolve(process.env.AAVEDAN_HOME) : ROOT;

export const paths = {
  me: path.join(home, 'me'),
  profile: path.join(home, 'me', 'profile.json'),
  resume: path.join(home, 'me', 'resume.pdf'),
  companies: path.join(home, 'me', 'companies.json'),
  jobs: path.join(home, 'me', 'jobs.json'),
  applications: path.join(home, 'me', 'applications.json'),
  applicationsCsv: path.join(home, 'me', 'applications.csv'),
  answers: path.join(home, 'me', 'answers.json'),
  tailored: path.join(home, 'me', 'tailored'),
  usage: path.join(home, 'me', 'usage.jsonl'),
  chromeProfile: path.join(home, 'me', '.chrome'),
  cache: path.join(home, '.cache'),
  board: path.join(home, 'me', 'board.html'),
};

export const models = {
  /** Decisions with a fixed set of answers: fit scores, which detail goes in which box. */
  fast: process.env.AAVEDAN_FAST_MODEL ?? 'claude-haiku-5-5',
  /** Sentences people will read: tailored resumes, cover letters, open answers. */
  write: process.env.AAVEDAN_WRITE_MODEL ?? 'claude-opus-5-5',
};

/** Dollars per million tokens, for the cost log. */
export const prices: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

export const limits = {
  /** Postings first published longer ago than this are skipped. Big companies keep roles open for months. */
  maxAgeDays: 150,
  /** Jobs ranked per `find` run, best first after the filters. */
  rankPerRun: 60,
  /** Parallel requests to job boards. */
  fetchConcurrency: 6,
  /** Seconds to wait for a confirmation page after Submit. */
  confirmTimeoutS: 25,
};
