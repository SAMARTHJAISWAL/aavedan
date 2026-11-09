---
name: status
description: Say in a few lines where the user's job search stands — sent, waiting for them, the queue, and what Claude has cost. Use when the user types /status or asks how things stand.
---

# /status

Run `node bin/aavedan.js status` and relay it in a few lines. For each held application, say what only the user can do and offer the next step (answer the question and rerun /apply, or finish a human check in Chrome). If the last find is more than two days old, offer /find.
