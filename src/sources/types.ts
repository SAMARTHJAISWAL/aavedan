/** Company boards aavedan reads directly, remote-job feeds, and single pages the person pasted. */
export type Board = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workable' | 'keka' | 'remotive' | 'remoteok' | 'himalayas' | 'jobicy' | 'linkedin' | 'naukri' | 'link';

/** Boards whose forms aavedan has been tested on; others are filled from the person's own browser. */
export const FORM_BOARDS: Board[] = ['greenhouse', 'lever', 'ashby'];

/** Sites whose applications need the person's own signed-in account: aavedan never fills them. */
export const OWN_ACCOUNT_BOARDS: Board[] = ['linkedin', 'naukri'];

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
  /** Plain text, HTML stripped. Empty until fetched for boards that list jobs without it. */
  description: string;
  /** The feed or site the posting came through, credited wherever it is shown. Null for company boards. */
  via?: string | null;
}
