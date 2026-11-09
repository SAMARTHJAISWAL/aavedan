// A made-up candidate used by tests and the demo. Not a real person.
import type { Profile } from '../../src/profile/schema.ts';

export const ananya: Profile = {
  name: 'Ananya Rao',
  email: 'ananya.rao@example.com',
  phone: '+91 98450 12345',
  city: 'Bengaluru',
  country: 'India',
  links: { linkedin: 'https://www.linkedin.com/in/example-ananya', github: 'https://github.com/example-ananya', portfolio: null },
  headline: 'Backend engineer, B.Tech CSE 2025',
  summary: 'Backend engineer with one year at a payments startup. Builds Go and Python services on PostgreSQL and Kafka.',
  workRights: [{ country: 'India', status: 'citizen' }],
  noticePeriodDays: 30,
  currentCtcLpa: 14,
  expectedCtcLpa: 20,
  graduationYear: 2025,
  yearsOfExperience: 1,
  education: [{ school: 'PES University', degree: 'B.Tech', field: 'Computer Science and Engineering', start: '2021', end: '2025', grade: '8.7/10 CGPA' }],
  experience: [{
    company: 'Paysetu', title: 'Software Engineer', location: 'Bengaluru', start: '2025-07', end: null,
    bullets: [
      'Built the refunds service in Go handling 40,000 refunds a day on PostgreSQL',
      'Cut p95 latency of the payouts API from 900 ms to 210 ms by batching ledger writes',
      'Moved settlement events to Kafka with idempotent consumers',
    ],
  }, {
    company: 'Kitebird Labs', title: 'Backend Intern', location: 'Remote', start: '2024-05', end: '2024-07',
    bullets: ['Wrote a Python job that reconciled 2 million rows of vendor data nightly'],
  }],
  projects: [{
    name: 'tinyqueue', url: 'https://github.com/example-ananya/tinyqueue', summary: 'A persistent job queue in Go',
    bullets: ['Write-ahead log with crash recovery, tested with fault injection'], tech: ['Go'],
  }],
  skills: ['Go', 'Python', 'PostgreSQL', 'Kafka', 'Redis', 'Docker', 'Kubernetes', 'AWS'],
  achievements: ['ICPC Asia Regionals 2023 finalist'],
  preferences: {
    roles: ['backend engineer', 'software engineer'],
    levels: ['new-grad', 'junior'],
    indiaCities: ['Bengaluru', 'Delhi NCR'],
    remoteIndia: true,
    remoteGlobal: true,
    countries: [],
    excludeCompanies: [],
    minFit: 70,
  },
  answers: { gender: 'Female', 'how-did-you-hear': 'Company careers page', 'willing-to-relocate': 'yes' },
};
