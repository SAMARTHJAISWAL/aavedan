export type Board = 'greenhouse' | 'lever' | 'ashby';

export interface Company {
  name: string;
  board: Board;
  slug: string;
  /** Where most of its engineering is, for the board listing only. */
  hq?: string;
}

export interface Job {
  /** Stable across runs: board, company slug and the board's own posting id. */
  id: string;
  board: Board;
  company: string;
  companySlug: string;
  postingId: string;
  title: string;
  /** Every location the posting names, as written. */
  locations: string[];
  remote: boolean;
  department: string | null;
  url: string;
  applyUrl: string;
  postedAt: string | null;
  /** Plain text, HTML stripped. */
  description: string;
}
