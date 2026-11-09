import { describe, expect, it } from 'vitest';
import { placeOf, levelOf, yearsAsked, judge, placeOk } from '../src/jobs/filter.ts';
import type { Job } from '../src/sources/types.ts';
import { ananya } from './fixtures/profile.ts';

const job = (over: Partial<Job>): Job => ({
  id: 'x', board: 'lever', company: 'Acme', companySlug: 'acme', postingId: '1', title: 'Software Engineer',
  locations: ['Bengaluru, India'], remote: false, department: null, url: 'https://x', applyUrl: 'https://x/apply',
  postedAt: new Date().toISOString(), description: '', ...over,
});

describe('placeOf', () => {
  it('recognises Indian cities under any spelling', () => {
    expect(placeOf(job({ locations: ['Bangalore'] })).indiaCities).toEqual(['Bengaluru']);
    expect(placeOf(job({ locations: ['Gurgaon, Haryana'] })).indiaCities).toEqual(['Gurugram']);
    expect(placeOf(job({ locations: ['Delhi NCR'] })).indiaCities.sort()).toEqual(['Delhi', 'Gurugram', 'Noida']);
  });
  it('tells India-remote from worldwide and from country-restricted remote', () => {
    expect(placeOf(job({ locations: ['Remote - India'], remote: true })).remote).toBe('india');
    expect(placeOf(job({ locations: ['Remote'], remote: true })).remote).toBe('global');
    expect(placeOf(job({ locations: ['Anywhere in the world'] })).remote).toBe('global');
    const us = placeOf(job({ locations: ['Remote - US'], remote: true }));
    expect(us.remote).toBe('restricted');
    expect(us.countries).toEqual(['United States']);
  });
  it('does not read "us" in other words as the United States', () => {
    expect(placeOf(job({ locations: ['Austria'] })).countries).toEqual([]);
    expect(placeOf(job({ locations: ['San Francisco, CA'] })).countries).toEqual(['United States']);
  });
});

describe('levelOf', () => {
  it.each([
    ['Software Engineer Intern', 'intern'],
    ['Senior Backend Engineer', 'senior'],
    ['Staff Engineer, Payments', 'senior'],
    ['SDE II', 'mid'],
    ['SDE-1', 'junior'],
    ['Software Engineer, New Grad 2026', 'new-grad'],
    ['Graduate Engineer Trainee', 'intern'],
    ['Associate Software Engineer', 'junior'],
    ['Engineering Manager', 'senior'],
    ['Backend Engineer', null],
  ])('%s → %s', (title, level) => expect(levelOf(title)).toBe(level));
});

describe('yearsAsked', () => {
  it.each([
    ['You have 3+ years of experience building APIs.', 3],
    ['Minimum of 5 years of professional experience', 5],
    ['2-4 years of experience in backend development', 2],
    ['At least two years of hands-on experience', 2],
    ['4 to 6 yrs exp in Java', 4],
    ['We were founded 10 years ago and serve 3 million users', null],
    ['Requirements: 7+ years of industry experience; 3+ years leading teams', 7],
    ['• 5–7 years in business analytics, growth analytics', 5],
    ['Experience: 5+ Years', 5],
    ['You have 3-6 years of full-time experience in product analytics', 3],
    ['3+ years as a data analyst', 3],
  ])('%s', (text, years) => expect(yearsAsked(text)).toBe(years));
});

describe('judge', () => {
  it('keeps a junior backend role in Bengaluru', () => {
    expect(judge(job({ title: 'Backend Engineer', description: '1+ years of experience with Go' }), ananya).pass).toBe(true);
  });
  it('drops senior titles, long experience, wrong places and non-tech roles, with a reason', () => {
    expect(judge(job({ title: 'Senior Software Engineer' }), ananya).reason).toBe('level: senior');
    expect(judge(job({ description: '5+ years of experience' }), ananya).reason).toBe('asks for 5+ years');
    expect(judge(job({ locations: ['Chennai'] }), ananya).reason).toMatch(/^location/);
    expect(judge(job({ title: 'Accounts Payable Manager' }), ananya).reason).toBe('not a role you are looking for');
    expect(judge(job({ postedAt: '2020-01-01T00:00:00Z' }), ananya).reason).toMatch(/^posted/);
  });
  it('accepts a posting that names India but no city, for someone open to remote work in India', () => {
    expect(judge(job({ locations: ['India'] }), ananya).pass).toBe(true);
    const officeOnly = { ...ananya, preferences: { ...ananya.preferences, remoteIndia: false } };
    expect(judge(job({ locations: ['India'] }), officeOnly).pass).toBe(false);
  });
  it('accepts NCR offices for a Delhi NCR preference', () => {
    expect(judge(job({ locations: ['Noida, Uttar Pradesh'] }), ananya).pass).toBe(true);
  });
  it('needs a work right or a chosen country for an office abroad', () => {
    expect(judge(job({ locations: ['London, UK'] }), ananya).pass).toBe(false);
    const movable = { ...ananya, preferences: { ...ananya.preferences, countries: ['United Kingdom'] } };
    expect(judge(job({ locations: ['London, UK'] }), movable).pass).toBe(true);
  });
  it('respects the remote switches', () => {
    const noRemote = { ...ananya, preferences: { ...ananya.preferences, remoteGlobal: false, remoteIndia: false, indiaCities: [] } };
    expect(placeOk(placeOf(job({ locations: ['Remote'], remote: true })), noRemote)).toBe(false);
    expect(placeOk(placeOf(job({ locations: ['Remote'], remote: true })), ananya)).toBe(true);
  });
});

describe('remote that is not really open to everyone', () => {
  it('treats a remote flag on a city-only posting as that city', () => {
    expect(placeOf(job({ locations: ['Vienna, Austria'], remote: true })).remote).toBe('restricted');
    expect(judge(job({ locations: ['Vienna, Austria'], remote: true }), ananya).pass).toBe(false);
  });
  it('treats regional remote as restricted', () => {
    expect(placeOf(job({ locations: ['EMEA'], remote: true })).remote).toBe('restricted');
    expect(placeOf(job({ locations: ['Remote', 'US | EU'], remote: true })).remote).toBe('restricted');
    expect(placeOf(job({ locations: ['Remote, Global'], remote: true })).remote).toBe('global');
    expect(placeOf(job({ locations: ['Remote - APAC'], remote: true })).remote).toBe('india');
    expect(placeOf(job({ locations: ['Remote - Philippines'], remote: true })).remote).toBe('restricted');
    expect(placeOf(job({ locations: ['Remote - Worldwide'], remote: true })).remote).toBe('global');
  });
  it('does not count analyst roles as engineering unless you asked for them', () => {
    expect(judge(job({ title: 'Fraud Analyst' }), ananya).pass).toBe(false);
    const analyst = { ...ananya, preferences: { ...ananya.preferences, roles: ['data analyst'] } };
    expect(judge(job({ title: 'Data Analyst' }), analyst).pass).toBe(true);
  });
});
