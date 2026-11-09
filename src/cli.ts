// aavedan · आवेदन — the command line. Every Claude Code skill runs one of these commands.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { paths, models } from './config.ts';
import { claude } from './llm.ts';
import { draftFromResume, loadProfile, saveProfile, missing } from './profile/init.ts';
import type { Profile } from './profile/schema.ts';
import { find } from './jobs/find.ts';
import { loadJobs, saveJobs, findJob, ranked, loadApplications, type QueuedJob } from './jobs/store.ts';
import { allCompanies, addCompany } from './sources/companies.ts';
import { jobFromLink, parseLink, listJobs } from './sources/boards.ts';
import { judge } from './jobs/filter.ts';
import { rankJob } from './jobs/rank.ts';
import { tailor } from './tailor/write.ts';
import { openBrowser } from './apply/browser.ts';
import { applyOne, type Io } from './apply/run.ts';
import { writeBoard } from './board/render.ts';
import { readJson, writeJson } from './util/store.ts';
import { truncate } from './util/text.ts';

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'help';
const flags = new Set(argv.filter(a => a.startsWith('--')).map(a => a.split('=')[0]!));
const flag = (name: string, fallback?: string) => argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined) ?? fallback;
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && /^--(count|rank|limit|at)$/.test(all[i - 1]!)));
const interactive = !!process.stdin.isTTY && !flags.has('--no-input');

const say = (s = '') => process.stdout.write(s + '\n');

async function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(q)).trim(); } finally { rl.close(); }
}

const HELP = `aavedan · आवेदन — find jobs, tailor your resume, fill applications you approve

  aavedan init <resume.pdf>        read your resume into me/profile.json, then a short interview
  aavedan doctor                   check that everything is in place
  aavedan find [--rank 60]         read the job boards, filter, and rate new jobs against your profile
  aavedan list [--all] [--limit 25]  the ranked queue
  aavedan show <a12>               one job: fit, gaps, link
  aavedan tailor <a12> [--cover]   a one-page resume (and cover letter) for that job, as PDFs
  aavedan apply <a12 ...|link>     rehearse: fill the form in Chrome, read every answer back, send nothing
  aavedan apply ... --send         the same, then send each form you approve
           [--no-input --yes]      for scripts and Claude Code: send what is complete, hold the rest
  aavedan apply --count 5 --send   the five best jobs in the queue
           [--tailor] [--cover]    tailor the resume (and write a cover letter) for each first
  aavedan skip <a12 ...>           drop jobs from the queue
  aavedan status                   where you stand, and what Claude has cost
  aavedan board [--open]           your applications and queue as a page: me/board.html
  aavedan add-company <board link> read another company's Greenhouse, Lever or Ashby board too
  aavedan answers                  the answers you gave forms, which are reused
  aavedan answer "<q>" "<a>"       save an answer to a question a form asked

Models: ${models.fast} decides, ${models.write} writes (AAVEDAN_FAST_MODEL / AAVEDAN_WRITE_MODEL).`;

function needKey() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error('Set ANTHROPIC_API_KEY first (in your shell, or in a .env file in this folder).');
}

function loadDotEnv() {
  const f = path.join(paths.me, '..', '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
}

function row(q: QueuedJob): string {
  const score = q.fit ? String(q.fit.score).padStart(3) : '  –';
  return `${q.handle.padEnd(6)}${score}  ${truncate(q.job.company, 16).padEnd(16)} ${truncate(q.job.title, 46).padEnd(46)} ${truncate(q.job.locations.join('; ') || (q.job.remote ? 'Remote' : ''), 30)}`;
}

const terminalIo = (): Io => ({
  interactive,
  log: say,
  async ask(question, options, multi) {
    if (!interactive) return null;
    say(`\n  The form asks: ${question}`);
    if (options.length) {
      options.slice(0, 40).forEach((o, i) => say(`    ${String(i + 1).padStart(2)}. ${o}`));
      const a = await prompt(`  ${multi ? 'Numbers, comma separated' : 'Number'} (Enter to leave it): `);
      if (!a) return null;
      const picks = a.split(/[,\s]+/).map(Number).filter(n => n >= 1 && n <= options.length).map(n => options[n - 1]!);
      return picks.length ? picks : [a];
    }
    const a = await prompt('  Your answer (Enter to leave it): ');
    return a ? [a] : null;
  },
  async decide(summary) {
    say('\n' + summary);
    // Without a person at the keyboard, only --yes (given after the person approved these jobs) sends.
    if (!interactive) return flags.has('--yes') ? 'send' : 'hold';
    const a = (await prompt('  [s]end · [r]echeck the page · s[k]ip · [q]uit: ')).toLowerCase();
    return a === 's' || a === 'send' ? 'send' : a === 'r' ? 'recheck' : a === 'q' ? 'quit' : a === 'k' ? 'skip' : 'recheck';
  },
  async waitFor(message) {
    await prompt(message + ' ');
  },
});

async function interview(p: Profile): Promise<Profile> {
  say('\nA few things a resume does not say. Press Enter to keep what is in brackets.\n');
  const ask = async (q: string, cur: string) => (await prompt(`${q} [${cur}]: `)) || cur;
  const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
  p.phone = await ask('Phone, with country code', p.phone);
  p.city = await ask('City you live in', p.city);
  p.country = await ask('Country', p.country || 'India');
  const rights = await ask('Countries where you may work WITHOUT sponsorship (comma separated)', p.workRights.filter(w => w.status !== 'needs-sponsorship').map(w => w.country).join(', ') || p.country);
  p.workRights = list(rights).map(country => ({ country, status: country.toLowerCase() === p.country.toLowerCase() ? 'citizen' as const : 'work-permit' as const }));
  p.preferences.roles = list(await ask('Roles you want (comma separated)', p.preferences.roles.join(', ') || 'software engineer, backend engineer, full-stack engineer'));
  const levels = list(await ask('Levels: intern, new-grad, junior, mid, senior', p.preferences.levels.join(', ') || 'new-grad, junior'));
  p.preferences.levels = levels.filter((l): l is Profile['preferences']['levels'][number] => ['intern', 'new-grad', 'junior', 'mid', 'senior'].includes(l));
  p.preferences.indiaCities = list(await ask('Indian cities for office roles ("anywhere" for all, empty for none)', p.preferences.indiaCities.join(', ') || 'Bengaluru, Hyderabad, Pune, Delhi NCR'));
  p.preferences.remoteIndia = /^y/i.test(await ask('Remote roles open to India? (y/n)', p.preferences.remoteIndia ? 'y' : 'n'));
  p.preferences.remoteGlobal = /^y/i.test(await ask('Remote roles open worldwide? (y/n)', p.preferences.remoteGlobal ? 'y' : 'n'));
  p.preferences.countries = list(await ask('Other countries you would move to (comma separated, may be empty)', p.preferences.countries.join(', ')));
  p.yearsOfExperience = Number(await ask('Years of full-time experience', String(p.yearsOfExperience))) || 0;
  p.noticePeriodDays = Number(await ask('Notice period in days (0 if you can join now)', String(p.noticePeriodDays ?? 0)));
  const cur = await ask('Current CTC in LPA (0 if a student)', String(p.currentCtcLpa ?? 0));
  p.currentCtcLpa = Number(cur);
  const exp = await ask('Expected CTC in LPA (empty to be asked per form)', p.expectedCtcLpa == null ? '' : String(p.expectedCtcLpa));
  p.expectedCtcLpa = exp ? Number(exp) : null;
  p.answers['gender'] = await ask('Gender, for voluntary questions ("decline" to not say)', p.answers['gender'] ?? 'decline');
  p.answers['how-did-you-hear'] = await ask('How you heard about jobs, for forms that ask', p.answers['how-did-you-hear'] ?? 'Company careers page');
  p.answers['willing-to-relocate'] = await ask('Willing to relocate? (yes/no)', p.answers['willing-to-relocate'] ?? 'yes');
  p.preferences.minFit = Number(await ask('Lowest fit score worth applying to (0-100)', String(p.preferences.minFit))) || 70;
  return p;
}

async function main() {
  loadDotEnv();
  switch (cmd) {
    case 'init': {
      const file = positional[0];
      if (!file || !fs.existsSync(file)) throw new Error('Usage: aavedan init path/to/resume.pdf');
      needKey();
      fs.mkdirSync(paths.me, { recursive: true });
      if (path.resolve(file) !== paths.resume) fs.copyFileSync(file, paths.resume);
      if (fs.existsSync(paths.profile) && !flags.has('--force')) throw new Error('me/profile.json exists. Edit it, or pass --force to read the resume again.');
      say('Reading your resume…');
      let p = await draftFromResume(claude, fs.readFileSync(paths.resume));
      if (interactive && !flags.has('--no-interview')) p = await interview(p);
      saveProfile(p);
      say(`\nSaved me/profile.json (${p.experience.length} roles, ${p.projects.length} projects, ${p.skills.length} skills). Check it once: it is the only source of facts.`);
      const m = missing(p);
      if (m.length) say('Still missing:\n  - ' + m.join('\n  - '));
      say('Next: aavedan find');
      break;
    }
    case 'doctor': {
      const checks: [string, boolean, string][] = [
        ['Node 22.18+', Number(process.versions.node.split('.')[0]) > 22 || (process.versions.node.startsWith('22.') && Number(process.versions.node.split('.')[1]) >= 18), process.versions.node],
        ['ANTHROPIC_API_KEY', !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), 'set it in your shell or .env'],
        ['Google Chrome', fs.existsSync('/Applications/Google Chrome.app') || fs.existsSync('/usr/bin/google-chrome') || fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'), 'install Chrome, or run npx playwright install chromium'],
        ['me/resume.pdf', fs.existsSync(paths.resume), 'aavedan init your-resume.pdf'],
        ['me/profile.json', fs.existsSync(paths.profile), 'aavedan init your-resume.pdf'],
      ];
      for (const [name, ok, hint] of checks) say(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  → ${hint}`}`);
      if (fs.existsSync(paths.profile)) {
        try { const m = missing(loadProfile()); say(m.length ? `! profile is missing:\n  - ${m.join('\n  - ')}` : '✓ profile complete'); } catch (e) { say(`✗ ${(e as Error).message}`); }
      }
      break;
    }
    case 'find': {
      needKey();
      const profile = loadProfile();
      const r = await find({ llm: claude, profile, companies: allCompanies(), rankLimit: Number(flag('rank', '60')), log: say });
      say(`\n${r.seen} postings · ${r.fresh} new · ${r.passedRules} pass your rules · ${r.ranked} rated now · ${r.good} worth applying (fit ≥ ${profile.preferences.minFit})`);
      const top = Object.entries(r.dropped).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ');
      if (top) say(`Dropped by rules: ${top}`);
      if (r.failedCompanies.length) say(`Could not read: ${r.failedCompanies.join(', ')}`);
      say('\nBest now:');
      for (const q of ranked(loadJobs()).filter(q => q.fit!.score >= profile.preferences.minFit).slice(0, 10)) say(row(q));
      say('\nNext: aavedan show <id>, or aavedan apply <id> to rehearse one.');
      break;
    }
    case 'list': {
      const f = loadJobs();
      const all = flags.has('--all');
      const minFit = all ? 0 : (fs.existsSync(paths.profile) ? loadProfile().preferences.minFit : 0);
      const rows = ranked(f, { includeDone: all }).filter(q => q.fit!.score >= minFit).slice(0, Number(flag('limit', '25')));
      if (!rows.length) say('The queue is empty. Run aavedan find.');
      for (const q of rows) say(row(q) + (q.status !== 'new' ? `  [${q.status}]` : ''));
      break;
    }
    case 'show': {
      const q = findJob(loadJobs(), positional[0] ?? '');
      if (!q) throw new Error('No such job. Use an id from aavedan list.');
      say(`${q.job.company} · ${q.job.title}\n${q.job.locations.join('; ')}${q.job.remote ? ' (remote)' : ''}\n${q.job.url}\nstatus: ${q.status}${q.filtered ? ` · filtered: ${q.filtered}` : ''}`);
      if (q.fit) {
        say(`\nfit ${q.fit.score}/100${q.fit.eligible ? '' : ` · NOT ELIGIBLE: ${q.fit.eligibilityNote}`}\n${q.fit.oneLine}`);
        if (q.fit.matches.length) say('  + ' + q.fit.matches.join('\n  + '));
        if (q.fit.gaps.length) say('  - ' + q.fit.gaps.join('\n  - '));
      }
      if (flags.has('--full')) say('\n' + q.job.description);
      break;
    }
    case 'tailor': {
      needKey();
      const profile = loadProfile();
      const q = findJob(loadJobs(), positional[0] ?? '');
      if (!q) throw new Error('No such job. Use an id from aavedan list.');
      say(`Writing a resume${flags.has('--cover') ? ' and a cover letter' : ''} for ${q.job.company} · ${q.job.title}…`);
      const t = await tailor({ llm: claude, profile, job: q.job, handle: q.handle, cover: flags.has('--cover') });
      say(`  ${path.relative(process.cwd(), t.resumePdf)}${t.coverPdf ? `\n  ${path.relative(process.cwd(), t.coverPdf)}` : ''}`);
      if (t.missingKeywords.length) say(`The posting wants, and your profile does not show: ${t.missingKeywords.join(', ')}`);
      if (t.flagged.length) say(`Dropped as unsupported by your profile: ${t.flagged.join(', ')}`);
      break;
    }
    case 'apply': {
      needKey();
      const profile = loadProfile();
      const file = loadJobs();
      let targets: QueuedJob[] = [];
      for (const ref of positional) {
        if (parseLink(ref)) {
          const link = parseLink(ref)!;
          const job = await jobFromLink(ref, allCompanies().find(c => c.board === link.board && c.slug === link.slug)?.name);
          if (!job) throw new Error(`Could not read a posting at ${ref}`);
          let q = file.jobs[job.id];
          if (!q) {
            const v = judge(job, profile);
            q = file.jobs[job.id] = { job, fit: null, filtered: v.pass ? null : v.reason, status: 'new', firstSeen: new Date().toISOString(), handle: `a${file.nextHandle++}` };
          }
          q.fit ??= await rankJob(claude, job, profile);
          if (q.filtered) say(`Note: your rules would drop this one (${q.filtered}). Applying because you asked.`);
          targets.push(q);
        } else {
          const q = findJob(file, ref);
          if (!q) throw new Error(`No job ${ref}. Use an id from aavedan list, or a posting link.`);
          targets.push(q);
        }
      }
      saveJobs(file);
      if (!targets.length) targets = ranked(file).filter(q => q.fit!.score >= profile.preferences.minFit).slice(0, Number(flag('count', '3')));
      if (!targets.length) throw new Error('Nothing to apply to. Run aavedan find, or pass a job id or link.');
      const send = flags.has('--send');
      say(send ? `Applying to ${targets.length}. Each form waits for your yes before it is sent.` : `Rehearsing ${targets.length}: every form is filled and checked, nothing is sent. Add --send to send.`);
      const ctx = await openBrowser({ headless: flags.has('--headless') });
      const tally: Record<string, number> = {};
      try {
        for (const q of targets) {
          const out = await applyOne({ ctx, llm: claude, profile, q, io: terminalIo(), send, tailorFirst: flags.has('--tailor'), cover: flags.has('--cover') });
          tally[out.status] = (tally[out.status] ?? 0) + 1;
          const f2 = loadJobs();
          const live = f2.jobs[q.job.id];
          if (live && out.status === 'sent') live.status = 'applied';
          else if (live && (out.status === 'held' || out.status === 'skipped')) live.status = 'held';
          saveJobs(f2);
          if (out.status === 'quit') break;
        }
      } finally {
        if (!interactive || !send || !Object.keys(tally).includes('held')) await ctx.close().catch(() => {});
        else say('\nHeld forms are still open in Chrome. Close the window when you are done.');
      }
      say(`\n${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(' · ')}. Records: me/applications.csv`);
      break;
    }
    case 'skip': {
      const f = loadJobs();
      for (const ref of positional) { const q = findJob(f, ref); if (q) { q.status = 'skipped'; say(`skipped ${q.handle} ${q.job.company} · ${q.job.title}`); } }
      saveJobs(f);
      break;
    }
    case 'status': {
      const f = loadJobs();
      const apps = loadApplications();
      const usage = fs.existsSync(paths.usage) ? fs.readFileSync(paths.usage, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as { usd: number; at: string; label: string }) : [];
      const today = new Date().toISOString().slice(0, 10);
      const sent = apps.filter(a => a.status === 'sent');
      const held = apps.filter(a => a.status === 'held');
      const minFit = fs.existsSync(paths.profile) ? loadProfile().preferences.minFit : 70;
      say(`Sent: ${sent.length} (${sent.filter(a => a.at.startsWith(today)).length} today)`);
      say(`Waiting for you: ${held.length}${held.length ? '\n' + held.slice(0, 8).map(a => `  ${a.handle} ${a.company} · ${truncate(a.title, 40)} — ${truncate(a.reason ?? '', 80)}`).join('\n') : ''}`);
      say(`Queue: ${ranked(f).filter(q => q.fit!.score >= minFit).length} worth applying, of ${Object.keys(f.jobs).length} tracked · last find ${f.lastFind ? f.lastFind.slice(0, 16).replace('T', ' ') : 'never'}`);
      const total = usage.reduce((s, u) => s + u.usd, 0);
      const byLabel = Object.entries(usage.reduce<Record<string, number>>((m, u) => ((m[u.label] = (m[u.label] ?? 0) + u.usd), m), {})).sort((a, b) => b[1] - a[1]);
      say(`Claude so far: $${total.toFixed(3)}${byLabel.length ? ` (${byLabel.map(([k, v]) => `${k} $${v.toFixed(3)}`).join(', ')})` : ''}`);
      break;
    }
    case 'board': {
      const out = writeBoard(loadJobs(), loadApplications(), fs.existsSync(paths.profile) ? loadProfile() : null, paths.board);
      say(`Wrote ${path.relative(process.cwd(), out)}`);
      if (flags.has('--open')) execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [out]);
      break;
    }
    case 'add-company': {
      const link = positional[0];
      const p = link ? parseLink(link) : null;
      if (!p) throw new Error('Give a Greenhouse, Lever or Ashby board link, e.g. https://jobs.lever.co/acme');
      const name = positional[1] ?? p.slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const jobs = await listJobs({ name, board: p.board, slug: p.slug });
      if (!jobs.length) throw new Error(`${p.board} has no open jobs for “${p.slug}”. Check the link.`);
      addCompany({ name, board: p.board, slug: p.slug });
      say(`Added ${name} (${p.board}/${p.slug}): ${jobs.length} open jobs. The next find includes it.`);
      break;
    }
    case 'answer': {
      // aavedan answer "<question as the form asks it>" "<answer>": saved and reused by every later form.
      const [question, answer] = positional;
      if (!question || answer == null) throw new Error('Usage: aavedan answer "<question>" "<answer>"');
      const mem = readJson<{ question: string; answer: string; at: string }[]>(paths.answers, []).filter(m => m.question !== question);
      mem.push({ question, answer, at: new Date().toISOString() });
      writeJson(paths.answers, mem);
      say(`Saved. Forms that ask “${truncate(question, 60)}” will get “${truncate(answer, 60)}”.`);
      break;
    }
    case 'answers': {
      const mem = readJson<{ question: string; answer: string }[]>(paths.answers, []);
      if (!mem.length) say('No saved answers yet.');
      for (const m of mem) say(`- ${m.question}\n    ${m.answer}`);
      break;
    }
    case 'companies': {
      for (const c of allCompanies()) say(`${c.name.padEnd(18)} ${c.board.padEnd(11)} ${c.slug}`);
      break;
    }
    default:
      say(HELP);
  }
}

main().catch(e => {
  process.stderr.write(`aavedan: ${(e as Error).message}\n`);
  process.exit(1);
});
