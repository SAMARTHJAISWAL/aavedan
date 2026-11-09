---
name: find
description: Read the job boards, drop jobs the user's rules rule out, rate the rest against their profile, and show the best. Use when the user types /find or asks for new jobs.
---

# /find

1. Run `node bin/aavedan.js find` (add `--rank 100` if the user wants more rated in one go). It reads about fifty companies' public Greenhouse, Lever and Ashby boards, keeps the jobs that pass the rules in `me/profile.json` (place, level, years asked, role), and rates new ones with Claude. A job already rated is not rated again.
2. Show the summary line and the best jobs. For anything the user asks about, run `node bin/aavedan.js show <id>` and give its fit, matches and gaps.
3. If many jobs were dropped for location or level and the user expected more, say which rule dropped them and offer to change `preferences` in `me/profile.json`.
4. To add a company: `node bin/aavedan.js add-company <board link> [Name]` (a jobs.lever.co, job-boards.greenhouse.io or jobs.ashbyhq.com link).
5. Offer the next step: rehearse the best one with /apply.
