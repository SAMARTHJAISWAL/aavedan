---
name: tailor
description: Write a one-page resume, and optionally a cover letter, for one job from the user's profile, as PDFs. Use when the user types /tailor <id> or asks for a resume or cover letter for a job.
---

# /tailor

1. Run `node bin/aavedan.js tailor <id>` (add `--cover` for a cover letter).
2. Open the PDFs it names for the user, and read `resume.json` and `cover-letter.txt` next to them.
3. Tell the user which of the posting's keywords their profile does not support (the tool lists them and never adds them), and anything dropped by the fact check. If something true is missing from their profile, offer to add it to `me/profile.json` and tailor again.
4. `aavedan apply <id> --tailor` attaches the tailored resume when it applies.
