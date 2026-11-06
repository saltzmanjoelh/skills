# Plan: /implement treats user-interface changes as frontend by default

Date: 2026-11-06. Spec: `implement-frontend-by-default.md`.

## Chosen approach

Three planners wrote plans blind to each other, and a judge compared them:
one wrote the simplest change, one the most robust, and one the most
extensible. The simplest plan won. It is the smallest change, it adds nothing
the spec does not ask for, and its check by reading every hit of
"Frontend paths" is the only one that catches the two old conditions whose
sentences wrap across lines.

The plan does three things:

1. **Move the frontend check into step 7.** The sentences in
   `frontend.md`'s section **A frontend change** that define the fact, give
   the `git diff` command and explain `--no-renames` move into step 7 of
   `skills/implement/SKILL.md`. Step 7 gains the three readings of the line,
   and the built-in default list, written once as a ready-to-run command.
2. **Replace one condition everywhere.** Every place that says the base
   branch's `CLAUDE.md` "names a `Frontend paths:` glob" or "names at least
   one glob" says instead that the pull request's body has a
   `## Screenshots` section and the base branch's `CLAUDE.md` does not say
   `Frontend paths: none`. That covers four places in SKILL.md, two in
   `frontend.md`, and the merge bullet in `mods/builder/hooks/step.ts`.
3. **Add the default-list note to the fallback**, and reword the facts rows
   in SKILL.md and `README.md`.

## Grafts onto the simplest plan

- **Work out which list found the change when the fallback is written,
  from the most robust plan.** The simplest plan asked step 7 to "keep in
  mind" which list found the change, which is state held only in the
  session's memory, and a compaction could lose it. The fallback in
  `frontend.md` instead works it out again from the base branch's
  `CLAUDE.md` at the moment it writes the section.
- **Define the opt-out phrase once in step 7, from the robust and
  extensible plans.** One sentence says what "the base branch's
  `CLAUDE.md` says `Frontend paths: none`" means, so every later condition
  rests on one definition.
- **Name how the line is read, from the robust plan.** Step 7 reads it with
  `git show origin/<base>:CLAUDE.md`, and a base branch with no `CLAUDE.md`
  counts as having no line.
- **Put the reading rule in the merge bullet, from the robust plan.** The
  session reads the bullet at merge time, possibly without step 7 loaded, so
  the bullet adds "with the word `none` alone after the label, in any case".
- **Say that the notice carries the note, from the robust plan.** "Tell the
  person the same, including that note when it applies, in one sentence."
- **State the no-fallback edge case in step 7, from the extensible plan.**
  When the project's own list matches nothing, the change is not frontend,
  and the built-in list is not consulted.
- **Name both wrapped places in the verification.** The spec's grep cannot
  see `frontend.md`'s opening ("names at least one / glob under") or
  SKILL.md's "When a turn ends" ("names a / `Frontend paths:` glob"), so
  the verification also greps for "Frontend paths" and reads every hit.

## Rejected alternatives

- **A rule for escaping single quotes inside a project's globs,** from the
  robust plan. The spec does not ask for it, and reviewers would rightly
  call it scope creep.
- **A sentence on what to do when git cannot run the check,** from the
  robust plan. It is also outside the spec.
- **One pathspec per line in the default list,** from the extensible plan.
  A model that copies those lines into a shell runs each one as a separate
  command. A single command with backslash line breaks cannot be misused
  that way.
- **An extra sentence about `none` in the merge bullet, and a test renamed
  with backticks in its title,** from the extensible plan. The sentence
  repeats the bullet's condition and would make the test's old part pass
  only by accident.
- **Keeping "keep in mind which list found it" in step 7,** from the
  simplest plan itself, for the reason in the first graft.
- **Having the builder mod parse `Frontend paths:` and drop the bullet on
  `none`.** The bullet stays fixed text, and the session applies the
  condition, so the mod keeps no new state.

## Steps

1. **The test, first.** In `mods/builder/tests/register.test.ts`, in the
   test "both merge texts bring a frontend pull request's screenshot section
   up to date before reading the pull request again", replace the part
   '`Frontend paths:`' with '`Frontend paths: none`', and add
   `expect(bullet).not.toContain('names at least one glob')` after the parts
   loop. Run `claude plugin test .` in `mods/builder` and see it fail.
2. **The merge bullet.** In `mods/builder/hooks/step.ts`, replace "names at
   least one glob on its `Frontend paths:` line" with "does not say
   `Frontend paths: none`, with the word `none` alone after the label, in
   any case". Keep "A pull request whose body has no such section skips this
   bullet." word for word. Rerun the test and see it pass.
3. **SKILL.md.**
   - The facts row says that the default is the built-in list in step 7,
     that a project's own comma-separated globs replace it, and that
     `Frontend paths: none` turns it off, so that no change is frontend.
   - Step 7's opening paragraph is replaced. The new text reads the line
     with `git show`, gives the three readings, defines the opt-out phrase,
     gives the default list as one command block, says how a project's own
     list becomes pathspecs, defines "the pathspecs of step 7", states the
     exclusions, the naming convention, the no-fallback case and the rename
     rule, and then sends a frontend change to `frontend.md`.
   - "When a turn ends", "A review round", "Resuming" and "After a
     compaction" take the new condition. "A review round" also rewrites its
     closing sentence: when the body has no such section, or the base branch
     says `none`, nothing there asks the session to read the file.
4. **frontend.md.**
   - The opening says the file is read only when step 7 finds the change
     frontend, or when the body has a `## Screenshots` section and the base
     branch does not say `none`. "The pathspecs of step 7" now means the
     ones step 7 builds.
   - The check's sentences leave **A frontend change**.
   - The fallback gains the default-list note, worked out again from the
     base branch's `CLAUDE.md`, naming no path, and the notice to the person
     carries it.
   - **Screenshots on a frontend pull request** takes the new condition and
     keeps its reason: with no pathspec, `git diff --cached --name-only`
     lists every staged file, and while the rules apply the pathspecs are
     never empty.
5. **README.md.** The facts row says the same as SKILL.md's.

## Test plan

These map to the spec's Verification section.

- Step 1 fails first and passes after step 2. Then run every gate in the
  order `CLAUDE.md` gives: load both mods, run `tsc` in builder and then
  foreman, then `claude plugin test .` and `claude plugin validate .` in
  each.
- `grep -rn "names a \`Frontend paths:\` glob\|names at least one glob"
  skills/implement mods/builder/hooks` prints nothing. Then
  `grep -n "Frontend paths" skills/implement/*.md README.md
  mods/builder/hooks/step.ts` is run, and every hit is read, including the
  two wrapped places above.
- Step 7 is compared pathspec by pathspec against point 2 of the spec, with
  20 included and 5 excluded, and is checked for the three readings and the
  reading rule.
- The fallback's note appears only for the built-in list and names no path.
- The facts rows match point 7 of the spec.
- In a scratch repository outside the worktree, the exact command from step
  7 prints `src/App.tsx` for a change to it, prints nothing for a change to
  `src/App.test.tsx` alone, and prints nothing for `server/main.go` alone.
  A root-level `App.tsx` also prints.
- The staged diff passes the issue and pull request number grep from the
  no-project-names rule, and every added line is reread.

The gates read only the builder mod's test, so the report says that the
skill and README text were checked by reading and by the scratch check.

## Outside this plan

This repository has no `Frontend paths:` line, and the built-in list matches
the mods' `pane.tsx` and `register.tsx` files. After this change, an
`/implement` run here that edits one of them will be found frontend. Whether
this repository should say `Frontend paths: none` is the owner's call and a
separate change.
