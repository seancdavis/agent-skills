---
name: open-pr
description: Push the current feature branch and open a pull request with a concise, human-first body — a quick summary plus a bulleted list of what changed, written for a reviewer moving fast (not Claude's verbose default). Invoke with `/open-pr` when branch work is ready for review, or called by `autopilot` as its closing handoff. Links the PR to a backing issue when one is referenced (a GitHub `#N` or a Linear issue) but stays tracker-agnostic and portable — which tracker and how branches are named are project conventions, not baked into the skill. Opens a draft PR by default (for review, not to merge). Does NOT merge or deploy — that stays with the human.
---

# Open PR — the handoff, not the ship

Push the branch and open a PR that a busy human can act on in seconds. Opening a PR is a *handoff*, not a *ship*: it's reversible, it's the review surface, and on hosts like Netlify it's what triggers the deploy preview. Merging and deploying stay with the human — this skill never does either.

## The PR convention

Short, and written for someone trying to move fast:

```markdown
## Summary

{One or two sentences: what this does and why. No preamble.}

## What changed

- {concrete change}
- {concrete change}

{Closes #123  — or the Linear issue link — when the work is issue-backed}
```

That's the whole template. No test-plan essays, no restating the diff, no boilerplate. If the reviewer needs more, they'll ask. (Claude's default PR body is too verbose for this — keep it lean. `attribution.pr` and `includeGitInstructions: false` in settings also trim the built-in footer/boilerplate.)

## Steps

1. **Check preconditions.** On a feature branch (never `main`), with the work committed, and a remote configured. If not, stop and say why.
2. **Find the backing issue — adaptively, without hardcoding a tracker.** Look for an issue reference in this order: an argument to the skill, the branch name (e.g. `123-…` or `lin-1234-…`), or the handoff spec (`docs/autopilot/…`). Then:
   - a GitHub issue (`#123` or an issues URL) → put `Closes #123` in the body;
   - a Linear issue (a `TEAM-123` key or Linear URL, with the Linear tools available) → link it via Linear so the issue tracks the PR;
   - nothing found → open the PR anyway and note "no issue linked." A project that *requires* an issue says so in its own convention (below) — the skill doesn't force it.
3. **Push** the branch with upstream tracking.
4. **Open a draft PR** against the base branch, body per the convention above. Use a normal (non-draft) PR only when asked (`--ready`) — draft is the default because this is "for your review," and deploy previews still build on drafts.
5. **Report** the PR URL and whether an issue was linked. Then stop.

## Portability — keep the niche config out of the skill

Issue trackers and branch-naming are team-specific (Linear here, GitHub there, Jira elsewhere), so they live in the **project's** convention, not in this skill:

- The skill's portable default is **GitHub issues**, non-blocking — works for anyone with a repo, no setup.
- A project layers its own convention in *its* `CLAUDE.md` / handoff spec: "issues live in Linear," "branches are `lin-<id>-<slug>`," "an issue is required." The skill reads and follows that when present.

This is why the skill adapts to the issue *reference* you give it rather than choosing a tracker — hand it a Linear issue and it uses Linear; hand it `#42` and it uses GitHub. Nothing Netlify- or Linear-specific is compiled in.

## Guardrail

Push and open a PR — never `git merge`, never merge the PR, never deploy. Those are the human's calls after review.

## Related skills

- `autopilot` — calls this as its closing handoff (draft PR → deploy preview → your review).
- `release` — version bump + tag, a separate step after a PR merges.
