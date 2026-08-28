# Changelog

All notable changes to this plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While pre-1.0, `minor` (`0.X.0`) covers new skills, features, and breaking changes;
`patch` (`0.0.X`) covers fixes and docs.

## [0.6.4] - 2026-08-28

### Changed

- `/release` now pushes and cuts the GitHub release on its own instead of stopping to confirm — the skill is user-invocable only, so invoking it is the authorization. Pass `--no-publish` to stop at the local commit and tag.
- The guardrails are unchanged: releasing off `main`, a dirty tree, or manifest drift still stop and ask, since those are questions about what gets released rather than whether to ship it.

## [0.6.3] - 2026-08-28

### Added

- `autopilot` gains a third audit lens, `spec`, which walks the settled spec requirement by requirement and reports what is missing or half-built. It requires `--spec <path>` and errors without one, so it can never quietly degrade into a generic review.

### Changed

- The `simplicity` lens now owns comments too, flagging narration, dated stories, and ticket references a future reader can't resolve — while naming the comments it must protect, like constraints the code can't show and "do not simplify this back" warnings.
- `autopilot`'s Phase 5 spells out the division of labor between the spec lens and the completeness gate: the lens reads the code and reports what it judges missing, the gate runs the done-signal and measures. Both feed triage, and neither substitutes for the other.
- `autopilot-iterate` re-audits with the same three lenses, run selectively against whatever the review feedback actually touched rather than all three by reflex.

## [0.6.2] - 2026-08-26

### Changed

- `review-pr` treats the review body as the leftovers rather than a summary — it carries only what has no line to attach to, so findings aren't read twice.
- Every body sentence now faces one test: could this have been an inline comment? If yes it goes inline and never appears up top. Most bodies should be a single line.
- Loading the author's voice profile moves to the first thing step 3 does, aimed at the terse end of that voice — a review comment reads closer to chat than to a blog post.
- The skill carries a worked before-and-after of a real review body, since the rules alone weren't holding the register.
- The recommended-verdict line is gone for good, along with any lean or comment tally. The verdict is the button the human presses.

## [0.6.1] - 2026-08-25

### Changed

- `review-pr` gives the review body its own contract — two to four sentences in the reviewer's own voice, saying what you concluded and what the author does next. It previously had none, so the body fell back to Claude's default register while the inline comments held their shape.
- The body contract names what kept leaking in: process narration, the verification trail meant for the human triaging, labeled sections, a written-out verdict, and a count of the comments.
- The verdict moves out of the review body entirely — the skill recommends a button in the terminal and lets the human press it.
- `human-readable` is now a required load before writing the review, not a suggestion at the end of the comment section.
- `release` pins the GitHub release-notes format: bullets go out unwrapped and one sentence each, via `--notes-file`. The release page re-wraps on top of Prettier's 80 columns, which shreds a pasted changelog section.

## [0.6.0] - 2026-08-25

### Added

- `/review-pr` skill — adversarial review of a pull request you didn't write, built for a reviewer who hasn't read the code and an author who was probably an agent.
- Runs in three gated steps — orient, review, draft — stopping between each so the human triages before anything reaches GitHub.
- Reads the branch locally after checkout and treats CI output as the evidence, instead of pulling files over the network or re-running the suite.
- Ends by leaving a _pending_ GitHub review whose inline comments name the problem without prescribing the fix; it never submits, pushes, or merges.

### Changed

- `README.md` and `CLAUDE.md` gain a Code Review section covering `open-pr` and `review-pr`.

## [0.5.0] - 2026-08-22

### Added

- `output-styles/` — the **Concise** output style, with an idempotent
  installer and a README. Leads with the answer, teaches in passing, then
  stops. Carries a worked exemplar of the target register, formatting rules
  (bold-lead paragraphs of two or three sentences), and a code section
  requiring every identifier to be glossed inline the first time it appears.
- `hooks/concise-reminder.sh` — a `UserPromptSubmit` hook that re-injects a few
  of the style's rules at the recency end of context, plus an installer. Left
  uninstalled by default: it is the fallback for when Claude Code's built-in
  reminder of the active style stops holding.

### Changed

- `open-pr` opens a **ready-for-review** PR by default; `--draft` becomes the
  opt-in. The old default lived in the skill's _description_, which loads into
  every session whether or not the skill is invoked — so it was quietly
  drafting PRs in sessions that never called it. Draft is now reserved for work
  that is measurably unfinished and nameable.
- `autopilot` Phase 6 inverts to match: pass nothing to `open-pr` when the
  completeness gate is clean, hand `--draft` when the run bounded out.

## [0.4.0] - 2026-07-28

### Added

- `/autopilot-iterate` skill — picks an autopilot PR back up after Sean's
  review, treating his comments as the next control signal: triage the
  feedback, fix, re-audit, and reply on the PR comment by comment.

### Changed

- Preflight and autopilot now follow an explicit control-loop structure,
  and the PR's draft/ready state is derived from the completeness gate.

## [0.3.0] - 2026-07-23

### Added

- `/human-readable` skill — writing mode for public-facing prose; loads a
  personal voice profile and applies anti-AI-tell rules where the profile
  is silent.
- `/update-voice` skill — builds or refreshes the voice profile from the
  author's actual published writing (project- or user-level file).
- `/preflight` and `autopilot` skills — interactive setup, then an unattended
  build-and-audit run (Claude developer subagent + read-only Codex auditor)
  that ends by opening a draft PR.
- `/open-pr` skill — push the branch and open a concise, human-first draft PR;
  also autopilot's closing handoff.
- `/research` skill — broad, token-heavy investigation delegated to cheaper
  focused models, synthesized by the orchestrator.
- `/roster` skill — after-the-fact table of which model each subagent ran on,
  with token and tool-call volume.

### Changed

- Autopilot's Codex audit runs as a single allowlistable command, and its
  unattended permission posture is documented.
- Preflight now ensures a backing issue and branch before handoff, and
  hardens specs against under-scoped deletions and renames.

### Fixed

- `.claude/settings.local.json` is no longer tracked.

## [0.2.0] - 2026-06-30

Baseline release. Resets versioning to the `0.x` line and reconciles the
version across both manifests (previously `plugin.json` and `marketplace.json`
disagreed). Going forward, use the `/release` skill to cut versions.

### Added

- `/release` skill — bumps the version in both manifests, updates this
  changelog, commits, and tags in one consistent step.
- `/clip` skill — copy conversation output to the system clipboard as raw Markdown.

### Changed

- Repository URLs updated from `seancdavis/claude-skills` to
  `seancdavis/agent-skills` in both manifests.

### Fixed

- `/clip` (formerly `/copy`) treats the text after the command as a description
  of _what_ to copy, rather than misreading a bare argument as a message count.
  Renamed from `/copy` to avoid collision with the built-in `/copy` command.
