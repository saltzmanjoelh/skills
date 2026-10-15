# Make the remaining skills generic

Issue: SAL-175. Written 2026-10-08.

## Goal

The skills `spec`, `plan-tournament`, `verify-loop`, `pr-comments`, `storypr`
and `cleanup` work in any project. They take what differs between projects
from the project's `CLAUDE.md`, as `Label: value` fact lines with defaults, and
they no longer name one project, its stack or a retired tool. The README
documents the whole facts contract in one table.

## Users and trigger

A session running any of these skills in any repository, usually from
`/implement`, reads the project's `CLAUDE.md` for the facts the skill needs. A
person reads the README to learn which facts exist and what each defaults to.

## Behavior

**The contract in the README.** The README gains a section on project facts.
It says that each fact is one `Label: value` line anywhere in the project's
`CLAUDE.md`, and that the gates and the hard rules are sections under their own
headings. A table lists every key, its default and the skills that read it:

| Key | Default | Read by |
|---|---|---|
| `Base branch:` | `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` | implement, storypr, cleanup |
| `Spec directory:` | `docs/specs/` | implement, spec, plan-tournament |
| `Architecture document:` | `docs/architecture.md`, skipped if missing | implement, plan-tournament |
| `Gotchas document:` | `docs/gotchas.md`, skipped if missing | implement, plan-tournament |
| `Screenshot directory:` | `docs/screenshots/` | storypr |
| `Issue tracker:`, `Worktree setup:`, `Max pushes per round:`, `Max rounds:`, `Merge command:`, `Checks:` | as `implement`'s table gives them | implement |
| `## Gates` | detect from the manifests, confirm once, offer to write it | implement, verify-loop, pr-comments |
| `## Hard rules` | none | implement |

The README states that it is the contract, and that each skill restates the
defaults of the keys it reads, because a skill is loaded alone into another
project where this README is not in view. The two must agree. Every default
in the README's table, including the six that only `implement` reads, is
written in the same words as `implement`'s table, so that each key has one
wording everywhere.

**Each skill.** Each skill that reads a fact gets a short "Project facts"
section naming only the keys it reads, each with its default, worded as in the
README. `implement` keeps its existing table unchanged.

- **spec** writes the spec into the spec directory, and reads the existing
  specs there and in the sibling worktrees' spec directories, instead of
  `docs/specs/`.
- **plan-tournament** reads the spec from the spec directory, briefs the
  planners with the architecture and gotchas documents named by their facts
  (skipping each one that is missing), and writes the plan into the spec
  directory.
- **verify-loop** reads the gates from the project's `## Gates` section. When
  there is none, it detects candidates from the manifests, confirms them with
  the person once, and offers to write them under a `## Gates` heading, one
  bullet per gate; it no longer mentions `adopt-project`. Its report lists
  every gate in order with the command and the counts its own output gives
  (tests passed, failed and skipped, or the number of errors), or its exit
  status when the tool prints no count. A gate that ran zero tests is reported
  as zero and does not count as passed. The report then lists every gate that
  did not run, with the reason, and the changed files that no gate reads, when
  the project's `CLAUDE.md` says which paths its gates do not read. "Green"
  stays only as the loop's stopping condition, every gate passed in the final
  full pass, and the report never offers it as a summary.
- **pr-comments** loses its project-specific section at the end. A short
  generic section headed "When the project requires approvals" replaces it.
  When the project's `CLAUDE.md` names reviewers whose approval a pull request
  needs, an approval from one of them is not permission to stop working on
  another's threads. And an approval refers to the commit it was written
  against, so after fixes are pushed each required reviewer has to approve
  again, and the reply says which commit the fixes landed in so each reviewer
  knows what it is approving. It names the `## Gates` section as the gates it
  runs.
- **storypr** diffs against the base branch, opens the pull request with
  `--base` set to it, and commits screenshots into the screenshot directory,
  instead of `main` and `docs/screenshots/`. Its examples use that directory.
- **cleanup** checks that a branch's commits are reachable from the base
  branch named by `Base branch:`, instead of an unnamed "upstream default
  branch". It has no screenshots, so it reads no screenshot fact.

**Wording.** The six skills, the README and the pilot mod lose every project
name, ticket number, private path and em dash the item-5 grep finds. In
particular:

- The README drops its sentence about a reviewer that moved to another repository.
- `mods/pilot/README.md` gives the link command with a placeholder for the
  path to this repository, instead of a path under the owner's home folder.
- A comment in `mods/pilot/tests/counsel.test.ts` stops citing a ticket
  number.
- `cleanup`'s "A developer's machine" is reworded.
- `pr-comments` points to the writing rules in the user's own
  `~/.claude/CLAUDE.md`, if it has any, instead of naming one owner's section.
- "URLs" in `storypr` and "linear costs" in
  `mods/pilot/agents/performance-reviewer.md` are reworded, keeping their
  meaning, because the grep is case-insensitive.
- Em dashes become ordinary punctuation, with the sentences rewritten where
  needed so that they stay complete.

## Edge cases

- **A project with no `CLAUDE.md`, or without a given fact.** Every skill
  uses the default its own text states. Nothing depends on finding the README.
- **A missing architecture or gotchas document.** `plan-tournament` skips it,
  as `implement` already does.
- **A base branch that is not `main`.** `storypr` diffs against it and passes
  it to `gh pr create --base`; `cleanup` checks reachability from it.
- **A project whose `CLAUDE.md` names no required reviewers.** The new
  `pr-comments` section does not apply.
- **A gate that exits 0 having run nothing.** `verify-loop` treats it as a
  failure to fix, and its report gives the zero.
- **A project with no gates at all.** When `verify-loop` finds no `## Gates`
  section, detects nothing and the person names no gate, it stops and reports
  that the project has no gates, instead of passing with nothing to fail.
- **A loop that gets stuck before a final full pass.** The report gives each
  gate's counts from its most recent run and names that run's round, and for
  each failing gate the failing tests and the exact error.

## Non-goals

- `skills/lens-review`, `skills/edge-hunt`, `skills/debug-panel`, everything in
  `agents/`, and the `skeptic`, `repro-hunter` and `/lens-review` references in
  `pr-comments` and `plan-tournament`. SAL-174 deletes or rewrites those, so
  this change leaves them alone, and the item-5 grep excludes the three folders
  until SAL-174 merges.
- Changing `implement`'s table or behavior.
- The root `CLAUDE.md` sentence naming SAL-174 and SAL-175, which SAL-199
  removes.
- Em dashes in `docs/`, which the issue's grep does not cover.
- A gate that checks the skills' text.

## Failure modes

- **A skill's default drifts from the README.** No gate reads `skills/` or
  `README.md`, so only reviewers catch it. The verification below compares
  every key's default in every file that states it.
- **The full grep still hits after this merges**, in the three folders SAL-174
  deletes. That is expected until SAL-174 merges. A follow-up asks SAL-174 to
  run the same grep with nothing excluded.
- **A rewritten sentence changes what a skill tells the model to do.** The
  diff is reviewed hunk by hunk against the old text. Only the facts, the
  report format, the approval section and wording change.

## Verification

- This prints nothing:
  `git grep -n -i -E '<project, client and product names>|SAL-|develop|check-spec-first|grill-me|adopt-project|iOS|Android|Linear|~/Projects/' -- skills mods README.md ':!skills/lens-review' ':!skills/edge-hunt' ':!skills/debug-panel'`
- This prints nothing:
  `git grep -n '—' -- skills mods README.md ':!skills/lens-review' ':!skills/edge-hunt' ':!skills/debug-panel'`
- For each key in the README's table, `git grep -n '<key>' -- skills README.md`
  shows it only in the skills its row names and in the README, and every
  default stated beside it matches the README's.
- `skills/storypr/SKILL.md` contains no `main..` diff and no literal
  `docs/screenshots/` outside the facts section; its `gh pr create` passes
  `--base`.
- `skills/verify-loop/SKILL.md` describes the per-gate report above and uses
  "green" only for the stopping condition and the trigger phrase.
- `skills/pr-comments/SKILL.md` has the "When the project requires approvals"
  section and no project-specific section.
- The four gates in `CLAUDE.md` run and pass, since the change touches
  `mods/pilot`. They read none of `skills/` or `README.md`, and the report
  says so.
- The diff against `main` contains only the six skills, `README.md`, the
  three pilot mod files named above, this spec and its plan.

## Decided by the counsel

- SAL-175 item 6 says the README documents the project-facts contract once (each key and its default), and each skill names only the keys it reads. Where should each fact's default be written? The counsel chose The README holds the full table of every key and its default, and says it is the contract. Each skill also lists the keys it reads with their defaults, because a skill is loaded alone into another project and cannot rely on finding this README; the README says the skills restate their defaults and must agree with it., 3 of 4; performance-reviewer and data-reviewer abstained.
- SAL-175 item 5 requires a grep over skills, mods and README.md for project names and em dashes to print nothing. Today it also hits skills/lens-review, skills/edge-hunt and skills/debug-panel, which SAL-174 (not started) deletes outright, and the `skeptic` references in skills/pr-comments, which SAL-174 also rewrites. How should this pull request treat those files? The counsel chose Leave every file SAL-174 deletes or rewrites alone. Verify item 5 with the three folders SAL-174 deletes excluded, say in the spec and the pull request that the full grep passes only once SAL-174 merges, and do not wait for it., 2 of 3; security-reviewer, performance-reviewer and data-reviewer abstained.
- SAL-175 item 3 says skills/pr-comments "loses its 'In <project> specifically' section and uses generic approval wording". What should replace that section? The counsel chose A short generic section, such as 'When the project requires approvals': when the project's CLAUDE.md names reviewers whose approval a pull request needs, treat every such reviewer's threads alike, and after pushing fixes say which commit they landed in, because an approval refers to the commit it was written against and each required reviewer must approve again., 3 of 4; performance-reviewer and data-reviewer abstained.
- SAL-175 item 2 says skills/verify-loop "reads the gates from the project's ## Gates section and reports counts, not verdicts". What exactly should its report contain, and what happens to the word "green"? The counsel chose The report lists every gate in order with the command, the counts its own output gives (for example tests passed, failed and skipped, or the number of type errors), or its exit status when the tool prints no count, and then every gate that did not run with the reason. "Green" stays only as the loop's stopping condition (every gate passed in the final full pass) and never appears in the report as a summary., 3 of 3; security-reviewer, performance-reviewer and data-reviewer abstained.

## Decided by the person

- How the item-5 grep treats letter case, after the counsel split 2 to 2: one case-insensitive grep for every pattern, with the text that collides with ordinary words reworded.
