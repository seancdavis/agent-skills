---
name: review-pr
description: Adversarial review of someone else's pull request, run as a companion for a human reviewer who does not read the code. Invoke with `/review-pr` (optionally a PR number, URL, or branch) when picking up a PR you didn't write and need to review well and fast. Starts from the problem the PR is meant to solve — read from whatever the PR links to, or asked of you when nothing is — never from the PR's own description. Runs in three gated steps — orient (the problem, the approach, which changes are mechanical and safe to skip, and the author's decisions where your judgment is wanted), review (two independent sides at once: Claude subagents one lens each, and read-only Codex passes on three of the same lenses, with this session judging the delta between them and bringing you everything that needs you in one report once the passes finish), then draft a pending GitHub review whose comments read plainly for people and carry a collapsed section for agents. Only blocking comments are marked; edge cases come to you as a separate batch to pick from. Treats the PR author — increasingly an agent — as the adversary: every claim gets checked against code you actually opened. Checks the branch out and reads it locally rather than pulling files over the network, and treats CI output as the evidence instead of re-running the suite. Leaves the review PENDING, never submits, never pushes, never merges. On your own PR (you're the author, or `/review-pr mine`) it runs the same review without the orientation explainer and prints the findings in-session instead of drafting anything on GitHub.
---

# Review PR — read it for me, then let me make the calls

You are reviewing a pull request **someone else wrote**, for a human who is not going to read the code. They are still the reviewer: the judgment calls are theirs, and your job is to bring those calls to them with enough context to decide. Three things follow, and they shape everything below.

**The reviewer doesn't read the code.** Most review output assumes otherwise — it opens with findings, names files and symbols cold, and leaves the human to reconstruct what the PR even is. Orientation comes first here, always.

**The problem comes from outside the PR.** The issue it closes, the ticket it names, or the human telling you. The PR description describes the fix; a review that takes the fix as its context can only check the fix against itself.

**The author is probably an agent, and possibly the same model as you.** So it is not a colleague whose judgment you extend trust to; it's a system that produces confident, plausible, well-formatted output whether or not it's right. The PR description is a _claim_, not a summary. Every finding is checked against code you actually opened.

## Who does what

- **Orchestrator** — this session (Opus or Fable). Scopes the passes, judges what comes back, and talks to the human. It does not read the whole PR itself and does not review.
- **Reviewers** — Claude subagents (`Agent`, model `sonnet`), one per lens, reading the checked-out tree.
- **Second opinion** — Codex, read-only, on three of the same lenses, launched at the same time as the reviewers and from the same branch, without seeing their findings.

The second opinion is **independent, not a checker.** Two reviews that never saw each other produce a delta, and the delta is what's worth the orchestrator's time: what both sides raised is almost certainly real, and what only one side raised is where opening the code actually decides something. A model handed Claude's list and asked to validate it can only shrink that list — it never contributes the finding Claude's lenses missed.

## The three gates

Each step ends by **stopping**. Do not roll from one into the next — the human's calls between steps are the point of the skill.

1. **Orient** — the problem, the approach, what's safe to skip, the decisions worth a judgment call. Stop.
2. **Review** — skeptical, verified, lens by lens, reported in one message once every pass is done. Stop.
3. **Draft** — compose a pending GitHub review from what the human picked. Stop.

## Self mode — reviewing your own PR

Runs when the PR's author is the human you're working with (compare `author` from step 1's `gh pr view` against `gh api user -q .login`), or when they pass `mine`. The review itself doesn't change — an agent-built PR earns the same skepticism whoever commissioned it. What goes is everything built for a reviewer who doesn't read the code and a comment that goes out under their name:

- **Step 1** — do the setup (problem file, body file, CI file; skip the checkout if you're already on the branch) but not the orientation subagent or report. Finding the problem still applies: read what the PR links to, and if nothing is linked, ask for it in one line. If checks are still running, say so in one line. Don't stop; go straight into step 2.
- **Step 2** — unchanged, except when the human expands a finding, say how you'd fix it. The never-prescribe rule is for comments on someone else's code.
- **Step 3** — skipped. Nothing goes to GitHub: no pending review, no comments, no voice loading. The step 2 report is the deliverable; stop there.

## Step 1 — Orient

**Get the branch onto the machine first.** Everything after this reads local files; the network is only for facts that live elsewhere — the description, the checks, the linked issue.

```sh
gh pr checkout <n>          # local working copy of the PR branch
gh pr view <n> --json title,body,author,files,commits,additions,deletions,baseRefName,headRefName,closingIssuesReferences,url
gh pr checks <n>
git diff <base>...HEAD      # the diff, read locally
```

### Find the problem before anything else

The problem is what the PR is meant to solve, and it comes from whatever the PR points to. Read all of it:

- Issues it closes — `closingIssuesReferences` in the `gh pr view` output.
- Any issue number, ticket key, or URL in the title, the body, or the branch name — a GitHub issue through `gh issue view`, a Linear key like `EX-2916` through the Linear tools when they're connected.

Write what the sources say — the problem as stated, not your summary of it — to `/tmp/pr-<n>-problem.md`, with where each part came from.

**If nothing is linked, or what's linked can't be read, stop and ask the human** for the problem in a sentence or two before going any further. They often have the context. Their answer goes in the same file. Anything else they point you to — a Slack thread, a doc — goes in it too.

Never fall back to the PR description as the problem. It's the author's account of the fix.

### Pull the rest into files once

Every pass in step 2 — Claude subagents and Codex alike — reads the same copies, so nobody re-fetches them and nobody reaches for the test suite to find out what CI already knows.

```sh
gh pr view <n> --json body -q .body > /tmp/pr-<n>-body.md     # the author's claims
gh pr checks <n> > /tmp/pr-<n>-ci.md
gh run view <run-id> --log-failed >> /tmp/pr-<n>-ci.md   # once per failed run
```

Keep the CI file readable: for a long failure log, trim to the error and the lines around it. If checks are still running, say so in the orient report, and refresh the file before step 2 so the passes see the finished results.

If the checkout can't happen — a fork you can't fetch, a dirty tree you shouldn't disturb — say so, and fall back to `gh pr diff <n>` with the reduced confidence that implies. A diff-only review can't check callers, so its findings are weaker and should be labelled that way.

### Delegate the reading; keep the retelling

Hand a `sonnet` subagent the base ref and the problem, body, and CI files, and ask it for the items below, with a tight return contract. Reading a whole branch is the token-heavy part and doesn't need the expensive model — deciding what the human needs to hear does, and that stays here.

Then report, in well under a screen. Write it the way `dumb-it-down` writes: the problem in terms someone would notice, no identifier used before it's explained, no file names where a plain phrase works.

- **The problem**, as the linked source states it (or as the human told you), in plain words — and where it came from.
- **The approach the PR took** — the shape of the solution, not a file list. "Moves session lookup into middleware" beats "changes 4 files in `src/lib/`."
- **Mechanical changes** — renames, moved files, generated code, formatting, lockfiles. One line naming them and saying they're safe to skip.
- **Decisions**, numbered — the few places where the author picked one way when another reasonable way existed. Each is one line: what was picked, and the alternative. "Added a new date library instead of using the one the project already has." "Checks the session in middleware instead of in each page." Only real forks; most lines aren't decisions. This is where the human's taste comes in.
- **The blast radius** — which areas of the app this can affect, including ones the description doesn't mention.
- **CI status** — passing, failing, or _absent_. Note anything the checks don't cover.
- **Anything unaccounted for** — files touched that neither the problem nor the description explains. Flag it here; don't investigate it yet.

Gloss every identifier the first time it appears. Assume the human has never opened this repo.

End with an explicit handoff: they can react to any decision by number, ask about anything above, or say go.

**Their reactions to the decisions are context for every pass.** Append them to the problem file under a "Reviewer's notes" heading before step 2. A decision they disagreed with becomes a finding in step 2, written from their reasoning rather than the passes'.

## Step 2 — Review

Only after they say go.

### Verification is the whole job

An unverified finding is worse than no finding — it costs the human trust and the author time. So:

- **Read code locally, always.** A diff shows the change; it doesn't show the function it lives in, the callers, or the thing it broke three files over. Grep the checked-out tree, open whole files, follow every symbol you intend to comment on. Pulling file contents through the network one call at a time is slower and costs more for a worse view — the checkout in step 1 exists so you don't do that.
- **CI is the evidence — don't reproduce it.** If checks ran, use them. The CI file from step 1 carries the results and the failure logs; review _those_, rather than reasoning about what might be wrong or re-running the suite. When a pass needs more — a full log, an artifact, a check's details — the orchestrator fetches it and appends it to the CI file. Reading a log you already have beats spending minutes regenerating it.
- **The passes don't read this file.** Subagents and Codex only see what they're handed. Every subagent prompt carries the problem and CI files, the definitions in "Where the line is" below, the question rule, the return shape, and the rule: read and search freely, never run tests, builds, installs, or project scripts. Codex gets the same through `codex-review.mjs`.
- **No CI, or no tests wired to it, is itself a finding** — a non-blocking one.
- **Reading is free; executing is not.** Reading and searching the local tree needs no permission. _Running_ anything — the test suite, a build, a script, the app — needs the human's say-so first: name the command and what it would tell you that CI can't, then wait. (This is deliberately open; when a good local-run case shows up, bring it back and we'll write the rule into this file.)
- **Never write anything.** No pushing, no committing, no editing the branch, no comments or reactions on GitHub. Reading and reporting only, until step 3's pending review.

### One lens per pass, on both sides

Mixed reviews fixate: the pass finds one interesting thread, follows it, and the rest slides past. So every pass gets exactly **one lens**, and the two sides run at the same time.

**The Claude side** — one `sonnet` subagent per lens, all five, dispatched together:

1. **Does it solve the problem?** The sharpest lens, and the one generic review skips. Walk the problem file's requirements one at a time against the diff, then the description's claims the same way. Partial implementations pass every other check — code that's _present_ looks fine, and nothing flags what's missing.
2. **Correctness.** Real bugs, with a concrete failure case. If you can't name inputs that produce the wrong result, you have a suspicion, not a finding.
3. **Security and data exposure.** Auth boundaries, user-scoped queries, secrets, anything user-supplied reaching a query or a filesystem path.
4. **Fit.** Does it match how this codebase already does things, or reinvent something that exists? Duplication and convention drift.
5. **Tests.** Not "are there tests" but "do these tests fail if the code is wrong?" A test that passes against a broken implementation is a finding.

**The Codex side** — three of those same lenses, each its own read-only run, launched in the same breath as the subagents so both sides work from the same branch without seeing each other:

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/codex-review.mjs" --lens correctness --base main --problem-file /tmp/pr-<n>-problem.md --ci-file /tmp/pr-<n>-ci.md
node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/codex-review.mjs" --lens security --base main --problem-file /tmp/pr-<n>-problem.md --ci-file /tmp/pr-<n>-ci.md
node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/codex-review.mjs" --lens problem --base main --problem-file /tmp/pr-<n>-problem.md --ci-file /tmp/pr-<n>-ci.md --claims-file /tmp/pr-<n>-body.md
```

Read-only is **structural**: the script calls the Codex companion's `task` with no `--write`, so the plugin forces a read-only sandbox — Codex cannot edit or even prompt to edit. That stops edits, not execution, so the "don't run the suite" rule lives in the script's prompt. The lens prompts, the definitions, and the return shape live in `codex-review.mjs`; keep them in step with this file. Allowlist that one command in settings and all three passes run on a single approval.

Codex doesn't get the other two lenses. Whether the change fits the codebase's conventions, and whether the tests would fail on a broken implementation, both lean on knowing the project — which is where an outside model pays least.

**Both sides return the same shape**, or the comparison can't happen: title; `file:line`, plus any other locations with the same problem; what's wrong in one sentence, in terms of what someone using the product would notice where possible; trigger (the input or steps that produce it); evidence (what was opened and what it showed); blocking (yes or no); edge case (yes or no); confidence 0–1. Then, separately, any intent questions that survived the question rule.

### Where the line is

Agents are meticulous. Ask one for feedback and most of what it finds will be edge cases. These definitions decide what reaches the human as what, and every pass applies them:

- **Blocking** — the PR doesn't solve the problem, breaks the main path for someone using the feature normally, loses or exposes data, or CI is failing. Nothing else is blocking, however good the point.
- **Edge case** — a failure that someone using the feature normally, the way the problem intends, wouldn't hit, _and_ that's visible and recoverable when they do: an error they can see and retry past. A silent or unrecoverable failure — lost data, wrong data shown with no error, a security hole — is never an edge case, however rare. It's a finding.
- **Finding** — everything else that survives judging.

Edge cases aren't dropped and aren't mixed into the findings. They go in their own batch, each with its trigger, so the human can skim them in one go, keep the few worth raising, and let the rest go. An edge case whose trigger nobody can name isn't verified; leave it out.

### Answer your own questions first

A question the code could answer wastes the human's time and the author's. Before a question reaches anyone, the pass that raised it — or you, when judging — tries to answer it from the code, the problem file, git history (`git log` and `git blame` on the lines in question), and CI. If the answer turns up, the question becomes a finding or goes away.

What survives is intent: what the author or the team meant, which no file records. Those go to the human first, since they may know. Only the ones they can't answer go to the author.

### Judge the delta

Neither dump goes to the human. Line the two sets up by file and claim, and spend the effort where they disagree:

- **Both sides raised it** — almost certainly real. Check it's genuinely the same finding and not two things that look alike, then keep it.
- **Only one side raised it** — this is where you open the code yourself. It's either something the other side's lens couldn't see or a confident model being wrong, and the only way to tell is to read it.
- **One side was confidently wrong** — that's evidence about the rest of that pass, not just that finding. Ask what it fixated on, and whether the lens is worth a second run with `--context` naming what it missed.
- **Neither side raised something you expected** — a file no lens covered, a check that never ran. Absence is a finding; say it.

Then check each survivor against "Where the line is" yourself — the passes' blocking and edge-case calls are claims too — and sort them: blocking findings, other findings, questions, edge cases. The judged list, not either side's output, is what gets reported.

### Skepticism rules

- Confidence in the PR body is not evidence. Neither is confidence in your own first pass.
- If a claim can be checked, check it. If it can't, say so and mark the finding uncertain.
- A finding that reveals the description was wrong about something is evidence about the _whole_ PR — go back and re-check the claims that rested on the same assumption.

### Report it

**Everything that needs the human arrives in one message, after the last pass finishes.** No question, no blocking finding, no partial list while passes are still running — it scrolls away under their output and gets buried. Wait for every pass, judge, then report.

Format for the terminal — this follows the Concise output style, and it is not optional:

- **Lead with the button you'd press**, and the one reason why. Request changes if any finding is blocking. Comment if any finding or question needs the author's reply before you'd approve. Otherwise Approve.
- **Then the items, numbered straight through** so the human can pick by number, in three groups:
  - **Findings** — blocking first, then the rest by weight. Each is the comment's human line as it would be posted, then where it lands: `2. [blocking] Signed-out users can open the billing page. (src/middleware/session.ts:42)`. One line, plain words. No mechanism, no code, no fix.
  - **Questions for you** — the intent questions that survived. The human answers them, or says "ask the author" and the question becomes a comment.
  - **Edge cases** — one line each with its trigger: `9. An upload over 10 MB shows a blank error; retrying a smaller file works. (src/upload.ts:88)`.
- **Then stop.** The human picks the numbers to post, answers what they can, and can ask to expand any item first.

Whether a comment gets posted at all is the human's call. They bring context the passes don't have — what this author needs to hear, what the team already settled, how much polish this PR is worth. So the report doesn't draw that line; it hands over everything and lets them draw it.

## Step 3 — Draft the review

Compose from the numbers the human picked, plus the questions they sent to the author. Nothing else goes in — not a dropped edge case, and not a dropped comment reworded into the body.

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
- **Counting the comments.** "Four comments below, none blocking." GitHub already shows the count, and the `[blocking]` marks already say which ones matter.

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

Every comment has two readers. A person skims it and decides; an agent may act on it. So the top is for the person, and what an implementer needs sits underneath, collapsed:

```markdown
[blocking] Signed-out users can open the billing page.

<details><summary>🤖 For agents</summary>

- Trigger: sign out, then visit `/account/billing` directly.
- Where: `src/middleware/session.ts:42` (also `src/pages/team.ts:18`).
- Expected: a signed-out visit to any `/account/*` page lands on the sign-in page before anything renders.

</details>
```

**The human line leads with what someone would notice, not with the code.** "Signed-out users can open the billing page," not "This runs before the auth check." It names no function, file, or variable — those go in the agent section — and it makes sense to someone who hasn't opened the diff. One sentence by default; a second only when a person can't act without it.

**Only blocking comments are marked.** `[blocking]` — square brackets, lowercase, no bold, no em dash after it, the sentence running straight on as if the tag were a word in it. Every other comment has no label; its absence tells the author it's their call to fix, defer, or leave. Write those as plain observations, not softened demands.

**One comment per problem.** When the same problem shows up in five places, anchor one comment where it first appears and list the rest under "Where."

**The agent section carries what the human line leaves out:** the trigger, every location, and the expected behavior. Include it whenever an implementer would otherwise have to guess — nearly always for a failure, often not for a question or a small observation. Keep the blank line after `<summary>` and before `</details>`, or GitHub won't render the markdown inside.

**Never prescribe the code change.** "Expected" describes behavior, not the edit. You don't know this codebase well enough to design in it, the author does, and a comment that only names the problem can't smuggle in a bad assumption. "Lands on the sign-in page before anything renders" — not "move the check above line 40."

**No bold anywhere in the comment.** Bold is the tell that something was rendered rather than typed. Backticks on identifiers are fine, in the agent section; those are how people write code in prose.

Questions the human sent to the author go out as real questions, in the same shape. Edge cases they picked go out as ordinary unmarked comments, trigger in the agent section. Plain words throughout, no ceremony, no "Consider refactoring this to leverage...".

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
    {
      "path": "src/middleware/session.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "[blocking] Signed-out users can open the billing page.\n\n<details><summary>🤖 For agents</summary>\n\n- Trigger: ...\n\n</details>"
    }
  ]
}
```

Notes that will bite otherwise:

- `line` must fall inside the diff. A comment that can't be anchored moves into the review body with a `file:line` pointer instead of being dropped.
- Do **not** include `event`. Adding `"event": "COMMENT"` submits it immediately, which is the one thing this skill must not do.
- The verdict stays **out** of the body. Recommend the button in the terminal when you hand back, and let the human press it.

Then hand back the Files-tab URL (`<pr-url>/files`), a one-line count of what's in the draft, and which button you'd press — by the same rule as step 2's report. Stop.

## Guardrails

- **Never submit the review.** Pending only. Submitting is the human's action.
- **Never route a review pass through anything that can write.** Both sides read; only step 3 produces output, and only as a pending review.
- **Never push, commit, merge, close, or edit the PR branch.** Checking it out is fine; changing it is not.
- **Read the local tree freely. Ask before executing anything**, and never run anything that writes outside this machine.
- **Never review against the PR description as the problem.** No linked source means asking the human.
- **Never report a finding you didn't verify** — mark it uncertain or leave it out.
- **Never prescribe the code change in a comment.**

## Related skills

- `open-pr` — the other side: opening a PR for someone else to review.
- `human-readable` — the voice for the GitHub-facing comments.
- `dumb-it-down` — the plainness bar for the orientation report.
- `autopilot` — QAs agent-built work before the PR exists; self mode here is the second look once your PR is open. Its `codex-audit.mjs` is the sibling of this skill's `codex-review.mjs`, with lenses for auditing work you just built rather than reviewing someone else's.
- `research` — the fan-out pattern the lens passes borrow.
