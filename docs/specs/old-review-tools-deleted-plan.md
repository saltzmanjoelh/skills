# Plan: delete the old review skills and agents

Spec: `docs/specs/old-review-tools-deleted.md`. Written 2026-10-12.

## Chosen approach

Two planners ran, one for the simplest change and one for the most robust,
and a judge compared them. The simplest plan won: it meets the spec with the
smallest diff, and its last commit deletes the old tools together with the
README and `CLAUDE.md` text that describes them, so that commit can be read
and reverted as one unit.

The change has four commits after this plan. The pilot pane's symbol for an
unknown model becomes a hyphen, test first. `pr-comments` and
`plan-tournament` stop naming the old tools. Then the three skill folders and
every file in `agents/` are deleted, with the README and `CLAUDE.md` edits.
After the merge, one guarded script removes the nine links under `~/.claude`.

## Grafts from the robust plan

- **The head commit goes to the claim checker.** The `pr-comments` sentence
  says to give `pilot:claim-checker` the head commit the comments are about,
  because the agent's own definition expects a numbered list and the head.
- **The test title is renamed** from "shows a dash" to "shows a hyphen", so
  it says what the test checks.
- **Every empty search has a positive control,** a run that must print, so an
  empty result cannot come from a typo or a mangled em dash. A search for an
  escaped em dash (`u2014`, `mdash`, `&#8212;`) guards the spec's rule that
  the hyphen is never written as an escape.
- **The link script** re-checks the main checkout itself (on `main`, holding
  the merge commit, no longer tracking the old files), reports each link as
  removed, left with a reason, or already gone, and is safe to run twice.

## Rejected alternatives

- **A fallback sentence in `pr-comments` for a project without the pilot
  mod.** The spec chose `pilot:claim-checker` and nothing more. The old text
  depended on `skeptic` in the same way, `/implement` already depends on the
  mod, and the generic rule is about naming no project, not about avoiding the
  mod. A fallback for every skill at once would be separate work.
- **Editing the README and `CLAUDE.md` before the deletion.** That leaves a
  commit where the README no longer lists folders that still exist, and the
  `CLAUDE.md` sentence without `agents/` is only true once the folder is gone.
- **A longer `plan-tournament` sentence** ("once it is built, to run it on
  it") adds nothing to the spec's wording.

## Exact edits

**`mods/pilot/hooks/progress.ts`.** The comment above `modelLabel` ends "no
id at all as a hyphen." Both returns of the em dash, at lines 219 and 228,
return `'-'`, typed as the character itself.

**`mods/pilot/tests/progress.test.ts`.** The test title becomes "a model is
named short, and an agent with no model shows a hyphen". Its four
expectations of the em dash expect `'-'`. One expectation is added,
`expect(modelLabel('\u001b[31m')).toBe('-')`, because no expectation reaches
the second return today: that input is not blank, fails the model-name
pattern, and `printable()` strips it to nothing.

**`mods/pilot/tests/pane.test.ts`** lines 262, 264, 265, 266 and 269, and
**`mods/pilot/tests/register.test.ts`** line 3449: the field between the
middle dots becomes `-`.

**`mods/pilot/README.md`** line 59: "(a hyphen, `-`, for one the mod did not
see spawn)".

**`skills/pr-comments/SKILL.md`**, step 3, the paragraph that names
`skeptic`:

> For anything non-obvious, spawn a `pilot:claim-checker` subagent to try to
> REFUTE the comments before you accept them. Give it those comments as a
> numbered list of claims, together with the head commit they are about, and
> it tries to refute each one with evidence from the code. Fixing a phantom
> costs more than the check does, and a confidently-worded review comment is
> exactly the thing that slips through unexamined.

**`skills/plan-tournament/SKILL.md`**, step 5 ends: "Offer to build the plan
and then run `/verify-loop`."

**`README.md`**, lines 3 to 10:

> Personal Claude Code skills and review agents, in one place. Each
> `~/.claude/skills/<name>` is a symlink into this repository, so edit here.
>
> The skills are `spec`, `plan-tournament`, `implement`, `verify-loop`,
> `pr-comments`, `storypr`, `summarize` and `cleanup`, which is a generic
> teardown of a finished worktree.
>
> The review agents live in the pilot mod, in `mods/pilot/agents`.

**`CLAUDE.md`**, line 22: "No gate reads `skills/`, `docs/` or `README.md`."
Nothing else in the file changes.

Every new sentence was run through the case-insensitive project-name pattern,
which also matches inside words such as "scenarios" or "development", and
none matched.

## Step sequence

1. Commit this plan alone.
2. Change `progress.test.ts` and run `claude plugin test .` from `mods/pilot`:
   the `modelLabel` test fails, expecting `-` and receiving the em dash.
   Change `progress.ts` and run it again: `modelLabel` passes, and the pane and
   register tests fail on the old symbol. Update those two tests and the mod's
   README, run the four gates, and commit all five files together.
3. Commit the `pr-comments` and `plan-tournament` edits.
4. `git rm -r skills/lens-review skills/edge-hunt skills/debug-panel agents`,
   make the README and `CLAUDE.md` edits, and commit them together.
5. Run the verification below, then `/verify-loop`.

## Test plan

Each search that must print nothing is paired with a control that must print.

| Verification line | Check | Control |
|---|---|---|
| Old names | `git grep -n -w -E 'lens-review\|edge-hunt\|debug-panel\|skeptic\|repro-hunter\|security-lens\|maintainer-lens\|perf-lens\|data-lens' -- . ':!docs/specs'` prints nothing | the same without `':!docs/specs'` prints hits in `docs/specs/generic-skills.md` |
| Project names | the spec's pattern over `skills mods README.md` prints nothing | the same pattern over `docs/specs` prints hits |
| Em dash | `git grep -n '—' -- skills mods README.md` prints nothing, and `git grep -n -i -E 'u2014\|mdash\|&#8212;' -- skills mods README.md` prints nothing | `git grep -c '—' -- docs/specs` prints counts |
| Deleted files | `git ls-files agents skills/lens-review skills/edge-hunt skills/debug-panel` prints nothing | `git ls-files skills/implement` prints a file |
| Gates | the four gates in `CLAUDE.md` pass, in order; the report says they read none of `skills/`, `docs/`, `README.md` or `CLAUDE.md` | the red runs in step 2 |
| Diff | `git diff --name-status origin/main...HEAD` lists only the files the spec allows | |
| Links | the script below reports nothing left and its `find` prints nothing | its last line prints the `implement` link |

## After the merge

Run in `/implement`'s Merged step, right after the linked checkout's update,
with the update's outcome and the merge commit filled in. It runs under
`/bin/bash` so that it behaves the same whatever shell starts it. It never
deletes a folder, and `~/.claude/agents` stays in place when it ends up empty.

```
OUTCOME='<the update outcome>' MERGE='<merge commit sha>' /bin/bash -s <<'EOF'
set -u
main="$HOME/Projects/skills"
[ "$OUTCOME" = "Updated" ] || { echo "STOP: the update reported '$OUTCOME', so no link is removed"; exit 1; }
[ "$(git -C "$main" branch --show-current)" = main ] || { echo "STOP: $main is not on main"; exit 1; }
git -C "$main" merge-base --is-ancestor "$MERGE" HEAD || { echo "STOP: $main does not contain $MERGE"; exit 1; }
[ -z "$(git -C "$main" ls-files agents skills/lens-review skills/edge-hunt skills/debug-panel)" ] || { echo "STOP: $main still tracks the old files"; exit 1; }
check() {
  if [ ! -L "$1" ] && [ ! -e "$1" ]; then echo "GONE ALREADY $1"; return; fi
  if [ ! -L "$1" ]; then echo "LEFT $1: it is not a link"; return; fi
  if [ "$(readlink "$1")" != "$2" ]; then echo "LEFT $1: it points at $(readlink "$1")"; return; fi
  if [ -e "$1" ]; then echo "LEFT $1: its target still exists"; return; fi
  rm -- "$1" && echo "REMOVED $1"
}
for n in lens-review edge-hunt debug-panel; do check "$HOME/.claude/skills/$n" "$main/skills/$n"; done
for n in data-lens maintainer-lens perf-lens repro-hunter security-lens skeptic; do check "$HOME/.claude/agents/$n.md" "$main/agents/$n.md"; done
echo "Dangling links (expect none):"
find "$HOME/.claude/skills" "$HOME/.claude/agents" -maxdepth 1 -type l \! -exec test -e {} \; -print
echo "Control (expect the implement link):"
find "$HOME/.claude/skills" -maxdepth 1 -type l -name implement -print
EOF
```

When it stops at a check or leaves a link, the final report names each link
still to remove and the reason.
