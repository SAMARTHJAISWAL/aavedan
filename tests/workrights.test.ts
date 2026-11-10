import { describe, expect, it } from 'vitest';
import { workRightConflict } from '../src/apply/plan.ts';
import { ananya } from './fixtures/profile.ts';
import type { Job } from '../src/sources/types.ts';

const job = (locations: string[]): Job => ({
  id: 'greenhouse:acme:1', board: 'greenhouse', company: 'Acme', companySlug: 'acme', postingId: '1', title: 'Engineer',
  locations, remote: false, department: null, url: '', applyUrl: '', postedAt: null, description: '',
});

describe('work-rights answers must match the profile', () => {
  const both = job(['Bangalore, India', 'Remote, Poland']);
  it('blocks "no sponsorship" when the job also names a country the person cannot work in', () => {
    expect(workRightConflict('Will you require visa sponsorship to work in this role?', 'No', ananya, both)).toBe(true);
  });
  it('answers questions about the current location from where the person lives', () => {
    const q = 'Will you now or in the future require sponsorship for a visa to remain in your current location?';
    expect(workRightConflict(q, 'No', ananya, both)).toBe(false);
    expect(workRightConflict(q, 'Yes', ananya, both)).toBe(true);
  });
});
