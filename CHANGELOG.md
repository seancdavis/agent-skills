# Changelog

All notable changes to this plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While pre-1.0, `minor` (`0.X.0`) covers new skills, features, and breaking changes;
`patch` (`0.0.X`) covers fixes and docs.

## [0.2.0] - 2026-06-29

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
