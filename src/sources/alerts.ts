// Jobs from LinkedIn and Naukri, read from the job-alert emails those sites send the person.
// Neither site offers a public jobs API, and both block automated searches, so aavedan reads what
// they already chose to send: the alert emails in the person's own Gmail, over IMAP, read-only.
import type { Job } from './types.ts';
import { decodeEntities, htmlToText } from '../util/text.ts';

export type AlertSite = 'linkedin' | 'naukri';

/** Gmail search for alert emails. Senders are matched loosely: both sites send alerts from several addresses. */
export const ALERT_QUERY = 'from:(jobalerts-noreply@linkedin.com OR jobs-listings@linkedin.com OR jobs-noreply@linkedin.com OR naukri.com) newer_than:14d';

const SITE_NAME: Record<AlertSite, string> = { linkedin: 'LinkedIn alert', naukri: 'Naukri alert' };

/** Links in alert emails are often wrapped in a tracker; look inside the decoded href too. */
function unwrap(href: string): string {
  let s = decodeEntities(href);
  for (let i = 0; i < 3 && /%2F|%3A/i.test(s); i++) {
    try { s = decodeURIComponent(s); } catch { break; }
  }
  return s;
}

interface Anchor { href: string; text: string; start: number; end: number }

function anchors(html: string): Anchor[] {
  const out: Anchor[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ href: unwrap(m[1]!), text: htmlToText(m[2]!).replace(/\s+/g, ' ').trim(), start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

const NOISE = /^(view job|apply|easy apply|see all jobs|see more jobs|save|actively recruiting|promoted|be an early applicant|new|unsubscribe|manage|job alert|\d+ (applicants?|connections?|alumni)|.*\bago)$/i;

/**
 * One job card per posting id: the title is the link text, and the lines after it, up to the next
 * card, hold the company and the place (LinkedIn writes "Company · Place", Naukri puts them on
 * separate lines next to the experience asked).
 */
function cards(html: string, idOf: (href: string) => string | null): { id: string; href: string; title: string; lines: string[] }[] {
  const all = anchors(html).map(a => ({ ...a, id: idOf(a.href) })).filter((a): a is Anchor & { id: string } => !!a.id);
  const firstIndex = new Map<string, number>();
  all.forEach((a, i) => { if (!firstIndex.has(a.id)) firstIndex.set(a.id, i); });
  const ids = [...firstIndex.keys()];
  return ids.map((id, k) => {
    const mine = all.filter(a => a.id === id);
    const next = ids[k + 1] !== undefined ? all[firstIndex.get(ids[k + 1]!)!]!.start : html.length;
    const from = mine[0]!.start;
    const title = mine.map(a => a.text).find(t => t && !NOISE.test(t) && t.length < 120) ?? '';
    const lines = htmlToText(html.slice(from, next))
      .split('\n').map(l => l.replace(/^•\s*/, '').trim())
      .filter(l => l && l !== title && !NOISE.test(l) && l.length < 160);
    return { id, href: mine[0]!.href, title, lines };
  }).filter(c => c.title);
}

function alertJob(site: AlertSite, c: { id: string; title: string; company: string; place: string; url: string; description: string }, date: string | null): Job {
  const remote = /remote|work from home|wfh/i.test(c.place);
  return {
    id: `${site}:${c.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}:${c.id}`,
    board: site, company: c.company, companySlug: c.company.toLowerCase(), postingId: c.id,
    title: c.title, locations: c.place ? [c.place] : [], remote, department: null,
    url: c.url, applyUrl: c.url, postedAt: date, description: c.description, via: SITE_NAME[site],
  };
}

// ---------- LinkedIn ----------

const LI_ID = /linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?#]*-)?(\d{6,})/i;

export function parseLinkedInAlert(html: string, date: string | null = null): Job[] {
  return cards(html, h => h.match(LI_ID)?.[1] ?? null).map(c => {
    const dot = c.lines.find(l => /\s·\s/.test(l));
    const [company, ...rest] = dot ? dot.split(/\s·\s/) : [c.lines[0] ?? '', c.lines[1] ?? ''];
    return alertJob('linkedin', {
      id: c.id, title: c.title, company: (company ?? '').trim() || 'LinkedIn', place: rest.join(', ').trim(),
      url: `https://www.linkedin.com/jobs/view/${c.id}/`, description: '',
    }, date);
  });
}

// ---------- Naukri ----------

const NK_ID = /naukri\.com\/job-listings-([a-z0-9-]+?)-(\d{10,14})(?:[/?#]|$)/i;
const NK_EXP = /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:yrs?|years?)\b/i;

export function parseNaukriAlert(html: string, date: string | null = null): Job[] {
  return cards(html, h => h.match(NK_ID)?.[2] ?? null).map(c => {
    const slug = c.href.match(NK_ID)?.[1] ?? '';
    const exp = c.lines.map(l => l.match(NK_EXP)).find(Boolean) ?? slug.match(/(\d{1,2})-to-(\d{1,2})-years/);
    const rest = c.lines.filter(l => !NK_EXP.test(l) && !/₹|lacs?|lpa|not disclosed|^\d+(\.\d)?$/i.test(l));
    const company = rest[0] ?? '';
    const place = rest.slice(1).find(l => /,|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|noida|gurgaon|gurugram|chennai|kolkata|remote|india|hybrid/i.test(l)) ?? '';
    const description = exp ? `Experience: ${exp[1]}-${exp[2]} years` : '';
    return alertJob('naukri', {
      id: c.id, title: c.title, company: company || 'Naukri', place,
      url: `https://www.naukri.com/job-listings-${slug}-${c.id}`, description,
    }, date);
  });
}

// ---------- Gmail ----------

export function alertsConfigured(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function siteOf(from: string): AlertSite | null {
  if (/linkedin\.com/i.test(from)) return 'linkedin';
  if (/naukri\.com/i.test(from)) return 'naukri';
  return null;
}

interface Part { part?: string; type?: string; childNodes?: Part[] }
function htmlPart(node: Part | undefined): string | null {
  if (!node) return null;
  if (node.type === 'text/html') return node.part ?? '1';
  for (const c of node.childNodes ?? []) {
    const p = htmlPart(c);
    if (p) return p;
  }
  return null;
}

/**
 * Reads the last two weeks of LinkedIn and Naukri job-alert emails from Gmail, read-only.
 * Needs GMAIL_USER and GMAIL_APP_PASSWORD (a Google app password, not the account password).
 */
export async function loadAlerts(opts: { max?: number } = {}): Promise<Job[]> {
  if (!alertsConfigured()) return [];
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD! },
  });
  await client.connect();
  const jobs: Job[] = [];
  try {
    const boxes = await client.list();
    const all = boxes.find(b => b.specialUse === '\\All')?.path ?? 'INBOX';
    const lock = await client.getMailboxLock(all, { readOnly: true });
    try {
      const uids = (await client.search({ gmraw: ALERT_QUERY }, { uid: true })) || [];
      const recent = uids.slice(-(opts.max ?? 60));
      if (!recent.length) return [];
      const msgs = await client.fetchAll(recent.join(','), { uid: true, envelope: true, bodyStructure: true }, { uid: true });
      for (const m of msgs) {
        const from = m.envelope?.from?.map(a => a.address ?? '').join(' ') ?? '';
        const site = siteOf(from);
        const part = htmlPart(m.bodyStructure as Part | undefined);
        if (!site || !part) continue;
        const dl = await client.download(String(m.uid), part, { uid: true });
        if (!('content' in dl) || !dl.content) continue;
        const chunks: Buffer[] = [];
        for await (const c of dl.content) chunks.push(c as Buffer);
        const html = Buffer.concat(chunks).toString('utf8');
        const date = m.envelope?.date ? new Date(m.envelope.date).toISOString() : null;
        jobs.push(...(site === 'linkedin' ? parseLinkedInAlert(html, date) : parseNaukriAlert(html, date)));
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  // The same posting arrives in several alerts; keep the newest copy.
  const byId = new Map<string, Job>();
  for (const j of jobs.sort((a, b) => (a.postedAt ?? '').localeCompare(b.postedAt ?? ''))) byId.set(j.id, j);
  return [...byId.values()];
}
