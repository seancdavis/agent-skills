---
name: review-pr
description: Adversarial review of someone else's pull request, run as a companion for a human reviewer who does not know the code. Invoke with `/review-pr` (optionally a PR number, URL, or branch) when picking up a PR you didn't write and need to review well and fast. Runs in three gated steps — orient (what the PR claims, what it actually touches), review (skeptical, verified, one lens at a time, fanned out to subagents), then draft a pending GitHub review with inline comments you edit and submit yourself. Treats the PR author — increasingly an agent — as the adversary: every claim gets checked against the diff, and CI is the evidence rather than a local re-run. Leaves the review PENDING, never submits, never pushes, never merges. NOT for reviewing your own agent-built work — `autopilot` already QAs that.
---

# Review PR — read it for me, then let me argue with it

You are reviewing a pull request **someone else wrote**, for a human who has not read this code and is not going to. Two things follow from that, and they shape everything below.

**The reviewer doesn't know the codebase.** Most review output assumes otherwise — it opens with findings, names files and symbols cold, and leaves the human to reconstruct what the PR even is. Orientation comes first here, always.

**The author is probably an agent, and possibly the same model as you.** So it is not a colleague whose judgment you extend trust to; it's a system that produces confident, plausible, well-formatted output whether or not it's right. The PR description is a _claim_, not a summary. Every finding is checked against code you actually opened.

## The three gates

Each step ends by **stopping**. Do not roll from one into the next — the human's triage between steps is the point of the skill.

1. **Orient** — what is this, what problem, what approach. Stop.
2. **Review** — skeptical, verified, lens by lens. Report findings concisely. Stop.
3. **Draft** — compose a pending GitHub review from the findings that survived triage. Stop.

## Step 1 — Orient

Gather the PR's own account of itself and the shape of what it touches:

```sh
gh pr view <n> --json title,body,author,files,commits,additions,deletions,baseRefName,url
gh pr checks <n>
gh pr diff <n>
```

Then report, in well under a screen:

- **What problem it says it's solving**, in plain words — the user-facing or system-facing thing that was wrong.
- **The approach it took** — the shape of the solution, not a file list. "Moves session lookup into middleware" beats "changes 4 files in `src/lib/`."
- **The blast radius** — which areas of the app this can affect, including ones the description doesn't mention.
- **CI status** — passing, failing, or _absent_. Note anything the checks don't cover.
- **Anything the description leaves out** — files touched that the body never accounts for. Flag it here; don't investigate it yet.

Gloss every identifier the first time it appears. Assume the human has never opened this repo.

End with an explicit handoff: they can ask about anything above, or say go.

## Step 2 — Review

Only after they say go.

### Verification is the whole job

An unverified finding is worse than no finding — it costs the human trust and the author time. So:

- **Open the code, not the diff hunk.** A diff shows the change; it doesn't show the function it lives in, the callers, or the thing it broke three files over. Read around every change you intend to comment on.
- **CI is the evidence.** If checks ran, use them. When one failed, read the actual failure (`gh run view <run-id> --log-failed`) and review _that_, rather than reasoning about what might be wrong. Don't recreate locally what CI already told you.
- **No CI, or no tests wired to it, is itself a finding.** A test suite that never runs on PRs is a Blocking-or-Follow-up problem depending on the repo's norms.
- **Ask before running anything locally.** If there's a real reason to check something out and run it — behavior CI can't tell you, a reproduction you need to see — say what you'd run and why, and wait. (This is a deliberately open question; when a good local-run case shows up, bring it back and we'll write the rule into this file.)
- **Never write to any system.** No pushing, no commenting, no committing, no editing the branch. Reading and reporting only, until step 3's pending review.

### One lens per pass

Mixed reviews fixate: the pass finds one interesting thread, follows it, and the rest slides past. Run these as **separate passes**, and fan them out to subagents when the PR is big enough to warrant it — each subagent gets one lens and a tight return contract (finding, `file:line`, evidence, confidence).

1. **Does it do what it claims?** The sharpest lens, and the one generic review skips. Walk the description's claims one at a time against the diff. Partial implementations pass every other check — code that's _present_ looks fine, and nothing flags what's missing.
2. **Correctness.** Real bugs, with a concrete failure case. If you can't name inputs that produce the wrong result, you have a suspicion, not a finding.
3. **Security and data exposure.** Auth boundaries, user-scoped queries, secrets, anything user-supplied reaching a query or a filesystem path.
4. **Fit.** Does it match how this codebase already does things, or reinvent something that exists? Duplication and convention drift.
5. **Tests.** Not "are there tests" but "do these tests fail if the code is wrong?" A test that passes against a broken implementation is a finding.

### Skepticism rules

- Confidence in the PR body is not evidence. Neither is confidence in your own first pass.
- If a claim can be checked, check it. If it can't, say so and mark the finding uncertain.
- Where you're genuinely unsure, that's a **question for the author**, not a finding. Say it that way.
- A finding that reveals the description was wrong about something is evidence about the _whole_ PR — go back and re-check the claims that rested on the same assumption.

### Report it

Severity vocabulary — the same four labels here and in the GitHub comments:

| Label         | Means                                               |
| ------------- | --------------------------------------------------- |
| **Blocking**  | Must be fixed before merge.                         |
| **Follow-up** | Real, but shouldn't hold the merge. Needs an issue. |
| **Consider**  | A judgment call worth the author's attention.       |
| **Nit**       | Small. Take it or leave it.                         |

Format for the terminal — this follows the Concise output style, and it is not optional:

- **One line per finding.** What's wrong and what it costs, in plain words. No mechanism, no code, no fix.
- **Blocking and Follow-up listed in full.** Consider and Nit collapse to a count ("4 nits") unless asked.
- **Lead with the verdict** — approve, or changes needed, and the one reason why.
- **Then stop and offer to expand.** Depth is opt-in. The human picks what to dig into and what to drop.

## Step 3 — Draft the review

Compose from the findings that survived triage. Nothing the human waved off goes in.

### The comment contract

```markdown
**Blocking** — {one sentence: what is wrong}

{Optional second paragraph: the consequence, or the context needed to act. Only when the reader genuinely can't act without it.}
```

Two rules do most of the work:

**Never prescribe the fix.** State what's wrong and stop. You don't know this codebase well enough to design in it, the author does, and a comment that only names the problem can't smuggle in a bad assumption. "This runs before the auth check" — not "move this below line 40."

**Assume a mixed audience.** A human may read it; an agent may act on it. The label carries the priority, the first sentence carries the meaning for a person skimming, and the second paragraph — when there is one — carries what an implementer needs. That's why the first sentence is never the detailed one.

Write it in Sean's voice, not review-bot voice. Load `human-readable` for the register: plain words, no ceremony, no "Consider refactoring this to leverage...". When you're unsure, ask a real question rather than asserting a soft finding.

### Post it as PENDING

One API call creates the review with all its inline comments attached, and **omitting `event` leaves it pending** — visible only to the reviewer, on the PR's Files tab under "Finish your review."

Write the payload to a file (the `comments` array won't survive `-f` flags), then:

```sh
gh api repos/{owner}/{repo}/pulls/{n}/reviews --input review.json
```

```json
{
  "body": "{summary + verdict recommendation}",
  "comments": [
    { "path": "src/lib/session.ts", "line": 42, "side": "RIGHT", "body": "**Blocking** — ..." }
  ]
}
```

Notes that will bite otherwise:

- `line` must fall inside the diff. A comment that can't be anchored moves into the review body with a `file:line` pointer instead of being dropped.
- Do **not** include `event`. Adding `"event": "COMMENT"` submits it immediately, which is the one thing this skill must not do.
- The review body carries a **recommended verdict** — approve or request changes — as a line the human can keep or cut. The actual verdict is the button they press.

Then hand back the Files-tab URL (`<pr-url>/files`) and a one-line count of what's in the draft. Stop.

## Guardrails

- **Never submit the review.** Pending only. Submitting is the human's action.
- **Never push, commit, merge, close, or edit the PR branch.** This skill reads and drafts.
- **Never run anything locally without asking**, and never anything that writes outside this machine.
- **Never report a finding you didn't verify** — mark it uncertain or leave it out.
- **Never prescribe fixes in comments.**

## Related skills

- `open-pr` — the other side: opening a PR for someone else to review.
- `human-readable` — the voice for the GitHub-facing comments.
- `autopilot` — QAs agent-built work before the PR exists; that's why this skill isn't for your own branches.
- `research` — the fan-out pattern the lens passes borrow.
