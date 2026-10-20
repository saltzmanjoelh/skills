# Delete the old review skills and agents that the pilot mod replaced

Written 2026-10-10.

## Goal

The pilot mod's agents (`mods/pilot/agents`) replace the old standalone review
tools, but the old ones are still installed and still appear as skills and
agent types in every session. After this change they are gone from the
repository and from `~/.claude`, nothing live names them, and the two hygiene
searches that the change making the remaining skills generic (see
`generic-skills.md`) had to run with these folders excluded print nothing
with no exclusion at all.

## Users and trigger

Every Claude Code session on this Mac loads skills and agents through the
links under `~/.claude`, which point into the main checkout of this
repository. A session today is offered `/lens-review`, `/edge-hunt`,
`/debug-panel` and the agents `skeptic`, `security-lens`, `maintainer-lens`,
`perf-lens`, `data-lens` and `repro-hunter`, beside the pilot mod's agents
that do the same jobs. A person reading the README is told the same old list.

## Behavior

**Deleted from the repository.** `skills/lens-review/`, `skills/edge-hunt/`,
`skills/debug-panel/`, and every file in `agents/`: `data-lens.md`,
`maintainer-lens.md`, `perf-lens.md`, `repro-hunter.md`, `security-lens.md`
and `skeptic.md`. The `agents/` folder then no longer exists in git.

**`skills/pr-comments/SKILL.md`.** Step 3 tells the session to spawn
`skeptic` subagents to try to refute a comment. It names `pilot:claim-checker`
instead, which takes a numbered list of claims and tries to refute each one
with evidence from the code. The issue also asks that `repro-hunter` become
`pilot:bug-reproducer`, but the skill does not name `repro-hunter` anywhere,
so there is nothing to change for it.

**`skills/plan-tournament/SKILL.md`.** Step 5 ("Deliver") ends by offering
"implement → /verify-loop → /lens-review". It offers instead, in a plain
sentence without arrows, to build the plan and then run `/verify-loop`. The
review step is dropped, because `/implement` already reviews the pull request
with the pilot mod's reviewers, and those reviewers cannot be run on their own
after a plan.

**`README.md`.** The opening sentence no longer says that
`~/.claude/agents/<name>.md` are links into this repository. The skills list
drops `lens-review`, `debug-panel` and `edge-hunt`. The "Agents:" line is
replaced by one sentence saying that the review agents live in the pilot mod,
in `mods/pilot/agents`.

**`CLAUDE.md`.** The sentence listing the paths no gate reads drops `agents/`,
because that folder will not exist. The other mentions of agents (the opening
line and the two hard rules) stay, because the pilot mod's agents are agents
in this repository and the rules still apply to them. The lines that govern
merging (`Base branch:`, `Checks:` and `Merge command:`) are not touched.

**The pilot pane's symbol for an unknown model.** `modelLabel` in
`mods/pilot/hooks/progress.ts` returns an em dash when it has no model to
name. It returns a plain hyphen (`-`) instead. The tests that expect the
symbol (`mods/pilot/tests/progress.test.ts`, `pane.test.ts` and
`register.test.ts`) and the sentence in `mods/pilot/README.md` that names it
change to match. The hyphen is written as the character itself, never as an
escape that would keep the em dash on screen while hiding it from the search.

**The links under `~/.claude`.** These are outside the repository and are
removed only after the pull request merges, in `/implement`'s Merged step,
right after the main checkout has been fast-forwarded. The nine links are
`~/.claude/skills/lens-review`, `edge-hunt` and `debug-panel`, and
`~/.claude/agents/data-lens.md`, `maintainer-lens.md`, `perf-lens.md`,
`repro-hunter.md`, `security-lens.md` and `skeptic.md`. Each one is removed
by its exact name with `rm` (never `rm -r`), and only when all of these hold:
the update of the linked checkout reported it updated, `readlink` shows the
link points at the deleted path in the main checkout, and `test -e` on the
link fails, meaning its target is really gone. This is a one-time action of
this session; no skill gains a general rule for it.

## Edge cases

- **The fast-forward of the main checkout does not happen** (the checkout is
  on another branch, has changes to tracked files, or the fast-forward is
  refused). The old files still exist there and the links still work, so
  none is removed. The final report names the nine links as still to be
  removed, and why.
- **A link has been repointed or replaced by a real folder** since this spec
  was written. Its `readlink` no longer shows the deleted path, or it is not
  a link, so it is left alone and named in the report.
- **`~/.claude/agents` is empty afterwards.** That is expected. The folder
  itself is left in place, and the Merged step of later `/implement` runs
  already handles an empty or missing folder.
- **Other worktrees of this repository** still hold the old files on their
  own branches. They are someone's work and are not touched. No link points
  into them today.

## Non-goals

- No new review skill replaces `/lens-review`, `/edge-hunt` or
  `/debug-panel`. Reviewing happens inside `/implement` through the pilot mod.
- The specs and plans under `docs/specs/` keep naming the old tools. They are
  the record of why each change was made, and the hard rules allow them to
  name things.
- `CLAUDE.md` keeps its opening line and its hard rules unchanged, and
  deleting the hard rule that mentions this change and the change that made
  the remaining skills generic is separate work.
- Nothing else in the pilot mod changes besides the one symbol.

## Failure modes

- **A live file still names a deleted tool.** A session would be pointed at
  something that does not exist. The first search in Verification catches it.
- **A link is removed while its target still exists.** Every session loses a
  working tool with no replacement on `main` yet. The guard on the update and
  on `test -e` prevents it.
- **A dangling link is left behind.** The Merged step of every later
  `/implement` run would report it. The final `find` catches it.
- **The symbol change breaks the pane.** The pilot mod's type check and tests
  run on it as gates.

## Verification

- This prints nothing, and the same command without `':!docs/specs'` prints
  hits in `docs/specs/generic-skills.md`, which shows the search ran:
  `git grep -n -w -E 'lens-review|edge-hunt|debug-panel|skeptic|repro-hunter|security-lens|maintainer-lens|perf-lens|data-lens' -- . ':!docs/specs'`
- This prints nothing:
  `git grep -n -i -E '<project, client and product names>|[A-Z]{2,}-[0-9]+|develop|check-spec-first|grill-me|adopt-project|iOS|Android|Linear|~/Projects/' -- skills mods README.md`
- This prints nothing: `git grep -n '—' -- skills mods README.md`
- `git ls-files agents skills/lens-review skills/edge-hunt skills/debug-panel`
  prints nothing.
- The four gates in `CLAUDE.md` run and pass, because the change touches
  `mods/pilot`. They read none of `skills/`, `docs/`, `README.md` or
  `CLAUDE.md`, and the report says so.
- The diff against `main` contains only the deleted files, `README.md`,
  `CLAUDE.md`, `skills/pr-comments/SKILL.md`,
  `skills/plan-tournament/SKILL.md`, `mods/pilot/hooks/progress.ts`,
  `mods/pilot/README.md`, the three pilot test files named above, this spec
  and its plan.
- After the merge, the nine links no longer exist, and
  `find ~/.claude/skills ~/.claude/agents -maxdepth 1 -type l ! -exec test -e {} \; -print`
  prints nothing.

## Decided by the counsel

- The issue's comment asks that `git grep -n '—' -- skills mods README.md` print nothing once this change lands. After the deletions it still prints hits in the pilot mod: `mods/pilot/hooks/progress.ts:219` and `:228` return `'—'` as the symbol the pane shows for an unknown model, the tests in `mods/pilot/tests/pane.test.ts`, `progress.test.ts` and `register.test.ts` expect that symbol, and `mods/pilot/README.md:59` describes it. What should this change do about these hits? The counsel chose Change the pane's unknown-model symbol from an em dash to another character (such as a hyphen or a question mark) in progress.ts, its tests and the mod's README, so the grep over skills, mods and README.md prints nothing as written., 4 of 6.
- Done-when item 4 of the issue says a grep for `lens-review`, `edge-hunt`, `debug-panel`, `skeptic`, `repro-hunter`, `security-lens`, `maintainer-lens`, `perf-lens` and `data-lens` "over the repository finds nothing". After the deletions and edits, the only hits left are in `docs/specs/`: the spec and plan that made the remaining skills generic (`generic-skills.md`, `generic-skills-plan.md`) record that these were left for this change, and this change's own new spec and plan must name what they delete. Which files should that grep cover? The counsel chose Everything in the repository except `docs/specs/`: run `git grep -n -E '<names>' -- . ':!docs/specs'`. Specs and plans are the record of why a change was made, which the hard rules allow to name things, so they keep the old names; every live file (skills, mods, README.md, CLAUDE.md, agents) must be clean., 6 of 6.
- `skills/plan-tournament/SKILL.md` step 5 ("Deliver") ends: "Offer to proceed (implement → /verify-loop → /lens-review)." Once `/lens-review` is deleted, what should that sentence offer instead? The counsel chose Offer to build the plan and then run `/verify-loop`, and drop the review step from the sentence, because `/implement` already runs the pilot mod's reviewers on the pull request and plan-tournament usually runs inside `/implement`., 5 of 6.
- After this change deletes every file in `agents/`, the folder no longer exists in git. The README still says "Personal Claude Code skills and review agents, in one place. `~/.claude/skills/<name>` and `~/.claude/agents/<name>.md` are symlinks into this repository" and keeps an "Agents:" line, and the project's `CLAUDE.md` says "This repository holds generic skills, agents and mods" (line 3), "No gate reads `skills/`, `agents/`, `docs/` or `README.md`" (line 22), and names "the agents" in two hard rules (lines 29 and 38). How far should this change go in updating that text? The counsel chose Update both: in the README, drop the `~/.claude/agents` link sentence and the Agents line, and say in one sentence that the review agents now live in the pilot mod (`mods/pilot/agents`); in `CLAUDE.md`, drop `agents/` from the line-22 list of paths no gate reads, and leave lines 3, 29 and 38, which still hold because the mod's agents are agents in this repository., 6 of 6.
- Done-when item 2 of the issue says the links `~/.claude/skills/lens-review`, `edge-hunt`, `debug-panel` and the six `~/.claude/agents/*.md` links are removed and no dangling link remains. They point into the main checkout (`~/Projects/skills`), which stays on `main` until the pull request merges and `/implement`'s Merged step fast-forwards it. When should the session remove them? The counsel chose After the merge, in `/implement`'s Merged step, right after the linked checkout is fast-forwarded: remove the nine links by name with `rm` (never `rm -r`, and only after `readlink` shows each one points at the deleted path), then confirm `find ~/.claude/skills ~/.claude/agents -maxdepth 1 -type l ! -exec test -e {} \; -print` prints nothing., 6 of 6.
