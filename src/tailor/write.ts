// A one-page resume and a cover letter written for one job, from the profile alone.
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { Llm } from '../llm.ts';
import type { Job } from '../sources/types.ts';
import { profileText, type Profile } from '../profile/schema.ts';
import { unsupported } from './check.ts';
import { resumeHtml, letterHtml, htmlToPdf } from './render.ts';
import { paths } from '../config.ts';
import { slugify, truncate } from '../util/text.ts';

export const ResumeDraft = z.object({
  headline: z.string(),
  summary: z.string().describe('Two sentences at most'),
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })).describe('At most 4 groups'),
  experience: z.array(z.object({ index: z.number().int().describe('Index into the profile experience list'), bullets: z.array(z.string()).describe('At most 4') })),
  projects: z.array(z.object({ index: z.number().int().describe('Index into the profile project list'), bullets: z.array(z.string()).describe('At most 3') })).describe('At most 3 projects'),
  keywordsNotSupported: z.array(z.string()).describe('Skills or tools the posting asks for that the profile does not show'),
});
export type ResumeDraft = z.infer<typeof ResumeDraft>;

export const LetterDraft = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()).describe('Three paragraphs'),
  closing: z.string(),
});
export type LetterDraft = z.infer<typeof LetterDraft>;

const RESUME_SYSTEM = `You tailor a candidate's resume to one job posting. You choose and rephrase; you never add.

- Pick the experience entries and projects (by index) that matter most for this posting, most relevant first, and rewrite their bullets to lead with what this posting cares about.
- Every bullet must restate something the profile says. Keep every number exactly as the profile gives it; never add a number, a tool, a team size or an outcome.
- Group the skills the profile lists that this posting values; leave out the rest. Do not add skills the profile does not list.
- List the posting's important keywords that the profile does not support in keywordsNotSupported, never in the resume.
- Plain, concrete language. No "passionate", "results-driven", "spearheaded", "leveraged".
- It must fit on one page: at most 3 experience entries and 3 projects, at most 4 bullets each, each bullet under 30 words.`;

const LETTER_SYSTEM = `You write a short cover letter for one candidate and one job: three paragraphs, under 250 words in all, first person, plain and specific, no clichés, no flattery, no em dashes. Use only facts from the profile and the posting. Never invent numbers, tools, people or outcomes. The greeting is "Dear COMPANY team," unless the posting names a person. The closing is "Regards," followed by nothing else.`;

function sourcesOf(profile: Profile, job: Job) {
  return [profileText(profile), job.company, job.title, job.description];
}

async function checked<T>(make: (feedback: string) => Promise<T>, text: (t: T) => string, sources: string[]): Promise<{ draft: T; flagged: string[] }> {
  let draft = await make('');
  let bad = unsupported(text(draft), sources);
  if (bad.length) {
    draft = await make(`\n\nYour previous draft used details found in neither the profile nor the posting: ${bad.join(', ')}. Remove them.`);
    bad = unsupported(text(draft), sources);
  }
  return { draft, flagged: bad };
}

export function resumeText(d: ResumeDraft): string {
  return [d.headline, d.summary, d.skills.map(s => `Skills: ${s.items.join(', ')}`).join('\n'), ...d.experience.flatMap(e => e.bullets), ...d.projects.flatMap(p => p.bullets)].join('\n');
}

export interface Tailored { dir: string; resumePdf: string; coverPdf: string | null; missingKeywords: string[]; flagged: string[] }

export async function tailor(opts: { llm: Llm; profile: Profile; job: Job; handle: string; cover: boolean }): Promise<Tailored> {
  const { llm, profile, job } = opts;
  const posting = `<posting>\n${job.company} — ${job.title}\n${job.locations.join('; ')}\n\n${truncate(job.description, 12000)}\n</posting>`;
  const indexed = `<profile>\n${profileText(profile)}\n\nEXPERIENCE BY INDEX\n${profile.experience.map((x, i) => `${i}: ${x.title}, ${x.company}`).join('\n')}\n\nPROJECTS BY INDEX\n${profile.projects.map((p, i) => `${i}: ${p.name}`).join('\n')}\n</profile>`;
  const sources = sourcesOf(profile, job);

  const resume = await checked(
    fb => llm.json({ label: 'tailor-resume', model: 'write', system: RESUME_SYSTEM, content: `${indexed}\n\n${posting}${fb}`, schema: ResumeDraft, maxTokens: 8000 }),
    resumeText, sources,
  );
  // A flagged bullet is dropped rather than shipped; sizes are enforced here, not by the schema.
  const r = resume.draft;
  const draft = dropFlagged({
    ...r,
    skills: r.skills.slice(0, 4),
    experience: r.experience.filter(e => profile.experience[e.index]).slice(0, 3).map(e => ({ ...e, bullets: e.bullets.slice(0, 4) })),
    projects: r.projects.filter(p => profile.projects[p.index]).slice(0, 3).map(p => ({ ...p, bullets: p.bullets.slice(0, 3) })),
  }, sources);

  const dir = path.join(paths.tailored, `${opts.handle}-${slugify(job.company)}-${slugify(job.title)}`.slice(0, 90));
  fs.mkdirSync(dir, { recursive: true });
  const resumePdf = path.join(dir, `${slugify(profile.name)}-resume.pdf`);
  fs.writeFileSync(resumePdf, await htmlToPdf(resumeHtml(profile, draft)));
  fs.writeFileSync(path.join(dir, 'resume.json'), JSON.stringify(draft, null, 2));

  let coverPdf: string | null = null;
  let letterFlags: string[] = [];
  if (opts.cover) {
    const letter = await checked(
      fb => llm.json({ label: 'cover-letter', model: 'write', system: LETTER_SYSTEM.replace('COMPANY', job.company), content: `${indexed}\n\n${posting}${fb}`, schema: LetterDraft, maxTokens: 4000 }),
      l => l.paragraphs.join('\n'), sources,
    );
    letterFlags = letter.flagged;
    if (!letter.flagged.length) {
      coverPdf = path.join(dir, `${slugify(profile.name)}-cover-letter.pdf`);
      fs.writeFileSync(coverPdf, await htmlToPdf(letterHtml(profile, job, letter.draft)));
      fs.writeFileSync(path.join(dir, 'cover-letter.txt'), [letter.draft.greeting, '', ...letter.draft.paragraphs.flatMap(p => [p, '']), letter.draft.closing, profile.name].join('\n'));
    }
  }
  return { dir, resumePdf, coverPdf, missingKeywords: draft.keywordsNotSupported, flagged: [...resume.flagged, ...letterFlags] };
}

export function dropFlagged(d: ResumeDraft, sources: string[]): ResumeDraft {
  const ok = (s: string) => unsupported(s, sources).length === 0;
  // A skill is one or two words, so it must appear in the sources as a whole.
  const flat = sources.join('\n').toLowerCase();
  const skillOk = (s: string) => flat.includes(s.toLowerCase());
  return {
    ...d,
    headline: ok(d.headline) ? d.headline : '',
    summary: ok(d.summary) ? d.summary : '',
    skills: d.skills.map(s => ({ ...s, items: s.items.filter(skillOk) })).filter(s => s.items.length),
    experience: d.experience.map(e => ({ ...e, bullets: e.bullets.filter(ok) })),
    projects: d.projects.map(p => ({ ...p, bullets: p.bullets.filter(ok) })),
  };
}
