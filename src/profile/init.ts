// Turns a resume PDF into a draft profile. The draft is only what the resume says; the user fills
// in work rights, preferences and standing answers in the interview, never the model.
import fs from 'node:fs';
import { z } from 'zod';
import { paths } from '../config.ts';
import type { Llm } from '../llm.ts';
import { readJson, writeJson } from '../util/store.ts';
import { Education, Experience, Profile, Project } from './schema.ts';

const ResumeFacts = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  city: z.string(),
  country: z.string(),
  links: z.object({ linkedin: z.string().nullable(), github: z.string().nullable(), portfolio: z.string().nullable() }),
  headline: z.string(),
  summary: z.string(),
  graduationYear: z.number().nullable(),
  yearsOfExperience: z.number().describe('Full-time years after graduation; internships count as 0'),
  education: z.array(Education),
  experience: z.array(Experience),
  projects: z.array(Project),
  skills: z.array(z.string()),
  achievements: z.array(z.string()),
});

const SYSTEM = `You copy facts from a resume into JSON. Copy, do not improve: keep every number, name and claim exactly as written, keep bullets as written, and use "" or null for anything the resume does not state. Do not infer a city or country from a university or employer. The headline is one line built only from the resume (current role or degree and year). The summary is two sentences restating the resume, adding nothing.`;

export async function draftFromResume(llm: Llm, pdf: Buffer): Promise<Profile> {
  const facts = await llm.json({
    label: 'read-resume',
    model: 'write',
    system: SYSTEM,
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
      { type: 'text', text: 'Copy this resume into the schema.' },
    ],
    schema: ResumeFacts,
    maxTokens: 16000,
  });
  return {
    ...facts,
    workRights: [],
    noticePeriodDays: null,
    currentCtcLpa: null,
    expectedCtcLpa: null,
    preferences: { roles: [], levels: [], indiaCities: [], remoteIndia: true, remoteGlobal: true, countries: [], excludeCompanies: [], minFit: 70 },
    answers: {},
  };
}

export function loadProfile(): Profile {
  if (!fs.existsSync(paths.profile)) throw new Error('No profile yet. Run `aavedan init path/to/resume.pdf` first.');
  const parsed = Profile.safeParse(readJson(paths.profile, null));
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`me/profile.json does not match the schema:\n${issues}`);
  }
  return parsed.data;
}

export function saveProfile(p: Profile): void {
  writeJson(paths.profile, Profile.parse(p));
}

/** What the profile still lacks before applying is safe. Each entry is a question for the user. */
export function missing(p: Profile): string[] {
  const out: string[] = [];
  if (!p.workRights.length) out.push('Where may you work without sponsorship (workRights)?');
  if (!p.preferences.roles.length) out.push('Which roles are you looking for (preferences.roles)?');
  if (!p.preferences.levels.length) out.push('Which levels: intern, new-grad, junior, mid, senior (preferences.levels)?');
  if (!p.preferences.indiaCities.length && !p.preferences.remoteIndia && !p.preferences.remoteGlobal && !p.preferences.countries.length) out.push('Where do you want to work (preferences)?');
  if (p.noticePeriodDays == null) out.push('Notice period in days (noticePeriodDays); 0 if you can join now.');
  if (p.expectedCtcLpa == null) out.push('Expected CTC in LPA (expectedCtcLpa), for Indian forms.');
  if (!p.phone) out.push('Phone number with country code.');
  return out;
}
