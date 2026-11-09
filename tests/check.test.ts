import { describe, expect, it } from 'vitest';
import { unsupported, claims } from '../src/tailor/check.ts';
import { dropFlagged, type ResumeDraft } from '../src/tailor/write.ts';
import { pickOption, shows } from '../src/apply/match.ts';
import { profileText } from '../src/profile/schema.ts';
import { ananya } from './fixtures/profile.ts';

const sources = [profileText(ananya), 'Acme Payments', 'We use Go, gRPC and PostgreSQL to move money.'];

describe('fact check', () => {
  it('passes text built from the profile and the posting', () => {
    expect(unsupported('At Paysetu I built the refunds service in Go, handling 40,000 refunds a day, and cut p95 latency from 900 ms to 210 ms.', sources)).toEqual([]);
    expect(unsupported('I would like to bring my Kafka work to Acme Payments, where you use gRPC.', sources)).toEqual([]);
  });
  it('flags invented numbers, tools and employers', () => {
    expect(unsupported('I cut latency by 70% at Paysetu.', sources)).toEqual(['70%']);
    expect(unsupported('I led a team of 6 using Rust at Google.', sources).sort()).toEqual(['6', 'Google', 'Rust']);
  });
  it('does not mistake sentence-initial words for names', () => {
    expect(claims('Building payments is fun. Testing too.').names).toEqual([]);
  });
  it('drops flagged bullets rather than shipping them', () => {
    const d: ResumeDraft = {
      headline: 'Backend engineer', summary: 'Go and Python services.',
      skills: [{ group: 'Languages', items: ['Go', 'Rust'] }],
      experience: [{ index: 0, bullets: ['Built the refunds service in Go', 'Grew revenue 3x'] }],
      projects: [], keywordsNotSupported: ['Rust'],
    };
    const out = dropFlagged(d, sources);
    expect(out.skills[0]!.items).toEqual(['Go']);
    expect(out.experience[0]!.bullets).toEqual(['Built the refunds service in Go']);
  });
});

describe('options and read-back', () => {
  it('picks the option a person would', () => {
    expect(pickOption(['Yes', 'No'], 'no')).toBe('No');
    expect(pickOption(['Yes, I am authorized to work in India', 'No, I will need sponsorship'], 'Yes')).toBe('Yes, I am authorized to work in India');
    expect(pickOption(['India', 'Indonesia'], 'India')).toBe('India');
    expect(pickOption(['Bengaluru, Karnataka, India', 'Bengaluru Rural, Karnataka, India'], 'Bengaluru')).toBeNull();
    expect(pickOption(['Male', 'Female', 'Decline to self-identify'], 'Female')).toBe('Female');
    expect(pickOption(['A', 'B'], 'C')).toBeNull();
  });
  it('accepts a phone number the board reformatted', () => {
    expect(shows('text', 'tel', ['+91 98450 12345'], '098450 12345')).toBe(true);
    expect(shows('text', 'tel', ['+91 98450 12345'], '+919845012345')).toBe(true);
    expect(shows('text', 'tel', ['+91 98450 12345'], '')).toBe(false);
  });
  it('wants text exactly and choices by name', () => {
    expect(shows('text', 'text', ['Ananya'], 'Ananya ')).toBe(true);
    expect(shows('text', 'text', ['Ananya'], 'Anan')).toBe(false);
    expect(shows('combobox', 'combobox', ['India'], 'India')).toBe(true);
    expect(shows('checkbox', 'checkbox', ['India', 'Singapore'], 'India; Singapore')).toBe(true);
  });
});
