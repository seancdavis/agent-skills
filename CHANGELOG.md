# Changelog

All notable changes to this plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While pre-1.0, `minor` (`0.X.0`) covers new skills, features, and breaking changes;
`patch` (`0.0.X`) covers fixes and docs.

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
