---
name: dumb-it-down
description: Redo the last answer in plain, literal terms for someone who doesn't know how the system works, or knew once and hasn't held onto it. Invoke when the user types `/dumb-it-down` (optionally naming the part to redo), or says "simplify," "dumb it down," "I don't follow," or "what does that mean" about an explanation — the last reply assumed background they don't have, leaned on code they didn't ask about, or used stand-in words ("floor," "ceiling") instead of saying the thing. Same length budget, less assumed knowledge. When "simplify" is about an explanation, this is the skill, not the built-in `simplify` (which edits code). NOT `human-readable` (public-facing prose).
---

# Dumb it down

The last answer assumed too much. Redo it for someone smart who doesn't know this system, or learned it once and has since lost track. The length budget stays the same (Concise's 150 words). What gets cut is the assumed background, not the brevity.

## What to redo

- **No argument:** the last answer.
- **Argument present** (`/dumb-it-down the caching part`): only that part.

Don't apologize or announce the rewrite. Start with the new answer.

## How

- **Start with what the user would see.** Open with one plain sentence about what the thing does or what went wrong, in terms of what someone would notice. Get to part names later, if at all. "The page shows yesterday's prices because it's reading a saved copy" comes before any mention of cache settings.
- **Say the concrete thing, not a label for it.** When a word stands in for a longer idea (floor, ceiling, lever, seam, load-bearing), replace it with the longer idea. Write "keep the shutter at 1/250 or faster," not "respect your floor." This includes terms you defined earlier in the conversation, because the user may not have kept them.
- **No code unless the question was about code.** Describe what changes in behavior, not which function, object, or file changes. "This PR keeps you logged in for 30 days instead of 1," not "this PR bumps `maxAge` on the session cookie." If an identifier can't be avoided, explain it in the same sentence.
- **Plain, but still specific.** "They're blurry. Use a faster shutter and raise ISO to make up the light" is plain and specific, and each part is something the user can ask about next. "There's an exposure issue" is plain but useless.
- **Leave the details for follow-ups.** Don't explain the why behind every point up front. The user will ask about the parts they care about.

Before sending, check: could someone who has never seen this codebase or done this hobby read every sentence without stopping to ask what a word means?

## After it's invoked

Keep answering at this level for the rest of the session. Having to ask once means the earlier level was too high, not only that one answer.

A second `/dumb-it-down` on the same answer means you still assumed too much. Go one step further back: explain what the tool or domain is for in the first place.
