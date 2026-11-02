# 2026-10-31 — Closing the PR loop

## Topic

PRs from autopilot were getting lost, because it was easy to move on once one was open and reviewing is a lot of work. This session settled how a session stays with its PRs until they merge, and how visual QA fits in before Sean's review.

## Outcome

- One session held one or more PRs and stayed open until all were merged or closed. A shared watcher across sessions was left out, because Sean wanted to feel the workflow before reorganizing selfctl around it.
- A script polled GitHub only and woke the session on a change, so waiting cost no tokens. Slack was left out because reading it would need the model on a timer.
- PRs stayed draft until Sean's gut-check. Before it, the session judged and fixed CI and CodeRabbit problems, recorded the demo last, and turned anyone else's comment into a question. After it, every event went to Sean through `AskUserQuestion`, because selfctl only flags a session as waiting on that dialog while background work is running. Answering "no reviewers" ran `review-pr`'s self mode in the same session.
- Sean pressed every merge button or enabled auto-merge himself; the session only reported that a PR was ready. A branch behind main was updated only after approval, to keep the gap between review and merge short. Conflicts were resolved right away before approval, and went to Sean first after it, because they mean another review.
- Visual QA used an isolated browser signed in as a dedicated test user who can only reach test accounts and sites. The password lived in a dedicated 1Password vault reached by a service account, with the token in macOS Keychain and a login script that only fills the form on listed domains. Production was the before and the deploy preview was the after. Demos stayed local and Sean dragged the ones he wanted into the PR. Projects without a web preview skipped this and said so.

## Still open

- Whether scripted email-and-password sign-in works on Netlify app deploy previews. Sean chose to try it first.
- Whether CodeRabbit skips draft PRs by default, and whether `@coderabbitai review` triggers it on one.
- Whether `gh pr update-branch` dismisses an existing approval on Netlify repos.
- A test GitHub account for the test user, which isn't wired up yet.

## Next steps

- Build `pr-watch` with autopilot from `docs/autopilot/2026-10-31-pr-watch.md`.
- Run `preflight` for `visual-qa` after `pr-watch` has been used on real PRs.
