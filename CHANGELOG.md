# Changelog

All notable changes to this plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While pre-1.0, `minor` (`0.X.0`) covers new skills, features, and breaking changes;
`patch` (`0.0.X`) covers fixes and docs.

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
