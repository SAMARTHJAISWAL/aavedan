import { describe, expect, it } from 'vitest';
import { fromGreenhouse, fromLever, fromAshby, parseLink } from '../src/sources/boards.ts';
import { htmlToText } from '../src/util/text.ts';
import { formUrl } from '../src/apply/browser.ts';

const co = { name: 'Acme', board: 'greenhouse' as const, slug: 'acme' };

describe('board readers', () => {
  it('reads a Greenhouse posting, double-encoded HTML and all', () => {
    const j = fromGreenhouse(co, {
      id: 42, title: ' Backend Engineer ', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/42',
      location: { name: 'Bengaluru, India' }, offices: [{ location: 'Remote - India' }], departments: [{ name: 'Engineering' }],
      first_published: '2026-10-01T00:00:00Z',
      content: '&lt;p&gt;Build &lt;strong&gt;payments&lt;/strong&gt;.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;li&gt;Kafka&lt;/li&gt;&lt;/ul&gt;',
    });
    expect(j.id).toBe('greenhouse:acme:42');
    expect(j.title).toBe('Backend Engineer');
    expect(j.locations).toEqual(['Bengaluru, India', 'Remote - India']);
    expect(j.remote).toBe(true);
    expect(j.description).toBe('Build payments.\n\n• Go\n• Kafka');
  });

  it('reads a Lever posting whose text lives in lists, and marks India from the country code', () => {
    const j = fromLever({ ...co, board: 'lever' }, {
      id: 'abc', text: 'SDE 1', hostedUrl: 'https://jobs.lever.co/acme/abc', applyUrl: 'https://jobs.lever.co/acme/abc/apply',
      categories: { location: 'hyderabad', allLocations: ['hyderabad'] }, country: 'IN', workplaceType: 'onsite',
      lists: [{ text: 'What you will do', content: '<li>Ship things</li>' }], createdAt: 1790573982021,
    });
    expect(j.locations).toEqual(['hyderabad', 'India']);
    expect(j.description).toContain('What you will do');
    expect(j.description).toContain('• Ship things');
    expect(j.postedAt).toMatch(/^2026-/);
  });

  it('reads an Ashby posting with secondary locations', () => {
    const j = fromAshby({ ...co, board: 'ashby' }, {
      id: 'u1', title: 'ML Engineer', jobUrl: 'https://jobs.ashbyhq.com/acme/u1', applyUrl: 'https://jobs.ashbyhq.com/acme/u1/application',
      location: 'Bengaluru', secondaryLocations: [{ location: 'Remote' }], isRemote: true, descriptionPlain: 'Train models.',
      address: { postalAddress: { addressCountry: 'India' } },
    });
    expect(j.locations).toEqual(['Bengaluru', 'Remote', 'India']);
    expect(j.remote).toBe(true);
  });
});

describe('parseLink', () => {
  it.each([
    ['https://job-boards.greenhouse.io/stripe/jobs/8234252', { board: 'greenhouse', slug: 'stripe', postingId: '8234252' }],
    ['https://job-boards.eu.greenhouse.io/groww/jobs/4970739101?gh_src=x', { board: 'greenhouse', slug: 'groww', postingId: '4970739101' }],
    ['https://boards.greenhouse.io/embed/job_app?for=okta&token=77', { board: 'greenhouse', slug: 'okta', postingId: '77' }],
    ['https://jobs.lever.co/cred/aa98a938/apply', { board: 'lever', slug: 'cred', postingId: 'aa98a938' }],
    ['https://jobs.lever.co/meesho', { board: 'lever', slug: 'meesho', postingId: null }],
    ['https://jobs.ashbyhq.com/sarvam/c0406fe0/application', { board: 'ashby', slug: 'sarvam', postingId: 'c0406fe0' }],
  ])('%s', (url, want) => expect(parseLink(url)).toEqual(want));
  it('rejects other sites', () => {
    expect(parseLink('https://www.naukri.com/job/123')).toBeNull();
    expect(parseLink('not a url')).toBeNull();
  });
});

it('opens Greenhouse forms through the embed page, which works for every company', () => {
  expect(formUrl({ board: 'greenhouse', companySlug: 'stripe', postingId: '8', applyUrl: 'https://stripe.com/jobs?gh_jid=8' }))
    .toBe('https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8');
  expect(formUrl({ board: 'lever', companySlug: 'cred', postingId: 'a', applyUrl: 'https://jobs.lever.co/cred/a/apply' })).toBe('https://jobs.lever.co/cred/a/apply');
});

it('turns HTML into readable text', () => {
  expect(htmlToText('<div>A&nbsp;&amp;&nbsp;B</div><br><p>C&#39;s</p><script>x()</script>')).toBe('A & B\n\nC\'s');
});
