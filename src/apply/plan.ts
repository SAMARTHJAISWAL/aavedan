// Decides what goes in every box. A cheap model maps fields to facts; a stronger one writes the few
// open answers; code then checks every choice before anything is typed.
import { z } from 'zod';
import type { Llm } from '../llm.ts';
import type { Field } from './page.ts';
import type { Job } from '../sources/types.ts';
import { profileText, type Profile } from '../profile/schema.ts';
import { placeOf } from '../jobs/filter.ts';
import { pickOption } from './match.ts';
import { unsupported } from '../tailor/check.ts';
import { truncate } from '../util/text.ts';

export interface Memory { question: string; answer: string; at: string }

export interface Step {
  field: Field;
  /** answer: fill `value`; ask: only the user knows; skip: leave empty. */
  action: 'answer' | 'ask' | 'skip';
  value: string[];
  /** Where the answer came from, shown to the user before sending. */
  source: string;
}

const Mapped = z.object({
  fields: z.array(z.object({
    id: z.string(),
    action: z.enum(['answer', 'write', 'ask', 'skip']),
    value: z.array(z.string()).describe('For text: one string. For choices: the exact option label(s) to pick. Empty for write/ask/skip.'),
    source: z.string().describe('The profile fact, standing answer or past answer used, in a few words'),
  })),
});

const MAP_SYSTEM = `You fill one job application form for one candidate. For each field you get its id, kind, label, whether it is required, and its options when it has them.

Choose one action per field:
- "answer": the value follows directly from the candidate facts, the standing answers or the past answers. For a choice field, value holds the exact option label(s) from its options. For a searchable field (searchable: true, options not listed), value holds the text to search for, such as the school, degree, employer or city name; the tool picks the matching suggestion. For a text field, value holds one string, formatted for the box (a URL for a URL box, digits for a number box).
- "write": an open question that needs a few sentences or more (motivation, a project, "anything else", a cover letter box). Do not draft it here.
- "ask": the form wants a fact the candidate has not given, or a decision only they can make (a consent, a referral, a relative at the company, a background check, a salary figure not in the facts, how they heard about the job when no standing answer says). Never guess these.
- "skip": optional and nothing in the facts answers it.

Rules:
- Use facts exactly. Never change work authorization, sponsorship, education, dates, grades or experience to suit the form.
- Voluntary self-identification questions (gender, race, veteran, disability) use the standing answer when one exists; otherwise choose the option that declines to answer, or "ask" if there is none.
- Reuse a past answer only when it answers the same question; the company name may differ.
- Name fields: split the full name; "first name" is the given name.
- Phone fields take the number with country code unless a separate country code control exists.
- Location or city fields take the candidate's city as "City, Country" unless the options say otherwise.`;

export function derivedFacts(profile: Profile, job: Job, now = new Date()): string {
  const [first, ...rest] = profile.name.trim().split(/\s+/);
  const current = profile.experience.find(x => !x.end) ?? profile.experience[0];
  const place = placeOf(job);
  const countries = new Set<string>([...(place.indiaAny ? ['India'] : []), ...place.countries, ...profile.workRights.map(w => w.country)]);
  const rights = [...countries].map(c => {
    const r = profile.workRights.find(w => w.country.toLowerCase() === c.toLowerCase());
    const ok = r && r.status !== 'needs-sponsorship';
    return `- ${c}: ${ok ? `may work without sponsorship (${r!.status})` : 'would need sponsorship / not authorized'}`;
  });
  return [
    `Today: ${now.toISOString().slice(0, 10)}`,
    `First name: ${first}; last name: ${rest.join(' ') || '(none)'}`,
    current ? `Current or most recent employer: ${current.company}; title: ${current.title}${current.end ? ` (until ${current.end})` : ' (current)'}` : 'Current employer: none (student or not employed)',
    `Applying to: ${job.company}, ${job.title} (${job.locations.join('; ') || 'location not stated'}${job.remote ? ', remote' : ''})`,
    'Work authorization for the countries this application involves:',
    ...rights,
  ].join('\n');
}

const fieldLine = (f: Field) =>
  JSON.stringify({ id: f.id, kind: f.kind, label: f.label, required: f.required, ...(f.options.length ? { options: f.options.slice(0, 120) } : {}), ...(f.searchable ? { searchable: true } : {}), ...(f.maxLength ? { maxLength: f.maxLength } : {}), ...(f.multi ? { multi: true } : {}) });

/** Questions about work rights must agree with the profile, whatever the model said. */
export function workRightConflict(label: string, value: string, profile: Profile, job: Job): boolean {
  const v = value.trim().toLowerCase();
  const yes = /^yes\b/.test(v), no = /^no\b/.test(v);
  if (!yes && !no) return false;
  const place = placeOf(job);
  const countries = [...(place.indiaAny || (!place.countries.length && profile.country === 'India') ? ['India'] : []), ...place.countries];
  if (!countries.length) return false;
  const free = countries.every(c => profile.workRights.some(w => w.country.toLowerCase() === c.toLowerCase() && w.status !== 'needs-sponsorship'));
  if (/sponsor|visa/i.test(label)) return free ? yes : no; // "Will you require sponsorship?"
  if (/authori[sz]ed|legally|eligible to work|right to work|permit to work/i.test(label)) return free ? no : yes;
  return false;
}

export async function plan(opts: { llm: Llm; profile: Profile; job: Job; fields: Field[]; memory: Memory[]; files: { resume: string; cover: string | null } }): Promise<Step[]> {
  const { llm, profile, job, fields, memory } = opts;
  const steps: Step[] = [];
  const forModel = fields.filter(f => f.kind !== 'file');

  const facts = `<candidate>\n${profileText(profile)}\n</candidate>\n\n<derived>\n${derivedFacts(profile, job)}\n</derived>\n\n<standing_answers>\n${Object.entries(profile.answers).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '(none)'}\n</standing_answers>\n\n<past_answers>\n${memory.map(m => `- Q: ${m.question}\n  A: ${m.answer}`).join('\n') || '(none)'}\n</past_answers>`;
  const mapped = forModel.length
    ? await llm.json({ label: 'map-form', model: 'fast', system: MAP_SYSTEM, content: `${facts}\n\n<fields>\n${forModel.map(fieldLine).join('\n')}\n</fields>`, schema: Mapped, maxTokens: 8000, effort: 'medium' })
    : { fields: [] };
  const byId = new Map(mapped.fields.map(m => [m.id, m]));

  const toWrite: Field[] = [];
  for (const f of fields) {
    if (f.kind === 'file') {
      const isCover = /cover/i.test(f.label);
      const isResume = /resume|cv\b|curriculum/i.test(f.label) || (!isCover && !fields.some(g => g !== f && g.kind === 'file' && /resume|cv/i.test(g.label)));
      if (isCover && opts.files.cover) steps.push({ field: f, action: 'answer', value: [opts.files.cover], source: 'cover letter written for this job' });
      else if (isResume) steps.push({ field: f, action: 'answer', value: [opts.files.resume], source: opts.files.resume.includes('tailored') ? 'resume tailored for this job' : 'your resume' });
      else steps.push({ field: f, action: f.required ? 'ask' : 'skip', value: [], source: f.required ? 'a file only you can provide' : 'optional file' });
      continue;
    }
    const m = byId.get(f.id);
    if (!m) { steps.push({ field: f, action: f.required ? 'ask' : 'skip', value: [], source: 'not mapped' }); continue; }
    if (m.action === 'write') { toWrite.push(f); continue; }
    let step: Step = { field: f, action: m.action === 'ask' ? 'ask' : m.action, value: m.value, source: m.source };
    if (step.action === 'skip' && f.required) step = { ...step, action: 'ask', source: 'required, and the profile has no answer' };
    if (step.action === 'answer') {
      if (!step.value.length || step.value.every(v => !v.trim())) step = { ...step, action: f.required ? 'ask' : 'skip', value: [] };
      else if (['select', 'radio', 'checkbox'].includes(f.kind) || (f.kind === 'combobox' && f.options.length)) {
        const picked = step.value.map(v => pickOption(f.options, v));
        step = picked.every(Boolean) ? { ...step, value: picked as string[] } : { ...step, action: 'ask', value: [], source: `“${step.value.join(', ')}” is not one of the options` };
      }
      if (step.action === 'answer' && workRightConflict(f.label, step.value[0] ?? '', profile, job)) {
        step = { ...step, action: 'ask', value: [], source: 'work authorization answer disagreed with your profile' };
      }
      if (step.action === 'answer' && f.maxLength && (step.value[0]?.length ?? 0) > f.maxLength) step = { ...step, value: [step.value[0]!.slice(0, f.maxLength)] };
    }
    steps.push(step);
  }

  if (toWrite.length) {
    const written = await writeAnswers(llm, profile, job, toWrite, memory);
    for (const f of toWrite) {
      const w = written.get(f.id);
      steps.push(w ? { field: f, action: 'answer', value: [w], source: 'written for this job from your profile' } : { field: f, action: f.required ? 'ask' : 'skip', value: [], source: 'could not write a checked answer' });
    }
  }
  const order = new Map(fields.map((f, i) => [f.id, i]));
  return steps.sort((a, b) => order.get(a.field.id)! - order.get(b.field.id)!);
}

const Written = z.object({ answers: z.array(z.object({ id: z.string(), text: z.string() })) });

const WRITE_SYSTEM = `You write a candidate's answers to the open questions on a job application, in the first person, in their voice: plain, specific and warm, without clichés ("passionate", "thrilled", "leverage", "synergy"), without flattery, and without em dashes.

Use only facts from the candidate profile and the posting. Never invent a number, a tool, a company, a project or an outcome. Answer the question asked, tie it to this company and role using what the posting says, and keep each answer under its maxLength when one is given, otherwise 60 to 150 words. A cover letter box gets three short paragraphs.`;

async function writeAnswers(llm: Llm, profile: Profile, job: Job, fields: Field[], memory: Memory[]): Promise<Map<string, string>> {
  const voice = profile.answers['voice'] ? `\nHow the candidate writes: ${profile.answers['voice']}` : '';
  const ask = (extra: string) => llm.json({
    label: 'write-answers',
    model: 'write',
    system: WRITE_SYSTEM + voice,
    content: `<candidate>\n${profileText(profile)}\n</candidate>\n\n<posting>\n${job.company} — ${job.title}\n${truncate(job.description, 9000)}\n</posting>\n\n<past_answers>\n${memory.slice(-15).map(m => `Q: ${m.question}\nA: ${m.answer}`).join('\n\n') || '(none)'}\n</past_answers>\n\n<questions>\n${fields.map(f => JSON.stringify({ id: f.id, question: f.label, maxLength: f.maxLength })).join('\n')}\n</questions>${extra}`,
    schema: Written,
    maxTokens: 8000,
  });
  const sources = [profileText(profile), job.company, job.title, job.description, ...memory.map(m => m.answer)];
  const out = new Map<string, string>();
  let res = await ask('');
  for (let round = 0; round < 2; round++) {
    const bad: string[] = [];
    for (const a of res.answers) {
      const problems = unsupported(a.text, sources);
      if (problems.length) bad.push(`${a.id}: ${problems.join(', ')}`);
      else out.set(a.id, a.text.trim());
    }
    if (!bad.length || round === 1) break;
    res = await ask(`\n\nA previous draft used details that are in neither the profile nor the posting: ${bad.join('; ')}. Rewrite those answers without them.`);
  }
  return out;
}
