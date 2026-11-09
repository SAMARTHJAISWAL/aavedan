// HTML templates for the resume and the letter, printed to PDF by the same Chrome that fills forms.
import { chromium } from 'playwright-core';
import type { Profile } from '../profile/schema.ts';
import type { Job } from '../sources/types.ts';
import type { LetterDraft, ResumeDraft } from './write.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2025-07" → "Jul 2025"; anything else as written. */
export const prettyDate = (d: string) => {
  const m = d.match(/^(\d{4})-(\d{1,2})$/);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d;
};
const range = (a: string, b: string | null) => `${esc(prettyDate(a))} – ${b ? esc(prettyDate(b)) : 'Present'}`;
const linkText = (u: string) => esc(u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));

const STYLE = `
@page { size: A4; margin: 14mm 15mm; }
* { box-sizing: border-box; }
body { font: 10pt/1.38 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1b1d21; margin: 0; }
h1 { font-size: 20pt; margin: 0; letter-spacing: -0.01em; }
.contact { color: #4a4f57; margin: 2pt 0 0; font-size: 9pt; }
.contact a { color: inherit; text-decoration: none; }
.nw { white-space: nowrap; }
.headline { margin: 5pt 0 0; font-weight: 600; color: #8a3b12; }
h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: .12em; color: #8a3b12; border-bottom: .6pt solid #d8c7b8; padding-bottom: 2pt; margin: 11pt 0 4pt; }
.row { display: flex; justify-content: space-between; gap: 8pt; }
.row b { font-weight: 650; }
.row > span:last-child { white-space: nowrap; flex: none; }
.muted { color: #5b6069; }
ul { margin: 2pt 0 5pt; padding-left: 12pt; }
li { margin: 1pt 0; }
p { margin: 0 0 4pt; }
.skills div { margin: 1pt 0; }
`;

export function resumeHtml(p: Profile, d: ResumeDraft): string {
  const contact = [p.city && `${esc(p.city)}, ${esc(p.country)}`, esc(p.email), esc(p.phone), ...Object.values(p.links).filter((x): x is string => !!x).map(u => `<a href="${esc(u)}">${linkText(u)}</a>`)].filter(Boolean).map(x => `<span class="nw">${x}</span>`).join(' · ');
  const exp = d.experience.map(e => ({ x: p.experience[e.index], bullets: e.bullets })).filter(e => e.x);
  const proj = d.projects.map(e => ({ x: p.projects[e.index], bullets: e.bullets })).filter(e => e.x);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
<h1>${esc(p.name)}</h1>
<div class="contact">${contact}</div>
${d.headline ? `<div class="headline">${esc(d.headline)}</div>` : ''}
${d.summary ? `<p style="margin-top:4pt">${esc(d.summary)}</p>` : ''}
${exp.length ? `<h2>Experience</h2>${exp.map(({ x, bullets }) => `
<div class="row"><span><b>${esc(x!.title)}</b>, ${esc(x!.company)}${x!.location ? ` <span class="muted">· ${esc(x!.location)}</span>` : ''}</span><span class="muted">${range(x!.start, x!.end)}</span></div>
<ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`).join('')}` : ''}
${proj.length ? `<h2>Projects</h2>${proj.map(({ x, bullets }) => `
<div class="row"><span><b>${esc(x!.name)}</b>${x!.tech.length ? ` <span class="muted">· ${esc(x!.tech.slice(0, 5).join(', '))}</span>` : ''}</span>${x!.url ? `<span class="muted">${linkText(x!.url)}</span>` : ''}</div>
<ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`).join('')}` : ''}
${p.education.length ? `<h2>Education</h2>${p.education.map(e => `
<div class="row"><span><b>${esc(e.degree)}${e.field ? `, ${esc(e.field)}` : ''}</b>, ${esc(e.school)}${e.grade ? ` <span class="muted">· ${esc(e.grade)}</span>` : ''}</span><span class="muted">${range(e.start, e.end)}</span></div>`).join('')}` : ''}
${d.skills.length ? `<h2>Skills</h2><div class="skills">${d.skills.map(s => `<div><b>${esc(s.group)}:</b> ${esc(s.items.join(', '))}</div>`).join('')}</div>` : ''}
</body></html>`;
}

export function letterHtml(p: Profile, job: Job, l: LetterDraft): string {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE} body{font-size:10.5pt;line-height:1.55} p{margin:0 0 9pt}</style></head><body>
<h1>${esc(p.name)}</h1>
<div class="contact">${esc(p.email)} · ${esc(p.phone)} · ${esc(p.city)}, ${esc(p.country)}</div>
<p style="margin-top:18pt" class="muted">${esc(today)}<br>${esc(job.company)} · ${esc(job.title)}</p>
<p>${esc(l.greeting)}</p>
${l.paragraphs.map(x => `<p>${esc(x)}</p>`).join('\n')}
<p>${esc(l.closing)}<br>${esc(p.name)}</p>
</body></html>`;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
