---
name: comment-audit
description: Audit and prune code comments in a package, directory, or pending diff — find superfluous narration, ticket-reference comments, and story/history comments, report them with verdicts, then apply the prune on approval. Invoke with `/comment-audit` when the user asks for a comment audit, comment cleanup, comment prune, "de-slop the comments", or mentions comments reading as bot smell. Also runs as `autopilot`'s third audit lens on an unattended branch. NOT a correctness review — it only removes and tightens comments, never code.
---

# Comment Audit

Audit comments against one standard: **a comment states a constraint the code can't show, in 1–2 lines.** Everything else is a candidate for deletion. Stories, incident history, and justifications belong in commit messages; explanations of the change belong in the PR body. The test for every comment: would a stranger reading it cold, with no session context, understand it in one pass and need it?

Verbose comments survive correctness review because nobody adversarially reviews prose — that's why this audit exists as a separate pass.

## Workflow: report first, edit second

1. **Scope.** Default to the files changed in the pending diff (`git diff <base>... --name-only`). If the user names a package or directory, audit all of it. State the scope before starting.
2. **Read every in-scope file fully.** A comment's worth depends on the code around it — grep for `//`/`#` alone can find comments but cannot judge them. For large test files, reading the comment lines with surrounding context is acceptable.
3. **Classify** each comment using the taxonomy below.
4. **Report before touching anything.** Group findings by category with clickable `file:line` references and a per-item verdict (drop / trim to N lines / consolidate / rephrase). Include an explicit **keep list** naming the load-bearing comments you will NOT touch, so a later pass doesn't sweep them. Then stop and wait — do not edit until the user approves, unless they asked for audit-and-fix in one breath.
5. **Apply approved changes only.** When trimming, preserve the constraint and delete the narrative around it.
6. **Verify.** Run the package's test suite (comment edits still break things: a stray edit can touch code, and some tests assert on comment text or section headers). Then show the full diff with `--stat`.

## Taxonomy

### Drop or trim (the four failure modes)

**Ticket / doc / person references** — `AX-123`, `(JIRA-456)`, `RFC step 10`, `Sean's 8/13 fix`, PR numbers. Unresolvable or meaningless to a cold reader. Drop the reference; keep the explanatory prose around it, which usually stands alone. When the reference encodes something real (a version boundary, a named mechanism), rephrase into durable terms: "since Sean's 8/13 fix" → "since axis 1.17"; "closed by AX-121" → "closed by the skill clamp".

**Story / history comments** — "used to fail", "before the fix", "decided 2026-08-03", calibration methodology, incident replays with run IDs, self-dialogue ("do X? No — do Y"). These narrate how the code got here. Extract the one-line constraint they motivate and cut the rest; the story goes in the commit message for this prune if it isn't already in history.

**Implementation narration** — comments that restate what the adjacent code visibly does ("pass variants through", "What it does: writes each file, then runs the command..."), or that justify the change to a reviewer ("this is correct because..."). Delete outright — no replacement needed.

**Over-long blocks** — real content at 3–10× the length it needs, often two overlapping blocks making the same argument twice. Consolidate into one block; keep any coupling warnings (e.g., "this pin and that list must be bumped together") closest to verbatim, since those are the highest-value lines.

### Keep (name these in the report so they're protected)

- Constraints the code cannot show: external contracts, protocol/env-var docs at a file boundary, ordering requirements, platform quirks ("macOS is case-insensitive, so...").
- "Do not simplify this back" warnings guarding a non-obvious fix — these exist precisely because the code looks improvable.
- Invariants and trust boundaries (what input is validated where, what may never be model/user-controlled).
- Version-coupling warnings between a pin and the code verified against it.
- In tests: intent comments ("a single withheld cell must retry, not trip the breaker") and fixture provenance ("real payload from run X") — these justify odd-looking data and are cheap to keep. Lean conservative in test files generally.

## Judgment calls

- When a comment mixes a keeper constraint with story, the trim keeps the constraint's exact claim — don't weaken "must" language while shortening.
- A dated decision log ("decided <date>: X because Y") usually trims to just the standing rule plus its override mechanism.
- If unsure whether a reference is "truly obscure" enough to warrant keeping, flag it in the report with a recommendation rather than deciding silently.
- Don't invent new comments during the prune, and don't reword keepers for style — this pass only removes and tightens.

## Report format

```
## 1. Ticket/reference comments
| Location | Reference | Verdict |
## 2. Story/history comments
- file:line — quoted fragment → what survives (one line)
## 3. Over-long blocks to consolidate
## 4. Explicitly keep (protected)
Summary: N to drop, M to trim, K to consolidate; files X, Y untouched.
```

End the report with the proposed next step (apply sections 1–3, leave category Z alone) so approval is a one-word reply.

## Project overrides

The taxonomy above is a house style, not a law. A project whose tracker _is_ the record of why — where `AX-123` resolves to something a reader can actually open — says so in its own `CLAUDE.md`, and this skill follows that instead of stripping the references. Read the project's conventions before scoping.

## Related skills

- `autopilot` — runs this taxonomy as a read-only Codex lens (`--lens comments`) during an unattended run, then loops the findings back to the developer subagent. The audit and the fix stay separate there; here they're the same conversation.
- `open-pr` — deliberately does _not_ run this. A comment prune is a report-and-approve pass, and the handoff is the wrong moment for one.
