import { describe, expect, it, vi, afterEach } from 'vitest';
import { listSmartRecruiters, jobFromAnyPage } from '../src/sources/more.ts';
import { parseLink } from '../src/sources/boards.ts';
import { placeOf, judge } from '../src/jobs/filter.ts';
import { ananya } from './fixtures/profile.ts';

afterEach(() => vi.restoreAllMocks());

const respond = (body: unknown, type = 'application/json') =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': type } }));

describe('more sources', () => {
  it('reads SmartRecruiters postings with their Indian location', async () => {
    respond({ totalFound: 1, content: [{ id: '600', name: ' Data Analyst ', releasedDate: '2026-11-01T00:00:00Z', location: { city: 'Bengaluru', country: 'in', fullLocation: 'Bengaluru, KA, India' }, function: { label: 'Analytics' } }] });
    const [j] = await listSmartRecruiters({ name: 'Swiggy', board: 'smartrecruiters', slug: 'Swiggy' });
    expect(j).toMatchObject({ id: 'smartrecruiters:Swiggy:600', title: 'Data Analyst', locations: ['Bengaluru, KA, India'], url: 'https://jobs.smartrecruiters.com/Swiggy/600', description: '' });
    expect(placeOf(j!).indiaCities).toEqual(['Bengaluru']);
  });

  it('recognises SmartRecruiters and Workable links', () => {
    expect(parseLink('https://jobs.smartrecruiters.com/SWIGGY/6000000001561277-city-head')).toEqual({ board: 'smartrecruiters', slug: 'SWIGGY', postingId: '6000000001561277' });
    expect(parseLink('https://apply.workable.com/apna/j/CFBDFBDDC5/')).toEqual({ board: 'workable', slug: 'apna', postingId: 'CFBDFBDDC5' });
  });

  it('reads a posting from any page through its schema.org JobPosting data, and credits the site', async () => {
    respond(`<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Business Analyst","description":"<p>2-4 years of SQL</p>","datePosted":"2026-11-02","identifier":{"value":"123"},"hiringOrganization":{"name":"Acme"},"jobLocation":{"address":{"addressLocality":"Pune","addressCountry":"India"}}}</script></head></html>`, 'text/html');
    const j = await jobFromAnyPage('https://www.example-jobs.in/job/123');
    expect(j).toMatchObject({ company: 'Acme', title: 'Business Analyst', locations: ['Pune, India'], description: '2-4 years of SQL', via: 'example-jobs.in', board: 'link' });
  });

  it('returns null for a page with no job data', async () => {
    respond('<html><body>Sign in to continue</body></html>', 'text/html');
    expect(await jobFromAnyPage('https://www.example.com/x')).toBeNull();
  });

  it('places remote-feed postings by their stated region', () => {
    const j = (where: string) => ({ locations: [`Remote - ${where}`], remote: true });
    expect(placeOf(j('Worldwide')).remote).toBe('global');
    expect(placeOf(j('India')).remote).toBe('india');
    expect(placeOf(j('USA Only')).remote).toBe('restricted');
    expect(judge({ id: 'x', board: 'remotive', company: 'A', companySlug: 'remotive', postingId: '1', title: 'Backend Engineer', locations: ['Remote - USA Only'], remote: true, department: null, url: 'u', applyUrl: 'u', postedAt: null, description: '' }, ananya).pass).toBe(false);
  });
});
