// Prints the made-up test candidate's resume to a PDF, for trying `aavedan init` without a real resume.
// node scripts/fixture-resume.ts out/ananya-resume.pdf
import fs from 'node:fs';
import path from 'node:path';
import { ananya } from '../tests/fixtures/profile.ts';
import { resumeHtml, htmlToPdf } from '../src/tailor/render.ts';

const out = process.argv[2] ?? 'out/ananya-resume.pdf';
const html = resumeHtml(ananya, {
  headline: ananya.headline,
  summary: ananya.summary,
  skills: [{ group: 'Skills', items: ananya.skills }],
  experience: ananya.experience.map((x, index) => ({ index, bullets: x.bullets })),
  projects: ananya.projects.map((x, index) => ({ index, bullets: x.bullets })),
  keywordsNotSupported: [],
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await htmlToPdf(html));
console.log(`wrote ${out}`);
