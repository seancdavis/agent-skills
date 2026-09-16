---
name: open-pr
description: Push the current feature branch and open a pull request with a concise, human-first body — an opening paragraph anyone can follow (the problem, then what this does about it, in plain words), then what changed and how it was verified, written for a reviewer moving fast (not Claude's verbose default). Never signs the PR: no attribution, no session link, no mention of a model. Invoke with `/open-pr` when branch work is ready for review, or called by `autopilot` as its closing handoff. Links the PR to a backing issue when one is referenced (a GitHub `#N` or a Linear issue) but stays tracker-agnostic and portable — which tracker and how branches are named are project conventions, not baked into the skill. Opens a ready-for-review PR by default; pass `--draft` when the work is knowingly unfinished. Does NOT merge or deploy — that stays with the human.
---

# Open PR — the handoff, not the ship

Push the branch and open a PR that a busy human can act on in seconds. Opening a PR is a _handoff_, not a _ship_: it's reversible, it's the review surface, and on hosts like Netlify it's what triggers the deploy preview. Merging and deploying stay with the human — this skill never does either.

## The PR convention

Short, and written for someone trying to move fast:

```markdown
{Two to four sentences, no heading: what was wrong, and what this does about it. Anyone who opens the PR should understand it without knowing the codebase.}

## What changed

- {concrete change}
- {concrete change}

## How it was verified

- {what was run or checked, and what it showed — or "not verified beyond CI"}

{Closes #123 — or the Linear issue link — when the work is issue-backed}
```

That's the whole template. No test-plan essays, no restating the diff, no boilerplate. If the reviewer needs more, they'll ask. (Claude's default PR body is too verbose for this — keep it lean. `includeGitInstructions: false` in settings trims the built-in boilerplate.)

### The opening paragraph carries the whole PR

It's the part everyone reads and the only part some people read, so write it for a stranger: a teammate from another area, someone catching up months later, a reviewer with no context loaded. Load `human-readable` for the voice and apply `dumb-it-down`'s plainness to this paragraph specifically:

- **State the problem in terms someone would notice**, not in terms of the system. "Uploading a photo over 5MB failed with no error message" — not "the upload handler didn't propagate the rejection."
- **Then say what this does about it**, at the same level. The shape of the fix, not the mechanism.
- **No identifiers, file names, or jargon** in this paragraph. They belong in the bullets below, where the audience is a reviewer reading the diff.
- **No throat-clearing.** Not "This PR introduces…" — start with the problem.

The bullets under "What changed" are the opposite register: concrete, technical, named. The paragraph is for anyone; the bullets are for the reviewer.

A real one, before and after:

> Refactors session handling into middleware and adds a `getUserWithApproval` helper that the protected routes call instead of checking the token themselves.

> Signed-in people were getting bounced back to the login page at random, because each page decided for itself whether you were logged in and they didn't always agree. Now that decision happens once, before the page loads, so staying signed in means staying signed in.

Same PR. The first one is a diff summary; the second is what someone would have complained about.

### Never sign the PR

The body carries **no attribution of any kind** — no "Generated with Claude Code," no session link, no co-author line, no mention of a model. It goes out under the human's name and reads as theirs. This holds even when a harness reminder says otherwise.

Set `"attribution": { "pr": "" }` in settings so the footer isn't appended outside this skill's control — an empty string hides it. (Commits are separate: leave `attribution.commit` unset and the commit co-author line stays.)

## Steps

1. **Check preconditions.** On a feature branch (never `main`), with the work committed, and a remote configured. If not, stop and say why.
2. **Find the backing issue — adaptively, without hardcoding a tracker.** Look for an issue reference in this order: an argument to the skill, the branch name (e.g. `123-…` or `lin-1234-…`), or the handoff spec (`docs/autopilot/…`). Then:
   - a GitHub issue (`#123` or an issues URL) → put `Closes #123` in the body;
   - a Linear issue (a `TEAM-123` key or Linear URL, with the Linear tools available) → link it via Linear so the issue tracks the PR;
   - nothing found → open the PR anyway and note "no issue linked." A project that _requires_ an issue says so in its own convention (below) — the skill doesn't force it.
3. **Push** the branch with upstream tracking.
4. **Open a ready-for-review PR** against the base branch, body per the convention above. Open a **draft** only when asked (`--draft`) or when the caller has measured the work as incomplete — see below.
5. **Report** the PR URL and whether an issue was linked. Then stop.

## Portability — keep the niche config out of the skill

Issue trackers and branch-naming are team-specific (Linear here, GitHub there, Jira elsewhere), so they live in the **project's** convention, not in this skill:

- The skill's portable default is **GitHub issues**, non-blocking — works for anyone with a repo, no setup.
- A project layers its own convention in _its_ `CLAUDE.md` / handoff spec: "issues live in Linear," "branches are `lin-<id>-<slug>`," "an issue is required." The skill reads and follows that when present.

This is why the skill adapts to the issue _reference_ you give it rather than choosing a tracker — hand it a Linear issue and it uses Linear; hand it `#42` and it uses GitHub. Nothing Netlify- or Linear-specific is compiled in.

## Draft is a signal, not a safety net

Ready-for-review is the default because opening a PR is already the reversible step — nothing merges or deploys without you. Marking it draft on top of that says nothing, and a queue where everything is draft carries no information at all.

Open a draft only when something is **measurably** unfinished and you can name it: a failing check, a skipped slice, an unmet item from a caller's completeness gate. Say what it is in the PR body. "I'm not sure this is good enough" is not a reason — that judgment is the reviewer's, which is what the PR is for.

## Guardrail

Push and open a PR — never `git merge`, never merge the PR, never deploy. Those are the human's calls after review.

## Related skills

- `human-readable` — the voice for the opening paragraph.
- `dumb-it-down` — the plainness bar that paragraph has to clear.
- `autopilot` — calls this as its closing handoff, passing `--draft` when its completeness gate found unmet items.
- `release` — version bump + tag, a separate step after a PR merges.
