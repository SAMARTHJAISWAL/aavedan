// One application, start to finish: open, read, plan, fill, read back, ask, send, record.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { Llm } from '../llm.ts';
import type { Profile } from '../profile/schema.ts';
import type { QueuedJob } from '../jobs/store.ts';
import { recordApplication } from '../jobs/store.ts';
import { formUrl, newTab } from './browser.ts';
import { scan, values, fillOne, clickSubmit, confirmed, humanCheckVisible } from './fill.ts';
import { readErrors, type Field } from './page.ts';
import { plan, type Memory, type Step } from './plan.ts';
import { shows } from './match.ts';
import { paths, limits } from '../config.ts';
import { readJson, writeJson } from '../util/store.ts';
import { tailor } from '../tailor/write.ts';
import { isBlocked, markBlocked, prepareHandoff, VERIFY_FAILED, type HandoffAnswer } from './handoff.ts';
import { truncate } from '../util/text.ts';

export interface Io {
  log(s: string): void;
  /** Asks the person a question the form needs; null when nobody is there to answer. */
  ask(question: string, options: string[], multi: boolean): Promise<string[] | null>;
  /** Shows the filled form and asks whether to send it. */
  decide(summary: string): Promise<'send' | 'recheck' | 'skip' | 'hold' | 'quit'>;
  /** Waits for the person to finish something in the browser window. */
  waitFor(message: string): Promise<void>;
  interactive: boolean;
}

export type Outcome = { status: 'sent' | 'held' | 'rehearsed' | 'skipped' | 'handed-off' | 'quit'; reason: string | null };

const loadMemory = () => readJson<Memory[]>(paths.answers, []);
function remember(question: string, answer: string) {
  const mem = loadMemory().filter(m => m.question !== question);
  mem.push({ question, answer, at: new Date().toISOString() });
  writeJson(paths.answers, mem);
}

function existingTailored(handle: string): { resume: string | null; cover: string | null } {
  if (!fs.existsSync(paths.tailored)) return { resume: null, cover: null };
  const dir = fs.readdirSync(paths.tailored).find(d => d.startsWith(`${handle}-`));
  if (!dir) return { resume: null, cover: null };
  const files = fs.readdirSync(path.join(paths.tailored, dir));
  const pick = (re: RegExp) => { const f = files.find(x => re.test(x)); return f ? path.join(paths.tailored, dir, f) : null; };
  return { resume: pick(/-resume\.pdf$/), cover: pick(/-cover-letter\.pdf$/) };
}

export function summarize(steps: Step[], shown: Record<string, string>): string {
  const rows = steps.map(s => {
    const now = shown[s.field.id] ?? '';
    const want = s.action === 'answer' ? s.value : [];
    const ok = s.action === 'answer' ? shows(s.field.kind, s.field.inputType, want, now) : !s.field.required || now.trim() !== '';
    const mark = ok ? (now.trim() ? '✓' : '·') : '✗';
    const value = s.field.kind === 'file' ? path.basename(want[0] ?? now) : now || (s.action === 'skip' ? '(left empty)' : '(empty)');
    return `  ${mark} ${truncate(s.field.label, 48).padEnd(48)} ${truncate(value.replace(/\s+/g, ' '), 60)}${s.field.required ? '' : ' (optional)'}\n      ${s.source}`;
  });
  return rows.join('\n');
}

/** Required fields that are empty, and answers the page does not show. */
export function problems(steps: Step[], shown: Record<string, string>): string[] {
  const out: string[] = [];
  for (const s of steps) {
    const now = shown[s.field.id] ?? '';
    if (s.action === 'answer' && !shows(s.field.kind, s.field.inputType, s.value, now)) out.push(`“${truncate(s.field.label, 60)}” shows “${truncate(now, 40)}”, not “${truncate(s.value.join(', '), 40)}”`);
    else if (s.field.required && !now.trim()) out.push(`“${truncate(s.field.label, 60)}” is required and empty`);
  }
  return out;
}

export async function applyOne(opts: { ctx: BrowserContext; llm: Llm; profile: Profile; q: QueuedJob; io: Io; send: boolean; tailorFirst: boolean; cover: boolean }): Promise<Outcome> {
  const { ctx, llm, profile, q, io } = opts;
  const job = q.job;
  io.log(`\n${job.company} · ${job.title}  (${q.handle}${q.fit ? `, fit ${q.fit.score}` : ''})\n${job.url}`);

  let page: Page | undefined;
  // A form that waits for the person stays open in its tab; everything else is closed.
  let keepOpen = false;
  const record = (status: 'sent' | 'held' | 'rehearsed' | 'handed-off', reason: string | null, steps: Step[], shown: Record<string, string>, resume: string | null, cover: string | null) =>
    recordApplication({
      jobId: job.id, handle: q.handle, company: job.company, title: job.title, url: job.url,
      location: job.locations.join('; '), status, reason, at: new Date().toISOString(),
      fitScore: q.fit?.score ?? null, resume, coverLetter: cover,
      answers: steps.filter(s => s.field.kind !== 'file').map(s => ({ label: s.field.label, value: shown[s.field.id] ?? '' })),
      note: q.fit?.oneLine ?? '',
    });

  const handOff = (reason: string, steps: Step[], shown: Record<string, string>, resume: string | null, cover: string | null): Outcome => {
    const answers: HandoffAnswer[] = steps.filter(s => s.field.kind !== 'file').map(s => ({
      label: s.field.label, required: s.field.required,
      value: shown[s.field.id] || (s.action === 'answer' ? s.value.join('; ') : ''),
    }));
    const h = prepareHandoff({ profile, job, handle: q.handle, formUrl: job.applyUrl, answers, resume, cover, reason });
    record('handed-off', 'waiting for you to submit it from your own browser', steps, shown, resume, cover);
    io.log(`\n  → Handed off to your browser. ${reason}\n    Answer sheet: ${h.page}\n    Files: ${h.files.join(', ') || 'none'}\n    When you have sent it: aavedan done ${q.handle}`);
    return { status: 'handed-off', reason };
  };

  try {
    page = await newTab(ctx, formUrl(job));
    let fields: Field[] = await scan(page);
    if (fields.filter(f => f.kind !== 'file').length < 2) {
      // Some boards show the form after an Apply button.
      const btn = page.getByRole('button', { name: /^apply( for this job| now)?$/i }).or(page.getByRole('link', { name: /^apply( for this job| now)?$/i })).first();
      if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(2000); fields = await scan(page); }
    }
    if (fields.filter(f => f.kind !== 'file').length < 2) {
      record('held', 'no application form found on the page (closed, or a board this tool cannot read)', [], {}, null, null);
      return { status: 'held', reason: 'no form found' };
    }
    io.log(`  read ${fields.length} questions (${fields.filter(f => f.required).length} required)`);

    // Files: a tailored resume when one exists or is asked for, else the base resume.
    let { resume, cover } = existingTailored(q.handle);
    const coverWanted = opts.cover || fields.some(f => f.kind === 'file' && /cover/i.test(f.label) && f.required);
    if (opts.tailorFirst && (!resume || (coverWanted && !cover))) {
      io.log('  tailoring the resume' + (coverWanted ? ' and a cover letter' : '') + '…');
      const t = await tailor({ llm, profile, job, handle: q.handle, cover: coverWanted });
      resume = t.resumePdf;
      cover = t.coverPdf;
      if (t.missingKeywords.length) io.log(`  the posting asks for things your profile does not show: ${t.missingKeywords.slice(0, 6).join(', ')}`);
    }
    resume ??= paths.resume;
    if (!fs.existsSync(resume)) throw new Error(`No resume at ${resume}. Put your resume at me/resume.pdf.`);

    const memory = loadMemory();
    let steps = await plan({ llm, profile, job, fields, memory, files: { resume, cover } });

    // An optional question nobody can answer from the profile is left empty, not asked.
    for (const s of steps) if (s.action === 'ask' && !s.field.required) { s.action = 'skip'; s.source = 'optional, left empty'; }
    // What only the person knows.
    for (const s of steps.filter(x => x.action === 'ask')) {
      const ans = await io.ask(s.field.label + (s.source ? `  (${s.source})` : ''), s.field.options, s.field.multi);
      if (ans && ans.length && ans.some(a => a.trim())) {
        s.action = 'answer';
        s.value = ans;
        s.source = 'your answer, saved for next time';
        if (s.field.kind !== 'file') remember(s.field.label, ans.join('; '));
      } else {
        s.action = 'skip';
        s.source = s.field.required ? 'needs your answer' : 'left empty';
        if (s.field.required && !io.interactive) io.log(`  ? needs you: “${s.field.label}”${s.field.options.length ? `  options: ${s.field.options.slice(0, 12).join(' / ')}` : ''}`);
      }
    }

    for (const s of steps.filter(x => x.action === 'answer')) {
      const answer = { id: s.field.id, value: [...s.value] };
      const err = await fillOne(page, s.field, answer);
      if (err) s.source = `could not fill: ${err}`;
      else if (s.field.kind !== 'file' && answer.value.join() !== s.value.join()) {
        // The board's own suggestion replaced what was typed, or a long list's "Other" was chosen.
        s.source += ` → picked “${answer.value.join(', ')}”`;
        s.value = answer.value;
      }
    }
    await page.waitForTimeout(500);

    for (;;) {
      const shown = await values(page);
      const issues = problems(steps, shown);
      io.log('\n' + summarize(steps, shown));
      if (!opts.send) {
        record('rehearsed', issues.length ? issues.join('; ') : null, steps, shown, resume, cover);
        io.log(issues.length ? `\n  Rehearsal: ${issues.length} thing(s) would hold this form:\n   - ${issues.join('\n   - ')}` : '\n  Rehearsal: every answer is on the page. Nothing was sent.');
        return { status: 'rehearsed', reason: issues[0] ?? null };
      }
      if (opts.send && isBlocked(job.board)) {
        // This board refused an automated submission before; prepare everything and let the person send it.
        return handOff(`${job.board[0]!.toUpperCase()}${job.board.slice(1)} rejected an automated submission before, so this one is yours to send.`, steps, shown, resume, cover);
      }
      if (issues.length && !io.interactive) {
        keepOpen = true;
        record('held', issues.join('; '), steps, shown, resume, cover);
        return { status: 'held', reason: issues[0]! };
      }
      const choice = await io.decide(issues.length
        ? `  Not ready: ${issues.join('; ')}.\n  Fix it in the Chrome window, then choose recheck; or skip.`
        : '  Every answer is on the page. You can still change anything in the window before you choose.');
      if (choice === 'quit') return { status: 'quit', reason: null };
      if (choice === 'hold') { keepOpen = true; record('held', 'ready to send; waiting for your yes', steps, shown, resume, cover); return { status: 'held', reason: 'waiting for your yes' }; }
      if (choice === 'skip') { record('held', 'skipped by you', steps, shown, resume, cover); return { status: 'skipped', reason: 'skipped by you' }; }
      if (choice === 'recheck' || issues.length) {
        // Answers the person changed by hand are theirs; take what the page shows.
        for (const s of steps) if (s.action !== 'answer') { const v = shown[s.field.id]; if (v) { s.action = 'answer'; s.value = [v]; s.source = 'entered by you in the window'; } }
        const again = await values(page);
        for (const s of steps) if (s.action === 'answer' && s.field.kind !== 'file' && again[s.field.id] && !shows(s.field.kind, s.field.inputType, s.value, again[s.field.id]!)) { s.value = [again[s.field.id]!]; s.source = 'changed by you in the window'; }
        continue;
      }
      // send
      const final = await values(page);
      if (problems(steps, final).length) continue;
      if (!(await clickSubmit(page))) { record('held', 'could not find the submit button', steps, final, resume, cover); return { status: 'held', reason: 'no submit button' }; }
      const outcome = await waitForConfirmation(page, io);
      if (outcome === 'confirmed') { record('sent', null, steps, final, resume, cover); io.log('  ✓ Sent. The board confirmed it.'); return { status: 'sent', reason: null }; }
      const errors = await page.evaluate(readErrors).catch(() => [] as string[]);
      if (errors.some(e => VERIFY_FAILED.test(e))) {
        // The board's bot check said no. Never retry or work around it: hand it to the person's own browser.
        markBlocked(job.board);
        return handOff(`${job.company}'s form rejected the automated submission (“${errors.find(e => VERIFY_FAILED.test(e))}”). Nothing was received.`, steps, final, resume, cover);
      }
      const reason = errors.length ? `the form answered: ${errors.join(' | ')}` : 'submitted, but no confirmation appeared — check the window before sending again';
      record('held', reason, steps, final, resume, cover);
      io.log(`  ✗ ${reason}`);
      keepOpen = true;
      return { status: 'held', reason };
    }
  } catch (e) {
    const reason = (e as Error).message.split('\n')[0]!;
    io.log(`  ✗ ${reason}`);
    record('held', reason, [], {}, null, null);
    return { status: 'held', reason };
  } finally {
    if (page && !page.isClosed() && !keepOpen) await page.close().catch(() => {});
  }
}

async function waitForConfirmation(page: Page, io: Io): Promise<'confirmed' | 'not'> {
  const deadline = Date.now() + limits.confirmTimeoutS * 1000;
  let waitedForHuman = false;
  while (Date.now() < deadline || waitedForHuman) {
    await page.waitForTimeout(1000);
    if (await confirmed(page)) return 'confirmed';
    // A rejected bot check shows at once; no point waiting out the timeout.
    if ((await page.evaluate(readErrors).catch(() => [] as string[])).some(e => VERIFY_FAILED.test(e))) return 'not';
    if (!waitedForHuman && (await humanCheckVisible(page))) {
      waitedForHuman = true;
      if (!io.interactive) return 'not';
      await io.waitFor('  The board is showing a human check. Complete it in the Chrome window, then press Enter.');
      for (let i = 0; i < 30; i++) {
        if (await confirmed(page)) return 'confirmed';
        await page.waitForTimeout(1000);
      }
      return 'not';
    }
  }
  return 'not';
}
