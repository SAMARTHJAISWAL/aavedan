---
name: apply
description: Fill job application forms in Chrome, read every answer back, and send only the ones the user approves. Use when the user types /apply, /apply <id>, /apply <posting link>, or asks to apply to jobs.
---

# /apply

Nothing is sent without the user's explicit yes in this conversation, for each job by name.

1. Pick the jobs: the ids or links the user gave, or the best few from `node bin/aavedan.js list`. Confirm the list with the user.
2. Rehearse first: `node bin/aavedan.js apply <ids or links> --no-input` (add `--tailor` to write a tailored resume, `--cover` for a cover letter). This opens Chrome, fills each form, reads every answer back from the page, and sends nothing.
3. Read the output. For every line `? needs you: “…”`, ask the user that question in the chat, with its options. Save each answer with `node bin/aavedan.js answer "<the question exactly as printed>" "<their answer>"`. Never answer these yourself: they are things like a past job at the company, a referral, a consent or a salary figure.
4. Show the user, per job, the filled answers that matter (work authorization, sponsorship, notice period, salary, anything written) and anything marked ✗. Run the rehearsal again after saving answers, until every form says every answer is on the page.
5. Ask the user, naming each job, whether to send it. Only for the jobs they approve, run `node bin/aavedan.js apply <those ids> --send --no-input --yes`. Forms that are not complete are held, never sent.
6. When a board shows a human check (a CAPTCHA), the form is held: tell the user to finish that form in the Chrome window themselves. Never try to solve it.
7. When a board rejects the automated submission ("error verifying your application"), aavedan hands it off: it copies the resume to Downloads, opens an answer sheet and the form in the user's own browser, and remembers the board so later sends go straight to hand-off. Never retry or try to get around it. Tell the user to submit from their browser, then run `node bin/aavedan.js done <id>`. `node bin/aavedan.js handoff <id>` prepares the same for any rehearsed job.
7. Report the result per job from the output: sent with the board's confirmation, or held with the reason. Records are in `me/applications.csv`.
