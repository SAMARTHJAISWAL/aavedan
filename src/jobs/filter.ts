// Rules that need no model: where a job is, what level it is, how many years it asks for.
// A job that fails here is never sent to Claude, so these must be cheap and explainable.
import type { Job } from '../sources/types.ts';
import type { Level, Profile } from '../profile/schema.ts';
import { limits } from '../config.ts';

/** Canonical Indian city → the ways postings write it. */
const INDIA_CITIES: Record<string, string[]> = {
  Bengaluru: ['bengaluru', 'bangalore', 'blr'],
  Hyderabad: ['hyderabad', 'secunderabad'],
  Pune: ['pune'],
  Mumbai: ['mumbai', 'bombay', 'navi mumbai', 'thane'],
  Delhi: ['delhi', 'new delhi'],
  Gurugram: ['gurugram', 'gurgaon'],
  Noida: ['noida', 'greater noida'],
  Chennai: ['chennai', 'madras'],
  Kolkata: ['kolkata', 'calcutta'],
  Ahmedabad: ['ahmedabad', 'gandhinagar'],
  Jaipur: ['jaipur'],
  Kochi: ['kochi', 'cochin'],
  Coimbatore: ['coimbatore'],
  Indore: ['indore'],
  Chandigarh: ['chandigarh', 'mohali', 'panchkula'],
  Thiruvananthapuram: ['thiruvananthapuram', 'trivandrum'],
  Mysuru: ['mysuru', 'mysore'],
};
/** "Delhi NCR" in a profile or posting means any of these. */
const NCR = ['Delhi', 'Gurugram', 'Noida'];

const COUNTRIES: Record<string, string[]> = {
  'United States': ['united states', 'usa', 'u.s.', 'us-remote', 'remote us', 'remote - us', 'remote, us', 'san francisco', 'new york', 'nyc', 'seattle', 'austin', 'boston', 'chicago', 'denver', 'los angeles', 'mountain view', 'palo alto', 'menlo park', 'sunnyvale', 'san jose', 'san mateo', 'washington, dc', 'atlanta', 'miami', ', ca', ', ny', ', wa', ', tx', ', ma'],
  'United Kingdom': ['united kingdom', 'uk', 'london', 'manchester', 'edinburgh', 'cambridge, uk'],
  Canada: ['canada', 'toronto', 'vancouver', 'montreal', 'ottawa', 'waterloo'],
  Germany: ['germany', 'berlin', 'munich', 'hamburg'],
  Netherlands: ['netherlands', 'amsterdam'],
  Ireland: ['ireland', 'dublin'],
  France: ['france', 'paris'],
  Spain: ['spain', 'madrid', 'barcelona'],
  Poland: ['poland', 'warsaw', 'krakow'],
  Singapore: ['singapore'],
  'United Arab Emirates': ['united arab emirates', 'uae', 'dubai', 'abu dhabi'],
  Australia: ['australia', 'sydney', 'melbourne'],
  Japan: ['japan', 'tokyo'],
  Israel: ['israel', 'tel aviv'],
  Brazil: ['brazil', 'são paulo', 'sao paulo'],
  Mexico: ['mexico'],
  Switzerland: ['switzerland', 'zurich'],
};

const has = (text: string, needle: string) => new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`, 'i').test(text);

export interface Place {
  indiaCities: string[];
  /** India named without a city, e.g. "India" or "Remote - India". */
  indiaAny: boolean;
  countries: string[];
  remote: 'none' | 'india' | 'global' | 'restricted';
}

export function placeOf(job: Pick<Job, 'locations' | 'remote'>): Place {
  const text = job.locations.join(' | ').toLowerCase();
  const indiaCities = Object.entries(INDIA_CITIES).filter(([, names]) => names.some(n => has(text, n))).map(([c]) => c);
  if (/\bncr\b/i.test(text)) for (const c of NCR) if (!indiaCities.includes(c)) indiaCities.push(c);
  const indiaAny = /\bindia\b|\bapac\b|\basia\b/i.test(text) || indiaCities.length > 0;
  const countries = Object.entries(COUNTRIES).filter(([, names]) => names.some(n => has(text, n))).map(([c]) => c);
  const saysRemote = /remote|anywhere|worldwide|distributed/i.test(text);
  const remoteSaid = job.remote || saysRemote;
  const region = /\b(emea|europe|eu|latam|americas|north america|us|uk|anz|nordics|dach)\b/i.test(text);
  let remote: Place['remote'] = 'none';
  if (remoteSaid) {
    if (/\bindia\b|\bapac\b|\basia\b/i.test(text)) remote = 'india';
    else if (/anywhere|worldwide|global/i.test(text)) remote = 'global';
    // A board's remote flag on a posting that names only a city is hybrid in that city, not open to all.
    else if (countries.length || region || (!saysRemote && text.trim())) remote = 'restricted';
    else remote = 'global';
  }
  return { indiaCities, indiaAny, countries, remote };
}

const LEVEL_RULES: [Level, RegExp][] = [
  ['intern', /\bintern(ship)?\b|\bco-?op\b|\btrainee\b/i],
  ['senior', /\b(senior|sr\.?|staff|principal|lead|manager|director|head|architect|vp|vice president|distinguished|fellow)\b|\b(sde|swe|engineer|developer)[ -]?(iii|iv|3|4)\b|\bl[5-9]\b/i],
  ['new-grad', /\bnew[ -]?grad(uate)?\b|\bgraduate\b|\bfresher\b|\bcampus\b|\buniversity\b|\bentry[ -]level\b|\bearly career\b|\b20(2[5-9]) (start|grad)/i],
  ['junior', /\bjunior\b|\bjr\.?\b|\bassociate (software|engineer|developer)|\b(sde|swe|engineer|developer)[ -]?(i|1)\b/i],
  ['mid', /\b(sde|swe|engineer|developer)[ -]?(ii|2)\b|\bmid[ -]level\b/i],
];

/** The level a title names, or null when it does not say. */
export function levelOf(title: string): Level | null {
  for (const [level, re] of LEVEL_RULES) if (re.test(title)) return level;
  return null;
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** The smallest number of years of experience the posting asks for, or null when it asks for none. */
export function yearsAsked(description: string): number | null {
  const n = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)`;
  const re = new RegExp(String.raw`(?:minimum (?:of )?|at least |)${n}\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(?:\d{1,2}\s*)?\+?\s*(?:years?|yrs?)(?:'s)?\s+(?:of\s+)?(?:\w+\s+){0,4}?(?:experience|exp\b|industry|professional|hands-on|work)`, 'gi');
  const found: number[] = [];
  for (const m of description.matchAll(re)) {
    const raw = m[1]!.toLowerCase();
    const v = WORD_NUM[raw] ?? Number(raw);
    if (v > 0 && v <= 20) found.push(v);
  }
  return found.length ? Math.min(...found) : null;
}

const TECH = /engineer|developer|\bsde\b|\bswe\b|software|programmer|data|machine learning|\bml\b|\bai\b|scientist|research|devops|\bsre\b|reliability|platform|backend|back-end|frontend|front-end|full[ -]?stack|mobile|android|\bios\b|security|infrastructure|cloud|\bqa\b|quality|test|automation|architect|technical|firmware|embedded|compiler|kernel/i;

export interface Verdict { pass: boolean; reason: string; place: Place; level: Level | null; years: number | null }

export function judge(job: Job, profile: Profile, now = new Date()): Verdict {
  const place = placeOf(job);
  const level = levelOf(job.title);
  const years = yearsAsked(job.description);
  const fail = (reason: string): Verdict => ({ pass: false, reason, place, level, years });
  const prefs = profile.preferences;

  if (prefs.excludeCompanies.some(x => x.toLowerCase() === job.company.toLowerCase())) return fail('company excluded');
  if (job.postedAt) {
    const age = (now.getTime() - new Date(job.postedAt).getTime()) / 86_400_000;
    if (age > limits.maxAgeDays) return fail(`posted ${Math.round(age)} days ago`);
  }
  const roleWords = prefs.roles.flatMap(r => r.toLowerCase().split(/\W+/)).filter(w => w.length > 2 && !['engineer', 'developer', 'role'].includes(w));
  if (!TECH.test(job.title) && !roleWords.some(w => job.title.toLowerCase().includes(w))) return fail('not a role you are looking for');

  if (!placeOk(place, profile)) return fail(`location: ${job.locations.join('; ') || 'not stated'}`);

  if (level && !prefs.levels.includes(level)) return fail(`level: ${level}`);
  if (years != null && years > profile.yearsOfExperience + 1) return fail(`asks for ${years}+ years`);
  return { pass: true, reason: 'ok', place, level, years };
}

export function placeOk(place: Place, profile: Profile): boolean {
  const prefs = profile.preferences;
  const wanted = new Set(prefs.indiaCities.flatMap(c => (/ncr/i.test(c) ? NCR : [canonicalCity(c)])));
  const anyIndia = prefs.indiaCities.some(c => /anywhere|any city|all/i.test(c));
  const canWorkIn = (country: string) =>
    prefs.countries.some(c => c.toLowerCase() === country.toLowerCase()) ||
    profile.workRights.some(w => w.country.toLowerCase() === country.toLowerCase() && w.status !== 'needs-sponsorship');

  if (place.remote === 'india' && prefs.remoteIndia) return true;
  if (place.remote === 'global' && (prefs.remoteGlobal || prefs.remoteIndia)) return true;
  if (place.remote === 'restricted' && place.countries.some(canWorkIn)) return true;
  if (place.indiaCities.some(c => wanted.has(c)) || (anyIndia && place.indiaAny)) return true;
  if (place.remote === 'none' && place.countries.some(canWorkIn)) return true;
  return false;
}

export function canonicalCity(name: string): string {
  const n = name.trim().toLowerCase();
  for (const [city, names] of Object.entries(INDIA_CITIES)) if (city.toLowerCase() === n || names.includes(n)) return city;
  return name.trim();
}
