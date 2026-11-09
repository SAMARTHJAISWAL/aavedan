---
name: setup
description: Set up aavedan from a fresh clone — check the machine, read the user's resume into me/profile.json, ask the few things a resume does not say, and finish with one rehearsed application. Use when the user types /setup or asks to get started.
---

# /setup

Goal: from a fresh clone to one rehearsed application, in about fifteen minutes, most of it the user's answers.

1. Run `node bin/aavedan.js doctor`. Fix what you can: run `npm install` if `node_modules` is missing. If `ANTHROPIC_API_KEY` is missing, create `.env` from `.env.example` and ask the user to paste their key into it themselves. Never ask them to paste the key into the chat, and never print it.
2. Ask for the path to their resume PDF. Run `node bin/aavedan.js init <path> --no-interview`. If `me/profile.json` already exists, ask before adding `--force`.
3. Read `me/profile.json` and show the user what it says, briefly. Ask them to correct anything wrong. It is the only source of facts for every form, resume and letter.
4. Ask the questions a resume does not answer, conversationally and a few at a time, and write the answers into `me/profile.json` (keep it valid against `src/profile/schema.ts`):
   - countries where they may work without sponsorship → `workRights`
   - roles, levels (`intern`, `new-grad`, `junior`, `mid`, `senior`), Indian cities for office roles, remote in India, remote worldwide, other countries → `preferences`
   - years of full-time experience, notice period in days, current and expected CTC in LPA (expected may stay null; forms then ask the user)
   - standing answers for voluntary questions and recurring ones: `gender`, `pronouns`, `how-did-you-hear`, `willing-to-relocate`, `earliest-start`, and optionally `voice` (how they like to write)
   Never fill these in yourself from guesses.
5. Run `node bin/aavedan.js doctor` again until the profile is complete.
6. Run `node bin/aavedan.js find`, then show the top of `node bin/aavedan.js list`.
7. Ask which job to rehearse (suggest the top one), then follow /apply in rehearsal mode for it. Tell the user nothing is sent until they say so.
