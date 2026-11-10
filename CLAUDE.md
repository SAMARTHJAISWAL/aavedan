# aavedan — notes for Claude Code

A job search tool: find → rank → tailor → fill → read back → send on the user's yes.
Skills in `.claude/skills/` drive the CLI (`node bin/aavedan.js …`); the CLI is in `src/cli.ts`.

## Rules that must hold in any change

- The profile (`me/profile.json`) is the only source of facts. Generated text may rephrase it, never add to it;
  `src/tailor/check.ts` enforces that in code for every resume, letter and written answer.
- Work authorization, sponsorship, education and dates are never changed to suit a form
  (`workRightConflict` in `src/apply/plan.ts`). A question only the person can answer is asked, never guessed.
- Nothing is sent without the person's yes for that job. Unattended runs send only with `--yes`, and only forms
  whose every answer was read back from the page.
- Human checks (CAPTCHAs) are left to the person. Never add code that solves, hides from or works around them.
- Everything about the user lives in `me/` (git-ignored). The live demo is the author's own search (name, ranked jobs,
  rehearsals only: never contact details or CTC). Tests use the made-up candidate in
  `tests/fixtures/profile.ts`, never real personal data.
- Every Claude call goes through `src/llm.ts` and returns zod-validated JSON. Structured outputs do not enforce
  array sizes or number ranges, so clamp them in code, not in the schema.

## Layout

- `src/sources/` public board APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Keka), remote feeds, and
  `alerts.ts`: LinkedIn/Naukri job-alert emails read from Gmail over IMAP, read-only. Never scrape or automate
  LinkedIn, Naukri or X; applying there stays in the person's own browser. `companies.ts` is the default list
- `src/jobs/` rule filters (`filter.ts`, no model), Claude ranking (`rank.ts`), the queue (`store.ts`)
- `src/apply/` `page.ts` runs inside the page (self-contained functions only); `fill.ts` types and clicks;
  `plan.ts` decides answers; `run.ts` is one application end to end
- `src/tailor/` resume and letter drafts, the fact check, HTML → PDF
- `src/board/` the board page; `scripts/demo-board.ts` builds the GitHub Pages demo from `demo/board-data.json`

## Commands

```
npm test                 # unit tests + browser tests on local fixture forms (needs Chrome)
npm run typecheck
node bin/aavedan.js help
```

Real boards change their markup. When a form fails, rehearse it (`apply <id>` without `--send`), and add the
pattern to `tests/fixtures/forms.ts` as your own small markup, not a copy of the board's page.
