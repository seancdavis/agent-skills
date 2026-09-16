---
name: review-pr
description: Adversarial review of someone else's pull request, run as a companion for a human reviewer who does not know the code. Invoke with `/review-pr` (optionally a PR number, URL, or branch) when picking up a PR you didn't write and need to review well and fast. Runs in three gated steps — orient (what the PR claims, what it actually touches, delegated to a cheap subagent and retold plainly), review (two independent sides at once: Claude subagents one lens each, and read-only Codex passes on three of the same lenses, with this session judging the delta between them), then draft a pending GitHub review with inline comments you edit and submit yourself. Treats the PR author — increasingly an agent — as the adversary: every claim gets checked against code you actually opened. Checks the branch out and reads it locally rather than pulling files over the network, and treats CI output as the evidence instead of re-running the suite. Leaves the review PENDING, never submits, never pushes, never merges. NOT for reviewing your own agent-built work — `autopilot` already QAs that.
---

# Review PR — read it for me, then let me argue with it

You are reviewing a pull request **someone else wrote**, for a human who has not read this code and is not going to. Two things follow from that, and they shape everything below.

**The reviewer doesn't know the codebase.** Most review output assumes otherwise — it opens with findings, names files and symbols cold, and leaves the human to reconstruct what the PR even is. Orientation comes first here, always.

**The author is probably an agent, and possibly the same model as you.** So it is not a colleague whose judgment you extend trust to; it's a system that produces confident, plausible, well-formatted output whether or not it's right. The PR description is a _claim_, not a summary. Every finding is checked against code you actually opened.

## Who does what

- **Orchestrator** — this session (Opus or Fable). Scopes the passes, judges what comes back, and talks to the human. It does not read the whole PR itself and does not review.
- **Reviewers** — Claude subagents (`Agent`, model `sonnet`), one per lens, reading the checked-out tree.
- **Second opinion** — Codex, read-only, on three of the same lenses, launched at the same time as the reviewers and from the same branch, without seeing their findings.

The second opinion is **independent, not a checker.** Two reviews that never saw each other produce a delta, and the delta is what's worth the orchestrator's time: what both sides raised is almost certainly real, and what only one side raised is where opening the code actually decides something. A model handed Claude's list and asked to validate it can only shrink that list — it never contributes the finding Claude's lenses missed.

## The three gates

Each step ends by **stopping**. Do not roll from one into the next — the human's triage between steps is the point of the skill.

1. **Orient** — what is this, what problem, what approach. Stop.
2. **Review** — skeptical, verified, lens by lens. Report findings concisely. Stop.
3. **Draft** — compose a pending GitHub review from the findings that survived triage. Stop.

## Step 1 — Orient

**Get the branch onto the machine first.** Everything after this reads local files; the network is only for facts that live on GitHub — the description, the checks, the comments.

```sh
gh pr checkout <n>          # local working copy of the PR branch
gh pr view <n> --json title,body,author,files,commits,additions,deletions,baseRefName,url
gh pr checks <n>
git diff <base>...HEAD      # the diff, read locally
```

If the checkout can't happen — a fork you can't fetch, a dirty tree you shouldn't disturb — say so, and fall back to `gh pr diff <n>` with the reduced confidence that implies. A diff-only review can't check callers, so its findings are weaker and should be labelled that way.

**Delegate the reading; keep the retelling.** Hand a `sonnet` subagent the base ref and the PR body and ask it for the five things below, with a tight return contract. Reading a whole branch is the token-heavy part and doesn't need the expensive model — deciding what the human needs to hear does, and that stays here.

Then report, in well under a screen. Write it the way `dumb-it-down` writes: the problem in terms someone would notice, no identifier used before it's explained, no file names where a plain phrase works.

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

- **Read code locally, always.** A diff shows the change; it doesn't show the function it lives in, the callers, or the thing it broke three files over. Grep the checked-out tree, open whole files, follow every symbol you intend to comment on. Pulling file contents through the network one call at a time is slower and costs more for a worse view — the checkout in step 1 exists so you don't do that.
- **CI is the evidence — don't reproduce it.** If checks ran, use them. When one failed, read the actual failure (`gh run view <run-id> --log-failed`) and review _that_, rather than reasoning about what might be wrong or re-running the suite yourself. Reading a log you already have beats spending minutes regenerating it.
- **No CI, or no tests wired to it, is itself a finding.** A test suite that never runs on PRs is a Blocking-or-Follow-up problem depending on the repo's norms.
- **Reading is free; executing is not.** Reading and searching the local tree needs no permission. _Running_ anything — the test suite, a build, a script, the app — needs the human's say-so first: name the command and what it would tell you that CI can't, then wait. (This is deliberately open; when a good local-run case shows up, bring it back and we'll write the rule into this file.)
- **Never write anything.** No pushing, no committing, no editing the branch, no comments or reactions on GitHub. Reading and reporting only, until step 3's pending review.

### One lens per pass, on both sides

Mixed reviews fixate: the pass finds one interesting thread, follows it, and the rest slides past. So every pass gets exactly **one lens**, and the two sides run at the same time.

**The Claude side** — one `sonnet` subagent per lens, all five, dispatched together:

1. **Does it do what it claims?** The sharpest lens, and the one generic review skips. Walk the description's claims one at a time against the diff. Partial implementations pass every other check — code that's _present_ looks fine, and nothing flags what's missing.
2. **Correctness.** Real bugs, with a concrete failure case. If you can't name inputs that produce the wrong result, you have a suspicion, not a finding.
3. **Security and data exposure.** Auth boundaries, user-scoped queries, secrets, anything user-supplied reaching a query or a filesystem path.
4. **Fit.** Does it match how this codebase already does things, or reinvent something that exists? Duplication and convention drift.
5. **Tests.** Not "are there tests" but "do these tests fail if the code is wrong?" A test that passes against a broken implementation is a finding.

**The Codex side** — three of those same lenses, each its own read-only run, launched in the same breath as the subagents so both sides work from the same branch without seeing each other:

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/codex-review.mjs" --lens correctness --base main
node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/codex-review.mjs" --lens security --base main
gh pr view <n> --json body -q .body > /tmp/pr-body.md   # the claims lens needs the description
node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/codex-review.mjs" --lens claims --base main --claims-file /tmp/pr-body.md
```

Read-only is **structural**: the script calls the Codex companion's `task` with no `--write`, so the plugin forces a read-only sandbox — Codex cannot edit or even prompt to edit. The lens prompts live in `codex-review.mjs`; tune them there. Allowlist that one command in settings and all three passes run on a single approval.

Codex doesn't get the other two lenses. Whether the change fits the codebase's conventions, and whether the tests would fail on a broken implementation, both lean on knowing the project — which is where an outside model pays least.

**Both sides return the same shape**, or the comparison can't happen: title, `file:line`, what's wrong in one sentence, evidence (what was opened and what it showed), severity, confidence 0–1.

### Judge the delta

Neither dump goes to the human. Line the two sets up by file and claim, and spend the effort where they disagree:

- **Both sides raised it** — almost certainly real. Check it's genuinely the same finding and not two things that look alike, then keep it.
- **Only one side raised it** — this is where you open the code yourself. It's either something the other side's lens couldn't see or a confident model being wrong, and the only way to tell is to read it.
- **One side was confidently wrong** — that's evidence about the rest of that pass, not just that finding. Ask what it fixated on, and whether the lens is worth a second run with `--context` naming what it missed.
- **Neither side raised something you expected** — a file no lens covered, a check that never ran. Absence is a finding; say it.

The judged list, not either side's output, is what gets reported.

### Skepticism rules

- Confidence in the PR body is not evidence. Neither is confidence in your own first pass.
- If a claim can be checked, check it. If it can't, say so and mark the finding uncertain.
- Where you're genuinely unsure, that's a **question for the author**, not a finding. Say it that way.
- A finding that reveals the description was wrong about something is evidence about the _whole_ PR — go back and re-check the claims that rested on the same assumption.

### Report it

Severity vocabulary — the same four levels here and in the GitHub comments, though they're written differently in each. Bold in the terminal; bracketed and lowercase on GitHub (see the comment contract in step 3).

| Terminal      | GitHub        | Means                                               |
| ------------- | ------------- | --------------------------------------------------- |
| **Blocking**  | `[blocking]`  | Must be fixed before merge.                         |
| **Follow-up** | `[follow-up]` | Real, but shouldn't hold the merge. Needs an issue. |
| **Consider**  | `[consider]`  | A judgment call worth the author's attention.       |
| **Nit**       | `[nit]`       | Small. Take it or leave it.                         |

Format for the terminal — this follows the Concise output style, and it is not optional:

- **One line per finding.** What's wrong and what it costs, in plain words. No mechanism, no code, no fix.
- **Blocking and Follow-up listed in full.** Consider and Nit collapse to a count ("4 nits") unless asked.
- **Lead with the verdict** — approve, or changes needed, and the one reason why.
- **Then stop and offer to expand.** Depth is opt-in. The human picks what to dig into and what to drop.

## Step 3 — Draft the review

Compose from the findings that survived triage. Nothing the human waved off goes in.

### Load the voice first — before writing a word

Everything from here goes out on GitHub under the human's name, with no marker saying a model wrote it. So this is not the place to let the terminal register carry through.

**Read the author's voice profile before drafting** — `docs/writing-voice.md`, else `~/.claude/writing-voice.md` — and load `human-readable` for the anti-tell rules. Every run, not just the first.

Then aim at the **terse end** of that voice. A review comment sits far closer to how the author writes in chat than to how they write a blog post: short, direct, first person, willing to be a fragment. The profile's longer-form register is the wrong target here even though it's the same voice.

The tell to watch for is **completeness**. A model writes the whole thought — setup, finding, consequence, resolution — because that reads as thorough. A person who reviews code all day writes the part you couldn't work out yourself and trusts you with the rest.

### The body contract

**The body is the leftovers, not the summary.** Its only job is carrying what has no line to attach to. Everything with a home inline goes inline and is never repeated up top — a body that recaps the comments makes the reader read every finding twice and hides the one thing that was only ever going to appear there.

So the test for each sentence is: **could this have been an inline comment?** If yes, delete it and put it inline. What survives is usually one of:

- Something **missing entirely** — absent code has no line to anchor to.
- A pattern **across several files** that no single line represents.
- A **question about the approach** rather than about any particular change.
- **Coverage you didn't reach** — an area you couldn't check, a check that didn't run. The one thing the author can't see for themselves.

When nothing survives that test, the body is one line saying you left comments inline. That is a complete and correct body — most of them should look like it. No verdict, no lean, no tally: the verdict is the button, and saying it out loud publishes a note meant for the reviewer.

One or two sentences by default, first person, in the reviewer's own voice. Four is the ceiling and needs a reason.

What keeps ending up in there and must not:

- **Restating the inline comments.** The single most common failure. "There's a race in the session handler, the migration is missing a down step, and the test doesn't assert the error case" — all three are already inline, on their lines, with more context than the recap carries.

- **Process narration.** "Checked this out and read it locally," "I went through each file." A human reviewer never reports that they read the code — it's assumed, and saying it makes the review about the reviewer.
- **The verification trail.** "What I verified: exactly 11 pages mention X..." That's step 2's output. It's evidence that earns the conclusion, for the human triaging — the author needs the conclusion, not the audit. If a piece of it genuinely matters to the author, it's an inline comment on the line it concerns.
- **Labeled sections.** "What I verified:", "Summary:", "Findings:" — a body short enough to need headings isn't short enough.
- **A verdict line.** No "**Recommended verdict: approve.**" The verdict is the button the human presses; writing it out is a note-to-self published by accident.
- **Counting the comments.** "Four comments below, none blocking." GitHub already shows the count, and the labels already carry the severity.

A real one, before and after:

> Checked this out and read it locally. The sweep holds up.
>
> What I verified: exactly 11 pages mention Members — the 9 this PR changed, plus the two billing pages it deliberately skipped, and those two really are plan/usage table labels rather than navigation. No "Go to Members in the left navigation" instruction survives anywhere in the docs. Leaving the `app.netlify.com/.../members` deep links alone is the right call — EX-2916 covers those routes with redirects. And no agent-context grouping other than `deploy` sources any of these pages, so regenerating that one alone was correct.
>
> CodeRabbit's note about the step numbering in `security-scorecard.mdx` (1, 2, 4) is pre-existing and renders fine as an ordered list, so I'd leave it.
>
> Four comments below, none blocking.
>
> **Recommended verdict: approve.**

Everything there is either process narration, the verification trail, a recap, or a verdict. What was actually left over:

> Left a few notes inline. The step numbering in `security-scorecard.mdx` is pre-existing, so I'd leave it alone here.

### The comment contract

```markdown
[blocking] {one sentence: what is wrong}

{Optional second paragraph: the consequence, or the context needed to act. Only when the reader genuinely can't act without it.}
```

The label is `[blocking]`, `[follow-up]`, `[consider]` or `[nit]` — square brackets, lowercase, no bold, no em dash after it. The sentence runs straight on as if the tag were a word in it. Someone leaving review comments all day types a tag and keeps going; they don't format a header.

And **no bold anywhere in the comment** — not on the label, not on a phrase you want to stress. Bold is the tell that something was rendered rather than typed. Backticks on identifiers are fine; those are how people write code in prose.

Two more rules do most of the rest:

**Never prescribe the fix.** State what's wrong and stop. You don't know this codebase well enough to design in it, the author does, and a comment that only names the problem can't smuggle in a bad assumption. "This runs before the auth check" — not "move this below line 40."

**Assume a mixed audience.** A human may read it; an agent may act on it. The label carries the priority, the first sentence carries the meaning for a person skimming, and the second paragraph — when there is one — carries what an implementer needs. That's why the first sentence is never the detailed one.

Plain words, no ceremony, no "Consider refactoring this to leverage...". When you're unsure, ask a real question rather than asserting a soft finding.

### Post it as PENDING

One API call creates the review with all its inline comments attached, and **omitting `event` leaves it pending** — visible only to the reviewer, on the PR's Files tab under "Finish your review."

Write the payload to a file (the `comments` array won't survive `-f` flags), then:

```sh
gh api repos/{owner}/{repo}/pulls/{n}/reviews --input review.json
```

```json
{
  "body": "{only what has no line to attach to — often one sentence}",
  "comments": [
    { "path": "src/lib/session.ts", "line": 42, "side": "RIGHT", "body": "[blocking] ..." }
  ]
}
```

Notes that will bite otherwise:

- `line` must fall inside the diff. A comment that can't be anchored moves into the review body with a `file:line` pointer instead of being dropped.
- Do **not** include `event`. Adding `"event": "COMMENT"` submits it immediately, which is the one thing this skill must not do.
- The verdict stays **out** of the body. Recommend approve or request-changes in the terminal when you hand back, and let the human press the button.

Then hand back the Files-tab URL (`<pr-url>/files`), a one-line count of what's in the draft, and which button you'd press. Stop.

## Guardrails

- **Never submit the review.** Pending only. Submitting is the human's action.
- **Never route a review pass through anything that can write.** Both sides read; only step 3 produces output, and only as a pending review.
- **Never push, commit, merge, close, or edit the PR branch.** Checking it out is fine; changing it is not.
- **Read the local tree freely. Ask before executing anything**, and never run anything that writes outside this machine.
- **Never report a finding you didn't verify** — mark it uncertain or leave it out.
- **Never prescribe fixes in comments.**

## Related skills

- `open-pr` — the other side: opening a PR for someone else to review.
- `human-readable` — the voice for the GitHub-facing comments.
- `dumb-it-down` — the plainness bar for the orientation report.
- `autopilot` — QAs agent-built work before the PR exists; that's why this skill isn't for your own branches. Its `codex-audit.mjs` is the sibling of this skill's `codex-review.mjs`, with lenses for auditing work you just built rather than reviewing someone else's.
- `research` — the fan-out pattern the lens passes borrow.
