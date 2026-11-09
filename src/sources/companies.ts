// Companies whose public boards are read by default, checked live on 2026-11-09.
// Add your own with `aavedan add-company <board link>`; they are kept in me/companies.json.
import type { Company } from './types.ts';
import { paths } from '../config.ts';
import { readJson, writeJson } from '../util/store.ts';

const c = (name: string, board: Company['board'], slug: string, hq: string): Company => ({ name, board, slug, hq });

export const DEFAULT_COMPANIES: Company[] = [
  // Engineering in India
  c('Paytm', 'lever', 'paytm', 'Noida'),
  c('Meesho', 'lever', 'meesho', 'Bengaluru'),
  c('CRED', 'lever', 'cred', 'Bengaluru'),
  c('Zeta', 'lever', 'zeta', 'Bengaluru'),
  c('FamPay', 'lever', 'fampay', 'Bengaluru'),
  c('Pocket FM', 'lever', 'pocketfm', 'Bengaluru'),
  c('Sarvam AI', 'ashby', 'sarvam', 'Bengaluru'),
  c('Atlan', 'ashby', 'atlan', 'Remote'),
  c('Shift', 'ashby', 'shift', 'Bengaluru'),
  c('Bureau', 'ashby', 'bureau', 'Bengaluru'),
  c('Groww', 'greenhouse', 'groww', 'Bengaluru'),
  c('InMobi', 'greenhouse', 'inmobi', 'Bengaluru'),
  c('Glance', 'greenhouse', 'glance', 'Bengaluru'),
  c('Sigmoid', 'greenhouse', 'sigmoid', 'Bengaluru'),
  c('HackerRank', 'greenhouse', 'hackerrank', 'Bengaluru'),
  c('Druva', 'greenhouse', 'druva', 'Pune'),
  c('Observe.AI', 'greenhouse', 'observeai', 'Bengaluru'),
  c('eClinical Solutions', 'greenhouse', 'eclinicalsolutions', 'Bengaluru, Mansfield MA'),
  c('Razorpay', 'greenhouse', 'razorpaysoftwareprivatelimited', 'Bengaluru'),
  c('Tekion', 'ashby', 'tekion', 'Bengaluru, Chennai'),
  c('Atlys', 'ashby', 'atlys', 'Bengaluru'),
  c('Hevo Data', 'lever', 'hevodata', 'Bengaluru'),
  c('Mindtickle', 'lever', 'mindtickle', 'Pune'),
  // SmartRecruiters (Indian postings only)
  c('Swiggy', 'smartrecruiters', 'Swiggy', 'Bengaluru'),
  c('Freshworks', 'smartrecruiters', 'Freshworks', 'Chennai, Bengaluru'),
  c('ServiceNow', 'smartrecruiters', 'ServiceNow', 'Hyderabad'),
  c('Bosch', 'smartrecruiters', 'BoschGroup', 'Bengaluru, Coimbatore'),
  // Keka careers portals
  c('SatSure', 'keka', 'satsure', 'Bengaluru'),
  c('Zluri', 'keka', 'zluri', 'Bengaluru'),
  c('Eloelo', 'keka', 'eloelo', 'Bengaluru'),
  c('Signzy', 'keka', 'signzy', 'Bengaluru'),
  c('Analytics Vidhya', 'keka', 'analyticsvidhya', 'Gurugram'),
  c('ClickPost', 'keka', 'clickpost', 'Noida'),
  c('Jupiter', 'keka', 'jupiter', 'Bengaluru, Mumbai'),
  c('Snitch', 'keka', 'snitch', 'Bengaluru'),
  c('Loop', 'keka', 'loop', 'Bengaluru'),
  c('WebEngage', 'keka', 'webklipper', 'Mumbai'),
  c('Kuku FM', 'keka', 'kukufm', 'Bengaluru'),
  c('Cars24', 'keka', 'cars24', 'Gurugram'),
  c('Teachmint', 'keka', 'teachmint', 'Bengaluru'),
  c('Adda247', 'keka', 'adda247', 'Gurugram'),
  c('Niyo', 'keka', 'niyo', 'Bengaluru'),
  // Global companies with Indian offices
  c('Databricks', 'greenhouse', 'databricks', 'Bengaluru, San Francisco'),
  c('Stripe', 'greenhouse', 'stripe', 'Bengaluru, San Francisco'),
  c('MongoDB', 'greenhouse', 'mongodb', 'Gurugram, New York'),
  c('Okta', 'greenhouse', 'okta', 'Bengaluru, San Francisco'),
  c('Zscaler', 'greenhouse', 'zscaler', 'Bengaluru, Mohali, San Jose'),
  c('GitLab', 'greenhouse', 'gitlab', 'Remote'),
  c('Elastic', 'greenhouse', 'elastic', 'Remote'),
  c('Twilio', 'greenhouse', 'twilio', 'Bengaluru, Remote'),
  c('Coinbase', 'greenhouse', 'coinbase', 'Remote'),
  c('Airbnb', 'greenhouse', 'airbnb', 'Gurugram, San Francisco'),
  c('Datadog', 'greenhouse', 'datadog', 'New York'),
  c('Anthropic', 'greenhouse', 'anthropic', 'San Francisco, Bengaluru'),
  c('Samsara', 'greenhouse', 'samsara', 'Bengaluru, San Francisco'),
  c('Figma', 'greenhouse', 'figma', 'San Francisco'),
  c('Snowflake', 'ashby', 'snowflake', 'Pune, San Mateo'),
  c('ClickHouse', 'ashby', 'clickhouse', 'Remote'),
  c('OpenAI', 'ashby', 'openai', 'San Francisco'),
  c('Notion', 'ashby', 'notion', 'San Francisco'),
  c('Grafana Labs', 'greenhouse', 'grafanalabs', 'Remote'),
  c('Temporal', 'ashby', 'temporal', 'Remote'),
  // Remote-first
  c('Supabase', 'ashby', 'supabase', 'Remote'),
  c('PostHog', 'ashby', 'posthog', 'Remote'),
  c('Sentry', 'ashby', 'sentry', 'Remote'),
  c('Linear', 'ashby', 'linear', 'Remote'),
  c('Render', 'ashby', 'render', 'Remote'),
  c('Railway', 'ashby', 'railway', 'Remote'),
  c('Replit', 'ashby', 'replit', 'Remote'),
  c('Zapier', 'ashby', 'zapier', 'Remote'),
  c('Dropbox', 'greenhouse', 'dropbox', 'Remote'),
  c('Reddit', 'greenhouse', 'reddit', 'Remote'),
  c('Cohere', 'ashby', 'cohere', 'Toronto, Remote'),
  c('Vercel', 'greenhouse', 'vercel', 'Remote'),
];

export function allCompanies(): Company[] {
  const mine = readJson<Company[]>(paths.companies, []);
  const seen = new Set<string>();
  return [...mine, ...DEFAULT_COMPANIES].filter(x => {
    const k = `${x.board}:${x.slug}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export function addCompany(co: Company): void {
  const mine = readJson<Company[]>(paths.companies, []);
  if (!mine.some(x => x.board === co.board && x.slug === co.slug)) writeJson(paths.companies, [...mine, co]);
}
