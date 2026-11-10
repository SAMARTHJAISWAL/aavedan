// More public sources: two more hiring platforms (SmartRecruiters, Workable) and four remote-job
// feeds (Remotive, Remote OK, Himalayas, Jobicy). Every one publishes its listings openly; the feeds
// ask for a link back and a mention, which aavedan shows as "via <source>" next to the original link.
// Naukri, LinkedIn and X are not here: they offer no open listings and forbid scraping.
import path from 'node:path';
import type { Company, Job } from './types.ts';
import { getJson } from './boards.ts';
import { htmlToText } from '../util/text.ts';
import { paths } from '../config.ts';
import { readJson, writeJson } from '../util/store.ts';

const UA = { 'user-agent': 'aavedan/0.1 (+https://github.com/SAMARTHJAISWAL/aavedan)' };
const id = (board: string, slug: string, postingId: string) => `${board}:${slug}:${postingId}`;

// ---------- SmartRecruiters ----------

interface SrPosting {
  id: string; name: string; releasedDate?: string; company?: { name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string };
  department?: { label?: string }; function?: { label?: string };
}

export async function listSmartRecruiters(c: Company): Promise<Job[]> {
  const out: Job[] = [];
  // Indian postings only: these companies list thousands of roles worldwide.
  for (let offset = 0; offset < 1000; offset += 100) {
    const d = (await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.slug)}/postings?limit=100&offset=${offset}&country=in`)) as { content?: SrPosting[]; totalFound?: number } | null;
    const page = d?.content ?? [];
    for (const p of page) {
      const loc = p.location?.fullLocation ?? [p.location?.city, p.location?.country === 'in' ? 'India' : p.location?.country].filter(Boolean).join(', ');
      const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(c.slug)}/${p.id}`;
      out.push({
        id: id('smartrecruiters', c.slug, p.id), board: 'smartrecruiters', company: c.name, companySlug: c.slug, postingId: p.id,
        title: p.name.trim(), locations: loc ? [loc] : ['India'], remote: !!p.location?.remote,
        department: p.department?.label ?? p.function?.label ?? null, url, applyUrl: url,
        postedAt: p.releasedDate ?? null, description: '', via: null,
      });
    }
    if (page.length < 100 || out.length >= (d?.totalFound ?? 0)) break;
  }
  return out;
}

async function describeSmartRecruiters(job: Job): Promise<string> {
  const d = (await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(job.companySlug)}/postings/${job.postingId}`)) as
    { jobAd?: { sections?: Record<string, { title?: string; text?: string }> }; postingUrl?: string } | null;
  const sections = Object.values(d?.jobAd?.sections ?? {});
  return sections.map(s => `${s.title ?? ''}\n${htmlToText(s.text ?? '')}`).join('\n\n').trim();
}

// ---------- Workable ----------

interface WkJob { shortcode: string; title: string; remote?: boolean; published?: string; department?: string[]; locations?: { city?: string; region?: string; country?: string }[]; location?: { city?: string; region?: string; country?: string } }

export async function listWorkable(c: Company): Promise<Job[]> {
  const out: Job[] = [];
  let token: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = await fetch(`https://apply.workable.com/api/v3/accounts/${encodeURIComponent(c.slug)}/jobs`, {
      method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) }),
    });
    if (!r.ok) break;
    const d = (await r.json()) as { results?: WkJob[]; nextPage?: string };
    for (const j of d.results ?? []) {
      const locs = (j.locations?.length ? j.locations : j.location ? [j.location] : []).map(l => [l.city, l.region, l.country].filter(Boolean).join(', '));
      const url = `https://apply.workable.com/${c.slug}/j/${j.shortcode}/`;
      out.push({
        id: id('workable', c.slug, j.shortcode), board: 'workable', company: c.name, companySlug: c.slug, postingId: j.shortcode,
        title: j.title.trim(), locations: locs, remote: !!j.remote, department: j.department?.[0] ?? null,
        url, applyUrl: `${url}apply/`, postedAt: j.published ?? null, description: '', via: null,
      });
    }
    token = d.nextPage;
    if (!token) break;
  }
  return out;
}

async function describeWorkable(job: Job): Promise<string> {
  const d = (await getJson(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(job.companySlug)}/jobs/${job.postingId}`)) as
    { description?: string; requirements?: string; benefits?: string } | null;
  return [d?.description, d?.requirements, d?.benefits].filter(Boolean).map(h => htmlToText(h!)).join('\n\n').trim();
}

/** Some boards list jobs without their text; fetch it only for jobs that passed the rules. */
export async function describe(job: Job): Promise<string> {
  if (job.description) return job.description;
  if (job.board === 'smartrecruiters') return describeSmartRecruiters(job);
  if (job.board === 'workable') return describeWorkable(job);
  if (job.board === 'linkedin' || job.board === 'naukri') {
    // One read of the public posting page, like opening the link from the alert. No retries: if the site
    // asks for a sign-in or a bot check, rate the job on what the alert email said.
    const page = await jobFromAnyPage(job.url);
    return page?.description || job.description;
  }
  return '';
}

// ---------- Keka ----------

interface KekaJob {
  id: number | string; title: string; description?: string; departmentName?: string; experience?: string;
  jobLocations?: { name?: string; city?: string; state?: string; countryName?: string }[]; publishedOn?: string;
}

/** Keka careers pages carry the portal id that unlocks their public jobs list (the one their own site uses). */
async function kekaPortalId(tenant: string): Promise<string | null> {
  const r = await fetch(`https://${tenant}.keka.com/careers/`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return null;
  return (await r.text()).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? null;
}

export function fromKeka(c: Company, j: KekaJob): Job {
  const locs = (j.jobLocations ?? []).map(l => [l.city?.trim(), l.state?.trim(), l.countryName?.trim() || 'India'].filter(Boolean).join(', '));
  const url = `https://${c.slug}.keka.com/careers/jobdetails/${j.id}`;
  return {
    id: id('keka', c.slug, String(j.id)), board: 'keka', company: c.name, companySlug: c.slug, postingId: String(j.id),
    title: j.title.trim(), locations: [...new Set(locs)], remote: locs.some(l => /remote/i.test(l)) || /remote/i.test(j.title),
    department: j.departmentName ?? null, url, applyUrl: url, postedAt: j.publishedOn ?? null,
    // Keka states experience as a field; put it in the text so the years rule sees it.
    description: [j.experience ? `Experience: ${j.experience} of experience` : '', htmlToText(j.description ?? '')].filter(Boolean).join('\n\n'),
    via: null,
  };
}

export async function listKeka(c: Company): Promise<Job[]> {
  const portal = await kekaPortalId(c.slug);
  if (!portal) return [];
  const d = (await getJson(`https://${c.slug}.keka.com/careers/api/embedjobs/default/active/${portal}`)) as KekaJob[] | null;
  return (Array.isArray(d) ? d : []).map(j => fromKeka(c, j));
}

// ---------- Remote-job feeds ----------

/** The feeds ask callers not to fetch more than a few times a day; results are cached for six hours. */
async function cachedFeed(name: string, load: () => Promise<Job[]>): Promise<Job[]> {
  const file = path.join(paths.cache, 'feeds', `${name}.json`);
  const hit = readJson<{ at: number; jobs: Job[] } | null>(file, null);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.jobs;
  const jobs = await load();
  writeJson(file, { at: Date.now(), jobs });
  return jobs;
}

const feedJob = (via: string, slug: string, j: { id: string; company: string; title: string; locations: string[]; url: string; applyUrl?: string; postedAt: string | null; html: string; department?: string | null }): Job => ({
  id: id(slug, slug, j.id), board: slug as Job['board'], company: j.company.trim(), companySlug: slug, postingId: j.id,
  title: j.title.trim(), locations: j.locations.length ? j.locations : ['Anywhere'], remote: true,
  department: j.department ?? null, url: j.url, applyUrl: j.applyUrl ?? j.url, postedAt: j.postedAt,
  description: htmlToText(j.html), via,
});

async function remotive(): Promise<Job[]> {
  const out: Job[] = [];
  for (const category of ['software-dev', 'data', 'devops', 'qa']) {
    const d = (await getJson(`https://remotive.com/api/remote-jobs?category=${category}`)) as { jobs?: { id: number; url: string; title: string; company_name: string; category: string; publication_date: string; candidate_required_location: string; description: string }[] } | null;
    for (const j of d?.jobs ?? []) out.push(feedJob('Remotive', 'remotive', { id: String(j.id), company: j.company_name, title: j.title, locations: [`Remote - ${j.candidate_required_location || 'Worldwide'}`], url: j.url, postedAt: j.publication_date, html: j.description, department: j.category }));
  }
  return out;
}

async function remoteOk(): Promise<Job[]> {
  const d = (await getJson('https://remoteok.com/api')) as ({ id?: string; legal?: string; company?: string; position?: string; location?: string; url?: string; apply_url?: string; date?: string; description?: string })[] | null;
  return (d ?? []).filter(j => j.id && j.position).map(j => feedJob('Remote OK', 'remoteok', { id: String(j.id), company: j.company ?? '', title: j.position!, locations: [`Remote - ${j.location || 'Worldwide'}`], url: j.url!, applyUrl: j.apply_url, postedAt: j.date ?? null, html: j.description ?? '' }));
}

async function himalayas(): Promise<Job[]> {
  const out: Job[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 25; page++) {
    const d = (await getJson(`https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)) as { nextCursor?: string; jobs?: { guid: string; title: string; companyName: string; locationRestrictions?: string[]; applicationLink: string; pubDate: string; description: string; parentCategories?: string[] }[] } | null;
    for (const j of d?.jobs ?? []) {
      const where = j.locationRestrictions?.length ? j.locationRestrictions.join(', ') : 'Worldwide';
      out.push(feedJob('Himalayas', 'himalayas', { id: j.guid.split('/').pop()!, company: j.companyName, title: j.title, locations: [`Remote - ${where}`], url: j.guid, applyUrl: j.applicationLink, postedAt: new Date(Number(j.pubDate) * 1000).toISOString(), html: j.description, department: j.parentCategories?.[0] ?? null }));
    }
    cursor = d?.nextCursor;
    if (!cursor) break;
  }
  return out;
}

async function jobicy(): Promise<Job[]> {
  const out: Job[] = [];
  for (const geo of ['apac', 'anywhere']) {
    const d = (await getJson(`https://jobicy.com/api/v2/remote-jobs?count=100&geo=${geo}`)) as { jobs?: { id: number; url: string; jobTitle: string; companyName: string; jobGeo: string; pubDate: string; jobDescription: string; jobIndustry?: string[] }[] } | null;
    for (const j of d?.jobs ?? []) out.push(feedJob('Jobicy', 'jobicy', { id: String(j.id), company: j.companyName, title: j.jobTitle, locations: [`Remote - ${j.jobGeo || 'Anywhere'}`], url: j.url, postedAt: j.pubDate, html: j.jobDescription, department: j.jobIndustry?.[0] ?? null }));
  }
  return out;
}

export const FEEDS: { name: string; load: () => Promise<Job[]> }[] = [
  { name: 'Remotive', load: () => cachedFeed('remotive', remotive) },
  { name: 'Remote OK', load: () => cachedFeed('remoteok', remoteOk) },
  { name: 'Himalayas', load: () => cachedFeed('himalayas', himalayas) },
  { name: 'Jobicy', load: () => cachedFeed('jobicy', jobicy) },
];

// ---------- One posting from any site ----------

/**
 * Reads one posting the person pasted, from any site, the way their browser would: one page, once.
 * Most job pages carry schema.org JobPosting data for search engines; that is used when present.
 */
export async function jobFromAnyPage(url: string): Promise<Job | null> {
  let html: string;
  try {
    const r = await fetch(url, { headers: { ...UA, accept: 'text/html' }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
    if (!r.ok) return null;
    html = await r.text();
  } catch {
    return null;
  }
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]!.trim()); } catch { continue; }
    const items = (Array.isArray(data) ? data : [data]).flatMap((x: any) => (x?.['@graph'] ? x['@graph'] : [x]));
    const p = items.find((x: any) => x?.['@type'] === 'JobPosting' || (Array.isArray(x?.['@type']) && x['@type'].includes('JobPosting'))) as any;
    if (!p) continue;
    const places = (Array.isArray(p.jobLocation) ? p.jobLocation : p.jobLocation ? [p.jobLocation] : [])
      .map((l: any) => [l?.address?.addressLocality, l?.address?.addressRegion, l?.address?.addressCountry?.name ?? l?.address?.addressCountry].filter(Boolean).join(', '))
      .filter(Boolean);
    const host = new URL(url).hostname.replace(/^www\./, '');
    const remote = /TELECOMMUTE/i.test(String(p.jobLocationType ?? ''));
    return {
      id: id('link', host, String(p.identifier?.value ?? p.identifier ?? url).slice(0, 80)), board: 'link', company: p.hiringOrganization?.name ?? host,
      companySlug: host, postingId: String(p.identifier?.value ?? url), title: String(p.title ?? '').trim(),
      locations: places.length ? places : remote ? ['Remote'] : [], remote, department: null, url, applyUrl: p.url ?? url,
      postedAt: p.datePosted ?? null, description: htmlToText(String(p.description ?? '')), via: host,
    };
  }
  return null;
}
