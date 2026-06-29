---
name: release
description: Cut a new version of this plugin. Invoke when the user types `/release` or says "bump the version", "cut a release", "tag a new version", "ship a release", or "publish a new version" of the seancdavis-skills plugin. Bumps the version in both manifests, updates the changelog, commits, and tags in one consistent step so the version numbers never drift apart. NOT for application releases in other repos.
disable-model-invocation: true
---

# Release

Cut a new version of this plugin in one step — bump the version in both manifests, update the changelog, commit, and tag — so `plugin.json`, `marketplace.json`, the git tag, and `CHANGELOG.md` never drift apart (the failure mode this skill exists to prevent).

## Versioning model

- **Single source of truth:** the `version` in `.claude-plugin/plugin.json`.
- `.claude-plugin/marketplace.json` → the plugin entry's `version` must always equal it.
- **Pre-1.0 (0.x) semver:** `minor` (`0.X.0`) = new skills, features, or breaking changes; `patch` (`0.0.X`) = fixes and docs. There is **no `major`** until we deliberately go 1.0.
- Every release gets a git tag `vX.Y.Z` and a `CHANGELOG.md` entry.

## 1. Determine the new version

Read the current version from `plugin.json`, then resolve the target:

- Arg `patch` / `minor` / `major` → bump that component (reset lower components to 0).
- Explicit `X.Y.Z` or `vX.Y.Z` → use exactly that.
- **No arg** → list the commits since the last tag (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`), propose `patch` vs `minor` (any `feat` → minor, otherwise patch), and confirm before proceeding.

Sanity-check the target is greater than the current version unless the user explicitly asked to go backward.

## 2. Make the release (local)

1. Set `version` in `.claude-plugin/plugin.json`.
2. Set the matching plugin entry's `version` in `.claude-plugin/marketplace.json` to the same value.
3. Update `CHANGELOG.md`: prepend a `## [X.Y.Z] - YYYY-MM-DD` section. Get the date from `date +%F` (do not guess it). Summarize changes since the last tag (`git log <lasttag>..HEAD --oneline`), grouped under **Added / Changed / Fixed**. Keep entries human, not raw commit subjects.
4. Commit — stage only the two manifests and the changelog: `chore(release): vX.Y.Z`.
5. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`.

## 3. Publish (ask first)

After the local commit + tag, **ask before touching the remote** — unless the user already said "push" / "publish" or passed `--publish`. On confirmation:

- `git push origin HEAD` then `git push origin vX.Y.Z`.
- `gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag` (or pass the changelog section as `--notes`).

## Guardrails

- **Release from `main`.** On another branch, say so and confirm before continuing — fine for testing, but never silently tag a feature branch as a release.
- **Clean tree.** If there are unrelated uncommitted changes, stop and ask the user to commit or stash first, so the release commit contains only version + changelog.
- **Pre-existing drift.** If `marketplace.json` and `plugin.json` already disagree when you start, point it out, then reconcile both to the new version.
- **Be brief.** End with one line: the new version, the files touched, whether a tag was made, and whether it was pushed.
