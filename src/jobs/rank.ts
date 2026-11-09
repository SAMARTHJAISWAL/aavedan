// One cheap Claude call per job: how well does it fit, and is the user even eligible?
import { z } from 'zod';
import type { Job } from '../sources/types.ts';
import { profileText, type Profile } from '../profile/schema.ts';
import type { Llm } from '../llm.ts';
import { cached, hash } from '../util/store.ts';
import { paths } from '../config.ts';
import path from 'node:path';
import { truncate } from '../util/text.ts';

export const Fit = z.object({
  score: z.number().int().describe('0-100: how strong a candidate the profile is for this job'),
  eligible: z.boolean().describe('False when the posting rules the person out: work authorization, location, a required degree or clearance they lack'),
  eligibilityNote: z.string().describe('Why not eligible, or "" when eligible'),
  matches: z.array(z.string()).describe('Up to 4 requirements the profile clearly meets, each under 12 words, citing the profile'),
  gaps: z.array(z.string()).describe('Up to 4 requirements the profile does not show, each under 12 words'),
  oneLine: z.string().describe('What the company does, in under 15 words'),
});
export type Fit = z.infer<typeof Fit>;

const SYSTEM = `You screen job postings for one candidate. Judge only from the candidate profile and the posting; never assume skills or experience the profile does not state.

Scoring: 85-100 the candidate meets nearly every stated requirement at the right level; 70-84 meets the core requirements with minor gaps; 50-69 plausible but notable gaps; below 50 a poor fit. Seniority mismatches and missing must-have skills weigh most. Nice-to-haves weigh little.

Eligibility: mark eligible false when the posting requires something the profile rules out: citizenship; a work permit, or residence, in a country or region where the profile has no work right (an on-site, hybrid or region-limited remote role abroad counts, unless the posting offers relocation or visa sponsorship); a security clearance; or a degree the candidate does not have. Remote roles open worldwide or to India are eligible.`;

export async function rankJob(llm: Llm, job: Job, profile: Profile): Promise<Fit> {
  const profileBlock = profileText(profile);
  const key = hash('fit-v2', profileBlock, job.title, job.locations, job.description);
  const store = cached<Fit>(path.join(paths.cache, 'fit'), key);
  const hit = store.get();
  if (hit) return hit;
  const fit = await llm.json({
    label: 'rank',
    model: 'fast',
    system: SYSTEM,
    content: `<candidate>\n${profileBlock}\n</candidate>\n\n<posting>\nCompany: ${job.company}\nTitle: ${job.title}\nLocations: ${job.locations.join('; ') || 'not stated'}${job.remote ? ' (remote)' : ''}\n\n${truncate(job.description, 12000)}\n</posting>`,
    schema: Fit,
    maxTokens: 1500,
  });
  // Structured outputs do not enforce sizes or ranges, so they are applied here.
  const clean: Fit = { ...fit, score: Math.max(0, Math.min(100, Math.round(fit.score))), matches: fit.matches.slice(0, 4), gaps: fit.gaps.slice(0, 4) };
  store.set(clean);
  return clean;
}
