// Readers for the three public job-board APIs. No sign-in, no scraping: each board publishes JSON.
import type { Board, Company, Job } from './types.ts';
import { htmlToText } from '../util/text.ts';

const UA = 'aavedan/0.1 (+https://github.com/SAMARTHJAISWAL/aavedan)';

export async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 404) return null;
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return r.json();
  }
}

const id = (board: Board, slug: string, postingId: string) => `${board}:${slug}:${postingId}`;

// ---------- Greenhouse ----------

interface GhJob {
  id: number; title: string; absolute_url: string; updated_at?: string; first_published?: string;
  location?: { name?: string }; offices?: { location?: string | null; name?: string }[];
  departments?: { name: string }[]; content?: string;
}

export function fromGreenhouse(c: Company, j: GhJob): Job {
  const locations = [j.location?.name, ...(j.offices ?? []).map(o => o.location || o.name)].filter((x): x is string => !!x);
  return {
    id: id('greenhouse', c.slug, String(j.id)),
    board: 'greenhouse', company: c.name, companySlug: c.slug, postingId: String(j.id),
    title: j.title.trim(),
    locations: [...new Set(locations)],
    remote: locations.some(l => /remote/i.test(l)),
    department: j.departments?.[0]?.name ?? null,
    url: j.absolute_url,
    applyUrl: j.absolute_url,
    postedAt: j.first_published ?? j.updated_at ?? null,
    description: htmlToText(j.content ?? ''),
  };
}

// ---------- Lever ----------

interface LeverJob {
  id: string; text: string; hostedUrl: string; applyUrl: string; createdAt?: number;
  categories?: { location?: string; allLocations?: string[]; department?: string; team?: string };
  workplaceType?: string; country?: string;
  descriptionPlain?: string; description?: string; openingPlain?: string; additionalPlain?: string;
  lists?: { text: string; content: string }[];
}

export function fromLever(c: Company, j: LeverJob): Job {
  const cat = j.categories ?? {};
  const locations = [...new Set([cat.location, ...(cat.allLocations ?? [])].filter((x): x is string => !!x))];
  if (j.country === 'IN' && !locations.some(l => /india/i.test(l))) locations.push('India');
  const parts = [
    j.openingPlain, j.descriptionPlain || htmlToText(j.description ?? ''),
    ...(j.lists ?? []).map(l => `${l.text}\n${htmlToText(l.content)}`),
    j.additionalPlain,
  ];
  return {
    id: id('lever', c.slug, j.id),
    board: 'lever', company: c.name, companySlug: c.slug, postingId: j.id,
    title: j.text.trim(),
    locations,
    remote: j.workplaceType === 'remote' || locations.some(l => /remote/i.test(l)),
    department: cat.department ?? cat.team ?? null,
    url: j.hostedUrl,
    applyUrl: j.applyUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    description: parts.filter(Boolean).join('\n\n').trim(),
  };
}

// ---------- Ashby ----------

interface AshbyJob {
  id: string; title: string; jobUrl: string; applyUrl: string; publishedAt?: string;
  location?: string; secondaryLocations?: { location: string }[]; isRemote?: boolean; workplaceType?: string;
  department?: string; descriptionPlain?: string; descriptionHtml?: string; isListed?: boolean;
  address?: { postalAddress?: { addressCountry?: string } };
}

export function fromAshby(c: Company, j: AshbyJob): Job {
  const locations = [j.location, ...(j.secondaryLocations ?? []).map(s => s.location)].filter((x): x is string => !!x);
  const country = j.address?.postalAddress?.addressCountry;
  if (country && !locations.some(l => l.toLowerCase().includes(country.toLowerCase()))) locations.push(country);
  return {
    id: id('ashby', c.slug, j.id),
    board: 'ashby', company: c.name, companySlug: c.slug, postingId: j.id,
    title: j.title.trim(),
    locations: [...new Set(locations)],
    remote: !!j.isRemote || j.workplaceType === 'Remote',
    department: j.department ?? null,
    url: j.jobUrl,
    applyUrl: j.applyUrl,
    postedAt: j.publishedAt ?? null,
    description: j.descriptionPlain?.trim() || htmlToText(j.descriptionHtml ?? ''),
  };
}

// ---------- Listing ----------

export async function listJobs(c: Company): Promise<Job[]> {
  switch (c.board) {
    case 'smartrecruiters': return (await import('./more.ts')).listSmartRecruiters(c);
    case 'workable': return (await import('./more.ts')).listWorkable(c);
    case 'greenhouse': {
      const d = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`)) as { jobs?: GhJob[] } | null;
      return (d?.jobs ?? []).map(j => fromGreenhouse(c, j));
    }
    case 'lever': {
      const d = (await getJson(`https://api.lever.co/v0/postings/${c.slug}?mode=json`)) as LeverJob[] | null;
      return (Array.isArray(d) ? d : []).map(j => fromLever(c, j));
    }
    case 'ashby': {
      const d = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}`)) as { jobs?: AshbyJob[] } | null;
      return (d?.jobs ?? []).filter(j => j.isListed !== false).map(j => fromAshby(c, j));
    }
    default:
      return [];
  }
}

// ---------- One link ----------

export interface ParsedLink { board: Board; slug: string; postingId: string | null }

/** Recognises a posting or board link from any of the three boards. */
export function parseLink(raw: string): ParsedLink | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const parts = u.pathname.split('/').filter(Boolean);
  const host = u.hostname.toLowerCase();
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // boards.greenhouse.io/acme/jobs/123, job-boards.(eu.)greenhouse.io/acme/jobs/123, boards.greenhouse.io/embed/job_app?for=acme&token=123
    if (parts[0] === 'embed') {
      const slug = u.searchParams.get('for');
      return slug ? { board: 'greenhouse', slug, postingId: u.searchParams.get('token') } : null;
    }
    if (!parts[0]) return null;
    const i = parts.indexOf('jobs');
    return { board: 'greenhouse', slug: parts[0], postingId: i >= 0 ? parts[i + 1] ?? null : null };
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    return parts[0] ? { board: 'lever', slug: parts[0], postingId: parts[1] ?? null } : null;
  }
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') {
    return parts[0] ? { board: 'smartrecruiters', slug: parts[0], postingId: parts[1]?.split('-')[0] ?? null } : null;
  }
  if (host === 'apply.workable.com') {
    return parts[0] ? { board: 'workable', slug: parts[0], postingId: parts[1] === 'j' ? parts[2] ?? null : null } : null;
  }
  if (host === 'jobs.ashbyhq.com') {
    return parts[0] ? { board: 'ashby', slug: decodeURIComponent(parts[0]), postingId: parts[1] ?? null } : null;
  }
  return null;
}

/** Fetches one posting from its link, or null when the link is not a posting on a known board. */
export async function jobFromLink(link: string, name?: string): Promise<Job | null> {
  const p = parseLink(link);
  if (!p?.postingId) return null;
  const c: Company = { name: name ?? p.slug, board: p.board, slug: p.slug };
  if (p.board === 'greenhouse') {
    const j = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${p.slug}/jobs/${p.postingId}`)) as (GhJob & { company_name?: string }) | null;
    return j ? fromGreenhouse({ ...c, name: name ?? j.company_name ?? p.slug }, j) : null;
  }
  if (p.board === 'lever') {
    const j = (await getJson(`https://api.lever.co/v0/postings/${p.slug}/${p.postingId}?mode=json`)) as LeverJob | null;
    return j ? fromLever(c, j) : null;
  }
  const all = await listJobs(c);
  const found = all.find(j => j.postingId === p.postingId) ?? null;
  if (found && !found.description) found.description = await (await import('./more.ts')).describe(found);
  return found;
}
