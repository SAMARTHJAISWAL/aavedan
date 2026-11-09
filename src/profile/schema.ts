// The profile is the only source of facts. Forms, resumes and letters may rephrase it, never add to it.
import { z } from 'zod';

const Dated = {
  start: z.string().describe('YYYY-MM, or YYYY'),
  end: z.string().nullable().describe('YYYY-MM, YYYY, or null when ongoing'),
};

export const Education = z.object({
  school: z.string(),
  degree: z.string().describe('e.g. "B.Tech", "B.E.", "M.S."'),
  field: z.string(),
  ...Dated,
  grade: z.string().nullable().describe('As written, e.g. "8.7/10 CGPA" or "3.6/4.0"'),
});

export const Experience = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  ...Dated,
  bullets: z.array(z.string()),
});

export const Project = z.object({
  name: z.string(),
  url: z.string().nullable(),
  summary: z.string(),
  bullets: z.array(z.string()),
  tech: z.array(z.string()),
});

export const WorkRight = z.object({
  country: z.string().describe('Country name, e.g. "India", "United States"'),
  status: z.enum(['citizen', 'permanent-resident', 'work-permit', 'needs-sponsorship']),
});

export const Level = z.enum(['intern', 'new-grad', 'junior', 'mid', 'senior']);

export const Preferences = z.object({
  roles: z.array(z.string()).describe('Kinds of role, e.g. "backend engineer", "full-stack", "ML engineer"'),
  levels: z.array(Level),
  /** Indian cities the user would work in on site or hybrid. Empty means none. */
  indiaCities: z.array(z.string()),
  remoteIndia: z.boolean().describe('Remote roles open to people in India'),
  remoteGlobal: z.boolean().describe('Remote roles open worldwide'),
  /** Other countries the user would move to; only useful with a work right or sponsorship. */
  countries: z.array(z.string()),
  excludeCompanies: z.array(z.string()),
  minFit: z.number().min(0).max(100),
});

export const Profile = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string().describe('With country code, e.g. "+91 98765 43210"'),
  city: z.string(),
  country: z.string(),
  links: z.object({
    linkedin: z.string().nullable(),
    github: z.string().nullable(),
    portfolio: z.string().nullable(),
  }),
  headline: z.string().describe('One line, e.g. "Full-stack engineer, final-year B.Tech CSE"'),
  summary: z.string(),
  workRights: z.array(WorkRight),
  /** Indian forms ask these; leave null to have the tool hold rather than guess. */
  noticePeriodDays: z.number().nullable(),
  currentCtcLpa: z.number().nullable().describe('Current fixed CTC in lakh rupees a year; 0 for students'),
  expectedCtcLpa: z.number().nullable(),
  graduationYear: z.number().nullable(),
  yearsOfExperience: z.number(),
  education: z.array(Education),
  experience: z.array(Experience),
  projects: z.array(Project),
  skills: z.array(z.string()),
  achievements: z.array(z.string()),
  preferences: Preferences,
  /**
   * Standing answers to questions that recur across forms, in the user's own words:
   * "gender", "pronouns", "veteran", "disability", "ethnicity", "how-did-you-hear",
   * "willing-to-relocate", "earliest-start" and any others they add.
   */
  answers: z.record(z.string(), z.string()),
});

export type Profile = z.infer<typeof Profile>;
export type Preferences = z.infer<typeof Preferences>;
export type Level = z.infer<typeof Level>;

/** The facts as one plain text block, for prompts and for the fact check. */
export function profileText(p: Profile): string {
  const lines: string[] = [
    `${p.name} — ${p.headline}`,
    `${p.city}, ${p.country} · ${p.email} · ${p.phone}`,
    ...Object.entries(p.links).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    `Summary: ${p.summary}`,
    `Years of experience: ${p.yearsOfExperience}`,
    `Work rights: ${p.workRights.map(w => `${w.country} (${w.status})`).join('; ') || 'not stated'}`,
  ];
  if (p.noticePeriodDays != null) lines.push(`Notice period: ${p.noticePeriodDays} days`);
  if (p.currentCtcLpa != null) lines.push(`Current CTC: ${p.currentCtcLpa} LPA`);
  if (p.expectedCtcLpa != null) lines.push(`Expected CTC: ${p.expectedCtcLpa} LPA`);
  if (p.graduationYear != null) lines.push(`Graduation year: ${p.graduationYear}`);
  lines.push('', 'EDUCATION');
  for (const e of p.education) lines.push(`- ${e.degree} ${e.field}, ${e.school} (${e.start}–${e.end ?? 'present'})${e.grade ? `, ${e.grade}` : ''}`);
  lines.push('', 'EXPERIENCE');
  for (const x of p.experience) {
    lines.push(`- ${x.title}, ${x.company}${x.location ? `, ${x.location}` : ''} (${x.start}–${x.end ?? 'present'})`);
    for (const b of x.bullets) lines.push(`  • ${b}`);
  }
  lines.push('', 'PROJECTS');
  for (const pr of p.projects) {
    lines.push(`- ${pr.name}${pr.url ? ` (${pr.url})` : ''}: ${pr.summary} [${pr.tech.join(', ')}]`);
    for (const b of pr.bullets) lines.push(`  • ${b}`);
  }
  lines.push('', `SKILLS: ${p.skills.join(', ')}`);
  if (p.achievements.length) lines.push('', 'ACHIEVEMENTS', ...p.achievements.map(a => `- ${a}`));
  return lines.join('\n');
}
