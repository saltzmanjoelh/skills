# The skills repository's CLAUDE.md

Issue: SAL-173. Written 2026-10-08.

## Goal

The skills repository gets a `CLAUDE.md` at its root, so that `/implement` and
`/verify-loop` read this repository's base branch, merge facts, gates and rules
from it. Until now every issue had to spell out the gates and the step that
generates the pilot mod's engine types.

## Users and trigger

A session running `/implement` or `/verify-loop` in a worktree of this
repository reads the file at the start of the work. `/implement` reads the
merge facts again from the base branch before it merges. A person reads it to
learn how changes here are checked.

## Behavior

The file uses the format `skills/implement/SKILL.md` documents: each fact is
one `Label: value` line, the gates are one bullet each under a `## Gates`
heading, and the rules sit under a `## Hard rules` heading.

**Facts.** The file has exactly these three fact lines:

- `Base branch: main`
- `Checks: none`, because the repository has no continuous integration.
- `Merge command: gh pr merge <n> --merge --match-head-commit <sha>`, the
  default written out.

It does not write `Max pushes per round:` or `Max rounds:`. Those limits stay
with the skill, in `/implement`'s own table of defaults. It writes no other
fact either, since every other default is already right for this repository.

**Gates.** Every gate runs on every change, in this order:

1. Load the pilot mod once, from a scratch folder outside the repository:
   `claude -p --max-turns 1 --plugin-dir <worktree>/mods/pilot "ok"`. This
   writes the mod's engine types into `mods/pilot/.claude-plugin/types/`. That
   folder is ignored by git, and `mods/pilot/tsconfig.json` extends the
   `tsconfig.json` inside it. The step is a prerequisite and runs every time,
   so the types never go stale against the installed Claude Code. Two measured
   facts shape the command. Claude Code writes the types even when the model
   call then fails, for example because `claude` is not signed in, and the
   command still exits 1. A rerun also skips writing types that have not
   changed, so their modification time proves nothing. The gate therefore
   deletes the folder first, loads the mod without regard to how the model
   call ends, and passes only if the generated `tsconfig.json` exists again.
2. From `mods/pilot`: `npx -y -p typescript@5.6.3 tsc -p . --noEmit`. The
   bullet quotes what this prints when the first gate did not run:
   `error TS5083: Cannot read file '…/.claude-plugin/types/tsconfig.json'.`,
   together with errors such as `Cannot find global value 'Promise'`, without
   claiming an order, since the latter prints first. It says
   that the cure is to run the first gate, never to edit `tsconfig.json`.
3. From `mods/pilot`: `claude plugin test .`
4. From `mods/pilot`: `claude plugin validate .`

The section then says plainly that no gate reads `skills/`, `agents/`,
`docs/` or `README.md`. A change to those files is checked only by its
reviewers, and a green run of the gates says nothing about them.

**Hard rules.**

- The skills, the agents, the mods and `README.md` name no project, client or
  product. They are generic, so that any repository can use them.
- Specs and plans under `docs/specs/` may name a project and describe the real
  incident behind a requirement, because a requirement needs its reason.
  They never contain credentials, client or customer data, people's personal
  details, or the contents of a private repository.
- Files that name a project today are being cleaned up by SAL-174 and SAL-175.
  A reviewer applies the rule to the text a pull request adds or changes.
- Everything is written in plain, complete sentences: skills, agents, specs,
  commit messages, pull request descriptions and reviews.

## Edge cases

- **A fresh worktree** has no generated types. The first gate creates them,
  and the type check then passes.
- **A worktree whose types came from an older Claude Code.** The first gate
  deletes them and writes them again.
- **`claude` is not signed in.** The types are still written, so the first
  gate passes and the type check runs against fresh types.
- **The load step writes nothing**, for example because the mod's folder is
  wrong. The first gate fails, and if someone runs the type check anyway, it
  fails with the quoted error, which names the cause.
- **A pull request that changes only Markdown.** The gates still run and still
  pass, and the report says they did not read the changed files.
- **A Markdown file inside the mod**, such as `mods/pilot/agents/*.md`. The
  gates run on every change, so nobody has to decide whether a change touched
  the mod.

## Non-goals

- Cleaning up the files that name a project today. SAL-174 and SAL-175 own
  that.
- A gate that reads the skills or agents, such as a check of their
  frontmatter.
- Changing `README.md`, any skill, any agent or the mod.
- Adding continuous integration.

## Failure modes

- If the file breaks the format, `/implement` falls back to its defaults
  without saying so. For example, a `Base branch` line with a typo would make
  it read the default branch from GitHub instead. The verification below reads
  each line the way `/implement` does.
- If a gate's command is wrong, `/verify-loop` reports it red on its first
  run. Each command is run exactly as written before the pull request opens.

## Verification

- `grep -E '^(Base branch|Checks|Merge command):' CLAUDE.md` prints exactly
  the three lines above, and
  `grep -E '^(Max pushes per round|Max rounds):' CLAUDE.md` prints nothing.
- The `## Gates` section has the four bullets in the order above, and a
  `## Hard rules` section follows it.
- In a fresh copy of `mods/pilot` with no generated types, the type check
  prints the TS5083 line that the type check's bullet quotes.
- In this worktree, each of the four gates, copied from the file and run as
  written, passes. The test gate's summary line is recorded in the pull
  request.
- The diff against `main` contains `CLAUDE.md` and this spec and plan, and
  nothing else.

## Decided by the counsel

- In the new root CLAUDE.md, how should the Gates section present the step that generates the pilot mod's engine types (loading the mod once with `claude -p --max-turns 1 --plugin-dir mods/pilot "ok"` from a scratch folder), which the type check needs before it can pass? The counsel chose As the first bullet under ## Gates, run every time, but with the type check's bullet also saying what its failure looks like when the types are missing, 6 of 6.
- The new CLAUDE.md states the rule that nothing in the skills repository names a project, but 13 files on main already do (README.md, five skills, four agents under agents/, and two of the pilot mod's agents). How should this change handle that gap? The counsel chose Change only CLAUDE.md, and word the rule with its scope: skills, agents, mods and README.md name no project, while docs/specs may cite real incidents. Say that existing breaches are tracked in SAL-174 and SAL-175, and that reviewers apply the rule to whatever text a pull request adds or changes., 5 of 6.
- The three gates (the type check, `claude plugin test .` and `claude plugin validate .`) all run from mods/pilot and check only the pilot mod. What should the new CLAUDE.md's Gates section say about a pull request that changes only skills/, agents/, docs/ or README.md, which are Markdown files no gate reads? The counsel chose Run all the mod's gates on every change, and say plainly that no gate reads the skills, agents or docs, so a change to them is checked only by its reviewers, 6 of 6.
