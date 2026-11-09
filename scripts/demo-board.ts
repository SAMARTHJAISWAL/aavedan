// Builds the live demo: the board page with a snapshot from a real run for a made-up candidate.
// node scripts/demo-board.ts            → site/index.html from demo/board-data.json
// node scripts/demo-board.ts --snapshot → refresh demo/board-data.json from the current me/ folder
import fs from 'node:fs';
import path from 'node:path';
import { boardData, boardHtml, type BoardData } from '../src/board/render.ts';
import { loadJobs, loadApplications } from '../src/jobs/store.ts';
import { loadProfile } from '../src/profile/init.ts';
import { ROOT } from '../src/config.ts';

const dataFile = path.join(ROOT, 'demo', 'board-data.json');
if (process.argv.includes('--snapshot')) {
  const d = boardData(loadJobs(), loadApplications(), loadProfile(), true);
  d.queue = d.queue.slice(0, 40);
  // The live demo is the author's own search; contact details and CTC are never part of board data.
  d.demoNote = { who: 'the author’s own search', banner: 'This is the author’s own job search: real postings, ranked against his resume. Every application here was rehearsed, and nothing was sent.' };
  fs.writeFileSync(dataFile, JSON.stringify(d, null, 1) + '\n');
  console.log(`wrote ${path.relative(ROOT, dataFile)}: ${d.queue.length} jobs, ${d.applications.length} applications`);
} else {
  const d = JSON.parse(fs.readFileSync(dataFile, 'utf8')) as BoardData;
  fs.mkdirSync(path.join(ROOT, 'site'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'site', 'index.html'), boardHtml(d));
  for (const f of ['og.png', 'demo.gif']) if (fs.existsSync(path.join(ROOT, 'docs', f))) fs.copyFileSync(path.join(ROOT, 'docs', f), path.join(ROOT, 'site', f));
  console.log('wrote site/index.html');
}
