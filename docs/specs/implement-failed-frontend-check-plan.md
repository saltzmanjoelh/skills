# Plan: /implement treats a failed frontend check as no answer

Date: 2026-11-06. Spec: `implement-failed-frontend-check.md`.

## Chosen approach

Three blind planners wrote plans from three priors: the smallest change, the
most robust change, and the change that makes the named follow-ups cheapest.
A judge scored them against the spec, the owner's writing rules and the git
behaviour measured in a scratch repository. The most robust plan won, with
grafts from the other two.

The change is Markdown only and touches `skills/implement/SKILL.md` and
`skills/implement/frontend.md`. No heading is added or renamed, so the
section names that `mods/builder/hooks/step.ts` pins stay valid. The change
keeps no state: every decision is read again from git when it is needed.

Every place that decides whether something is frontend follows the same
pattern. It runs the read, judges it by its exit status, fetches the base
and tries once more, and then takes its own fallback. In step 7 the fallback
is to ask the person and open nothing. In `frontend.md` it is to take the
side that loses nothing, tell the person in one sentence, and carry on.

## Grafts, and why

- **Run from the top folder, and pass `--full-tree` to `git ls-tree`**, from
  the most extensible plan. Measured: from a subfolder, both `git ls-tree`
  and the step 7 `git diff` exit zero and print nothing although the file
  exists or a frontend file changed. The exit-status rule cannot catch that,
  so the spec gained this edge case before this plan was written.
- **Read with `git show` first, and run `git ls-tree` only when it fails**,
  as the robust and extensible plans do. The smallest plan read with
  `git ls-tree` first, which from a subfolder would report "no `CLAUDE.md`"
  on every run and silently replace a project's own line.
- **Put the new paragraph where it breaks no reference**, a point the
  smallest plan raised. The paragraph that begins "When the change is
  frontend" refers twice to "the next paragraph", meaning the paragraph that
  opens the pull request the plain way, so the new paragraph goes before it,
  not after it.
- **Keep `frontend.md` self-contained.** It names both commands and the retry
  itself, rather than pointing at a paragraph of `SKILL.md`, so a newer
  `frontend.md` still works beside an older copy of `SKILL.md` in the
  context.

## Rejected alternatives

- **A named rule, defined once in step 7, that each place opts into** (the
  most extensible plan). It would make the two follow-ups one clause each,
  but the follow-ups are Non-goals, and the named rule costs a paragraph
  plus a glossary sentence now. It also makes `frontend.md` depend on a
  paragraph of `SKILL.md`.
- **Three reads, each with its own retry** (the smallest plan). It counts
  `git ls-tree`, `git show` and `git diff` separately, so one pass could
  fetch three more times and the cap on retries becomes vague.
- **Retry only the read that failed.** A second fetch that succeeds can
  change the base branch's `CLAUDE.md` as well as the diff, so step 7 runs
  both reads again, once. The wording still says that the failed read is
  repeated, which the spec asks for.
- **A sentence telling a compacted session to run step 7 again.** It would
  contradict "After a compaction", which says to carry on the stage the
  summary names, and a summary may already hold the person's answer.

## Step sequence

### 1. `SKILL.md`, step 7, opening paragraph

Replace the paragraph that begins "First find out whether the change is
frontend" and ends "The line is read in one of three ways:" with:

> First find out whether the change is frontend. Run every command of this
> check from the worktree's top folder, because `git diff` and `git ls-tree`
> read their pathspecs relative to the current folder and, from a subfolder,
> succeed and print nothing. Begin with `git fetch origin <base>`. The reads
> below use the local copy of the base branch, which in a worktree made
> hours earlier can hold an old `Frontend paths:` line, and the answer would
> then be wrong with no sign of it. The fetch is there to prevent that, so
> keep it even though a failed read fetches again later. A fetch that fails
> here does not stop the step: the reads go ahead with the local copy, and
> only a read that fails counts.
>
> Two reads decide the answer, and each decides it only when it succeeds.
> Run each read as a command of its own, not piped into another command, so
> that the exit status is git's own. A read whose exit status is not zero
> gives no answer, whatever it printed. Its empty output never means that
> the base branch has no `CLAUDE.md`, that the file has no `Frontend paths:`
> line, or that the change is not frontend.
>
> The first read is the `Frontend paths:` line of the base branch's
> `CLAUDE.md`, read with `git show origin/<base>:CLAUDE.md`. That command
> fails both when the file is missing and when the base branch cannot be
> read. When it fails, run
> `git ls-tree --full-tree --name-only origin/<base> -- CLAUDE.md`, which
> succeeds and prints nothing when the file is missing. Only that outcome
> means the base branch has no `CLAUDE.md`, and such a base counts as having
> no `Frontend paths:` line. When `git ls-tree` fails too, or prints
> `CLAUDE.md` although `git show` failed, the read gives no answer. When the
> read gives an answer, the line is read in one of three ways:

### 2. `SKILL.md`, the definition of "says `Frontend paths: none`"

After "...`CLAUDE.md` "says `Frontend paths: none`" when it has this line,
and only then.", add:

> A read of that file that gives no answer, here or wherever else this skill
> or `frontend.md` reads it, does not say it, so every condition that turns
> on the phrase keeps the screenshot rules on when its read fails.

### 3. `SKILL.md`, the second read

Change "The change is frontend when this command prints at least one path."
to:

> The second read is the command below. When it succeeds, the change is
> frontend when it prints at least one path, and not frontend when it
> prints none.

### 4. `SKILL.md`, the new paragraph

Insert before the paragraph that begins "When the change is frontend, read
the section":

> When either read gives no answer, run `git fetch origin <base>` again,
> whether or not the first fetch succeeded, and then repeat the read that
> failed and every read after it, once. This is the only retry in one pass
> through step 7. When a read still gives no answer, push nothing and open
> no pull request. Ask the person with `AskUserQuestion`, in the form
> "Questions" gives, without putting the question to the counsel. The
> question names the command that failed and gives what git printed on its
> standard error. Its options, in this order, are:
>
> - "Wait, then check again", the recommended one: when the person says the
>   cause is fixed, run step 7 again from its first fetch.
> - "Open as frontend": read the section **A frontend change** of
>   `skills/implement/frontend.md` and open the pull request as it says.
> - "Open the plain way": its description says that this skips the frontend
>   check. Open the pull request as the paragraph that begins "Check the
>   diff against the base" says, with nothing about screenshots in the body.
>
> No pull request exists yet, so no `needs-decision` label goes on anything.

### 5. `SKILL.md`, the "not frontend" sentence

In the paragraph that begins "When the change is frontend, read the
section", change "When the command prints nothing" to "When the command
succeeds and prints nothing".

### 6. `SKILL.md`, "Questions"

Add to the list of questions that go straight to the person:

> - a frontend check in step 7 that still gives no answer after a fetch and
>   one more try;

and change "the mod adds `needs-decision` to the pull request while the
question is open" to "the mod adds `needs-decision` to the watched pull
request, when there is one, while the question is open". That matches
`asking()` in `mods/builder/hooks/register.tsx`, which labels a pull
request only when a watch exists.

### 7. `frontend.md`, the `/storypr` fallback

After "...apply step 7's three readings of its `Frontend paths:` line.",
insert:

> Read it as step 7 does, from the top folder: `git show
> origin/<base>:CLAUDE.md`, and when that fails, `git ls-tree --full-tree
> --name-only origin/<base> -- CLAUDE.md`, which succeeds and prints nothing
> only when the file is missing. A read whose exit status is not zero gives
> no answer, whatever it printed. Then run `git fetch origin <base>` and read
> once more. When it still gives no answer, write the section as if the
> built-in list applies.

Change the sentence on the built-in list so that it stays true: the section
says that the built-in list of frontend paths matched the change only when
step 7 found the change frontend and the fresh read succeeded. When the read
gave no answer, the section says instead that the project's `Frontend
paths:` line could not be read, so the section was written as if the
built-in list applied. When the person chose "Open as frontend" after step
7's check gave no answer, it says instead that the frontend check could not
run. The sentence about how the project can change its list stays. The
sentence that tells the person covers these notes too. The existing rule
for published reasons, with plain words, no raw error output and no local
path, already covers the new sentences.

### 8. `frontend.md`, the per-commit check

After "When it prints a path, the commit touches a frontend path.", insert:

> That holds only when the command succeeds, run as a command of its own.
> When it exits nonzero it gives no answer, whatever it printed. It also
> gives no answer when the read of the base branch's `CLAUDE.md` that gives
> it the pathspecs of step 7 gives no answer. Then run `git fetch origin
> <base>`, and run the read and the check once more. When it still gives no
> answer, treat the commit as touching a frontend path, retake the
> screenshots as below, tell the person in one sentence that the frontend
> check could not run, and carry on without asking.

### 9. Checks before committing

- `git diff` shows no added or changed heading line.
- Every condition that uses "says `Frontend paths: none`" is still covered
  by the definition in step 2.
- The issue-key grep from `.claude/rules/no-project-names.md` over the staged
  diff finds nothing.
- Every added line is a complete sentence with no shorthand.

## Test plan

No gate reads `skills/` or `docs/`, so the reviewers check this by reading
the diff, point by point against the spec's Verification section:

- Step 7 starts with the fetch and says why: step 1.
- A nonzero exit gives no answer for both reads, and the missing-file case
  is decided by a command that succeeds when the file is absent: steps 1, 3
  and 5.
- Step 7 retries once after a fetch, then asks with the three options and
  opens and pushes nothing: step 4.
- The per-commit check and the `/storypr` fallback each say what a failed
  read means, retry once after a fetch, take the side that loses nothing and
  tell the person in one sentence: steps 7 and 8.
- A failed read does not say `none`: step 2.

The git behaviour the wording relies on was measured in a scratch
repository, as the spec records, and planning added the subfolder case. The
gates run anyway, and the report says they did not read the change.
