---
name: autopilot-iterate
description: The follow-up loop after Sean reviews an autopilot draft PR — his review comments become the next control signal. Invoke with `/autopilot-iterate` (optionally the PR number) from the project repo when Sean has reviewed a PR that autopilot opened and left comments — or has feedback to give now — and wants the run to pick the work back up without re-explaining anything in a fresh conversation. Deterministically loads the PR's diff, comments, and review threads plus the spec; triages the feedback into a judged action list; dispatches a Claude developer subagent to fix; re-audits the delta with read-only Codex; re-runs the completeness gate; pushes to the same branch; and replies on the PR with a comment-by-comment account. Same unbending rules as `autopilot`: the orchestrator never writes code or audits, the auditor never edits, and nothing merges or deploys. NOT for the first pass of a piece of work (that's `preflight` → `autopilot`), and NOT for reviewing PRs autopilot didn't produce.
---

# Autopilot-iterate — review comments are the control signal

Autopilot ended by opening a draft PR; Sean reviewed it and left comments. Those comments are the most valuable input the system gets — a human looked at the real output and said what's wrong. Consume them the way autopilot consumes a spec: deterministically loaded, judged, acted on, and accounted for — without Sean having to restate any of it.

## The same rules apply (unchanged from autopilot)

1. The orchestrator judges — it never writes code and never audits. A developer subagent fixes; Codex audits.
2. The auditor is read-only, always.
3. Never ship. Push to the PR's existing branch — the PR updates in place. Never merge, never deploy.
4. Never accept "done" on self-report — run the checks.

## Step 1 — Load the run's context, deterministically

Work from the project repo, on the PR's branch (check it out if needed). Gather, in order:

- **The PR** — `gh pr view <number> --json title,body,comments,reviews,headRefName` (`gh pr view` alone finds the current branch's PR if no number was given). Line-level review threads live one call deeper: `gh api repos/{owner}/{repo}/pulls/<number>/comments`.
- **The spec** — `docs/autopilot/…`, linked from the PR body. Re-read it in full; it is still the contract.
- **The run report** — `docs/autopilot/…-report.md`, if present. It names what the last run deferred or couldn't self-verify; some of Sean's comments will be about exactly those.
- **The diff** — `gh pr diff <number>`, so each piece of feedback maps to actual hunks.

If Sean gives feedback in the conversation instead of (or on top of) PR comments, fold it in as if it were a comment — but the PR threads are the durable record, so prefer them when both exist.

## Step 2 — Triage the feedback into a judged action list

Same muscle as autopilot's triage phase, with one inversion: these findings come from the human, so the default is _act on them_, not verify them away. Each comment still gets an explicit disposition:

- **Fix** — in scope and actionable: onto the action list, with the file/line context attached.
- **Spec was wrong** — the comment contradicts the spec. The human outranks the spec: update the spec file to match reality _first_, then fix. A stale spec poisons the completeness gate you'll run in Step 3.
- **Out of scope** — real, but bigger than this PR. Don't silently drop it: name it in the PR reply, and say so if it deserves its own issue.
- **A question, not a change** — answer it in the PR reply; nothing gets dispatched.

If a comment has two readings, take the one consistent with the spec's intent and _say which reading you took_ in the PR reply — Sean isn't here to disambiguate mid-run, and a named assumption is cheap to correct on the next pass.

## Step 3 — Fix, audit, measure: the short loop

- Dispatch a **developer subagent** (fresh context) with the action list, the spec, and the relevant diff hunks. It commits at clean points and does not push.
- **Re-run the checks the fixes could have disturbed** (rule 4) — review fixes are exactly where regressions sneak in.
- **Re-audit the delta** with autopilot's wrapper, one lens per pass, diff-focused:

  ```sh
  node "${CLAUDE_PLUGIN_ROOT}/skills/autopilot/scripts/codex-audit.mjs" --lens simplicity --base main --context "changes address PR review feedback: <summary>"
  ```

  Use the lenses the spec named. Triage findings exactly as autopilot does; real ones go back to the developer.

- **Re-run the completeness gate**: the spec's done-signal still has to pass in full, plus any new checks the feedback implied.
- Loop bound: the spec's (default 3 rounds). A bounded stop with an honest note beats endless polishing — same as the main run.

## Step 4 — Push and reply

- Push to the PR's existing branch. The PR updates in place and the deploy preview rebuilds for Sean's next smoke test.
- Leave **one summary comment** on the PR mapping every piece of feedback to what happened: fixed (with the commit), spec updated, deferred (and why), or answered. This is what makes the next review pass cheap — Sean reads one comment, not the whole diff again.
- If a run report exists in `docs/autopilot/`, append an iteration section to it (round, findings, what changed).
- Then stop. The PR stays a draft until Sean says otherwise; merging and deploying stay human calls.

## Permissions

Same posture as `autopilot`: unattended runs live in bypass-permissions mode on the strength of the same guardrails (branch-only, draft PR, human reviews before ship); attended runs get by with the allowlisted audit command, with `gh` prompting as usual.

## Related skills

- `autopilot` — the run that produced the PR this picks back up; its four rules and audit mechanics apply verbatim.
- `preflight` — where the spec came from; iterate updates the spec when review shows it was wrong.
- `open-pr` — the tone the summary comment should match: concise, human-first, written for a reviewer moving fast.
