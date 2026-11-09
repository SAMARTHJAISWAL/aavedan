// Hand-off: when a board will not take an application from an automated browser, the person sends it
// from their own browser. aavedan prepares everything (files, every answer, the link) and opens it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { paths } from '../config.ts';
import { readJson, writeJson } from '../util/store.ts';
import type { Job } from '../sources/types.ts';
import type { Profile } from '../profile/schema.ts';

/** Boards that refused an automated submission. Later sends to them go straight to hand-off. */
const blockedFile = () => path.join(paths.me, 'handoff-boards.json');

export function isBlocked(board: string): boolean {
  return readJson<string[]>(blockedFile(), []).includes(board);
}

export function markBlocked(board: string): void {
  const all = readJson<string[]>(blockedFile(), []);
  if (!all.includes(board)) writeJson(blockedFile(), [...all, board]);
}

/** Words a board shows when its bot check rejected the submission. */
export const VERIFY_FAILED = /error verifying your application|verify (that )?you are (a )?human|captcha (failed|verification)|suspicious activity|automated (traffic|requests)/i;

export interface HandoffAnswer { label: string; value: string; required: boolean }

export interface Handoff { page: string; files: string[]; formUrl: string }

/** Copies files where a browser's file picker finds them, writes the answer sheet, and opens both. */
export function prepareHandoff(opts: { profile: Profile; job: Job; handle: string; formUrl: string; answers: HandoffAnswer[]; resume: string | null; cover: string | null; reason: string; open?: boolean }): Handoff {
  const { profile, job } = opts;
  const downloads = path.join(os.homedir(), 'Downloads');
  const dest = process.env.AAVEDAN_HANDOFF_DIR ?? (fs.existsSync(downloads) ? downloads : path.join(paths.me, 'handoff'));
  fs.mkdirSync(dest, { recursive: true });
  const base = `${profile.name.replace(/\s+/g, '_')}_${job.company.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')}`;
  const files: string[] = [];
  const copy = (src: string | null, suffix: string) => {
    if (!src || !fs.existsSync(src)) return null;
    const to = path.join(dest, `${base}_${suffix}.pdf`);
    fs.copyFileSync(src, to);
    files.push(to);
    return to;
  };
  const resume = copy(opts.resume, 'Resume');
  const cover = copy(opts.cover, 'Cover_Letter');

  const page = path.join(paths.me, 'handoff', `${opts.handle}.html`);
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, handoffHtml({ ...opts, resume, cover }));
  if (opts.open !== false && !process.env.AAVEDAN_NO_OPEN) {
    openInBrowser(page);
    setTimeout(() => openInBrowser(opts.formUrl), 600);
  }
  return { page, files, formUrl: opts.formUrl };
}

export function openInBrowser(target: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [target], () => {});
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function handoffHtml(o: { job: Job; handle: string; formUrl: string; answers: HandoffAnswer[]; resume: string | null; cover: string | null; reason: string }): string {
  const rows = o.answers.filter(a => a.value.trim());
  const empty = o.answers.filter(a => !a.value.trim() && a.required);
  const fileRow = (label: string, f: string | null) => f ? `<tr><th>${label}</th><td><code>${esc(f)}</code><div class="hint">Attach this file. It is in your Downloads folder.</div></td><td><button data-copy="${esc(f)}">Copy path</button></td></tr>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Send: ${esc(o.job.company)} · ${esc(o.job.title)}</title>
<style>
:root{--paper:#f7f2e8;--card:#fffdf8;--ink:#1f1b16;--muted:#6b6257;--line:#e5dccc;--accent:#b8461b;--soft:#f6e2d5}
@media (prefers-color-scheme:dark){:root{--paper:#16130f;--card:#1f1b16;--ink:#f1e9dc;--muted:#a99d8c;--line:#3a332a;--accent:#ef8a5b;--soft:#3d2519}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:28px 16px 60px}h1{margin:0 0 4px;font-size:24px}.muted{color:var(--muted)}
.note{background:var(--soft);color:var(--accent);border-radius:10px;padding:10px 14px;margin:16px 0}
ol{padding-left:20px}li{margin:4px 0}.go{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:9px 16px;border-radius:10px;margin:6px 0 18px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}th{width:34%;font-weight:600}tr:last-child th,tr:last-child td{border-bottom:0}
td:last-child{width:1%;white-space:nowrap}td{word-break:break-word}code{font-size:13px}.hint{color:var(--muted);font-size:13px;margin-top:3px}
button{font:inherit;font-size:13px;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:8px;padding:5px 10px;cursor:pointer}button:hover{border-color:var(--accent);color:var(--accent)}
.need{border-left:4px solid var(--accent)}
</style></head><body><div class="wrap">
<h1>${esc(o.job.company)} · ${esc(o.job.title)}</h1>
<div class="muted">${esc(o.job.locations.join('; '))}</div>
<p class="note">${esc(o.reason)} Send it from your own browser: everything below was prepared and checked by aavedan.</p>
<ol>
<li>Open the form (it opened in your browser too).</li>
<li>Attach the file${o.cover ? 's' : ''} below, then fill each question with the answer next to it. <b>Copy</b> puts it on your clipboard.</li>
<li>Click Submit, and complete a human check if the board shows one.</li>
<li>Then run <code>aavedan done ${esc(o.handle)}</code> so your records show it as sent.</li>
</ol>
<a class="go" href="${esc(o.formUrl)}" target="_blank" rel="noopener">Open the application form →</a>
<table>
${fileRow('Resume', o.resume)}${fileRow('Cover letter', o.cover)}
${rows.map(a => `<tr><th>${esc(a.label)}${a.required ? ' *' : ''}</th><td>${esc(a.value)}</td><td><button data-copy="${esc(a.value)}">Copy</button></td></tr>`).join('\n')}
${empty.map(a => `<tr class="need"><th>${esc(a.label)} *</th><td class="muted">Your answer: aavedan does not guess this one.</td><td></td></tr>`).join('\n')}
</table>
<p class="muted">Optional questions left out above are yours to answer or skip.</p>
</div>
<script>
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => b.textContent = t, 1200); } catch {}
});
</script></body></html>`;
}
