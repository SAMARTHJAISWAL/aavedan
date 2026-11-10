import { describe, expect, it } from 'vitest';
import { parseLinkedInAlert, parseNaukriAlert } from '../src/sources/alerts.ts';
import { yearsAsked } from '../src/jobs/filter.ts';

// Small hand-written markup in the shape these alert emails take; not copies of real emails.
const linkedin = `
<table><tr><td>
  <a href="https://www.linkedin.com/comm/jobs/view/4100000001/?trackingId=abc&amp;refId=x"><img alt="Acme"></a>
  <a href="https://www.linkedin.com/comm/jobs/view/4100000001/?trackingId=abc">Data Analyst</a>
  <p>Acme Analytics · Bengaluru, Karnataka, India</p>
  <p>Actively recruiting</p>
</td></tr><tr><td>
  <a href="https://click.example.com/r?u=https%3A%2F%2Fwww.linkedin.com%2Fcomm%2Fjobs%2Fview%2F4100000002%2F">BI Developer</a>
  <p>Northwind · India (Remote)</p>
  <a href="https://www.linkedin.com/comm/jobs/view/4100000002/">View job</a>
</td></tr></table>
<a href="https://www.linkedin.com/comm/jobs/search?keywords=data">See all jobs</a>`;

const naukri = `
<div><a href="https://www.naukri.com/job-listings-data-analyst-globex-bengaluru-1-to-3-years-101124000111?src=jobalert">Data Analyst</a>
  <div>Globex Pvt Ltd</div><div>1-3 Yrs</div><div>Not disclosed</div><div>Bengaluru, Hyderabad</div></div>
<div><a href="https://www.naukri.com/job-listings-analytics-engineer-initech-pune-0-to-2-years-101124000222">Analytics Engineer</a>
  <div>Initech</div><div>Pune</div></div>`;

describe('LinkedIn alert emails', () => {
  const jobs = parseLinkedInAlert(linkedin, '2026-11-10T05:00:00.000Z');
  it('reads one job per posting id, including links behind a click tracker', () => {
    expect(jobs.map(j => j.postingId)).toEqual(['4100000001', '4100000002']);
  });
  it('takes the title from the link and company and place from the line after it', () => {
    expect(jobs[0]).toMatchObject({ board: 'linkedin', title: 'Data Analyst', company: 'Acme Analytics', locations: ['Bengaluru, Karnataka, India'], via: 'LinkedIn alert' });
    expect(jobs[1]).toMatchObject({ title: 'BI Developer', company: 'Northwind', remote: true, url: 'https://www.linkedin.com/jobs/view/4100000002/' });
  });
});

describe('Naukri alert emails', () => {
  const jobs = parseNaukriAlert(naukri);
  it('reads title, company, place and the experience asked', () => {
    expect(jobs[0]).toMatchObject({ board: 'naukri', postingId: '101124000111', title: 'Data Analyst', company: 'Globex Pvt Ltd', locations: ['Bengaluru, Hyderabad'] });
    expect(yearsAsked(jobs[0]!.description)).toBe(1);
  });
  it('falls back to the experience written in the link', () => {
    expect(jobs[1]).toMatchObject({ title: 'Analytics Engineer', company: 'Initech', locations: ['Pune'] });
    expect(jobs[1]!.description).toBe('Experience: 0-2 years');
  });
});
